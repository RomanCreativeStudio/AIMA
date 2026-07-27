# ADR 0007: Intent & Approval Workflows

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3, §4, §5, `ai-engine/src/intent/`, `backend/src/intent/`, `backend/src/approval/`, `backend/src/drafts/`, `backend/src/core/aimaCoreService.ts`

## Context

Phase 1.4 (ADR 0004) built the Intent Engine and Approval Engine as two deliberately separate, advisory-only components: the Intent Engine reported what tier a detected intent's capability *would* need, and the Approval Engine could create/approve/deny a `pending_approvals` row — but nothing in the conversation pipeline ever called the latter. Phase 1.7 asked for the two to actually connect, for the approval lifecycle to gain a real `expired` state, and for a foundation for prepared content (drafts) that a future Tier 3 capability could act on. The central question was how much of this to build for real versus leave as scaffolding, given that none of the 9 intents' default tiers are actually Tier 3 today.

## Decisions

### 1. Two advisory/lifecycle concepts get two distinct types, not one overloaded one

Before this phase, `ApprovalState` in `backend/src/approval/types.ts` was reused for both "would this intent's capability need approval" (`no_approval_needed`/`approval_required`) and "what state is this specific pending_approvals row in" (`approved`/`denied`) — two different questions answered by one type. This phase splits them: `intent/types.ts#ApprovalRequirement` (`no_approval_needed`/`approval_required`) stays purely advisory and intent-scoped; `approval/types.ts#ApprovalStatus` (`pending`/`approved`/`rejected`/`expired`) is the real, DB-backed lifecycle. `AimaCoreService`'s response carries both: `intent.approval` (advisory) and a new top-level `approvalDecision` (real, with a `pendingApprovalId` when applicable) — deliberately not collapsed into one field, since one is a forward-looking guess and the other is an actual queued request.

### 2. `expired` is derived, never persisted

`pending_approvals` gained an `expires_at` column (`database/migrations/0006_approval_lifecycle.sql`, default 24 hours from creation) but the `status` column's CHECK constraint only allows `pending`/`approved`/`rejected` — `expired` is computed by `ApprovalEngine` at read time (a still-`pending` row whose `expires_at` has passed) rather than written by a background job. This satisfies "no external automation" directly: nothing needs to run on a schedule to flip stale requests, and `approve()`/`reject()` on an expired row throw `PendingApprovalExpiredError` instead of silently succeeding. The same migration also renamed `declined` → `rejected` (a clean-break rename, no UI consumes the old value yet) and added a `sequence` column so `list()` can order approvals created within the same test transaction, where Postgres freezes `now()` at transaction start — the same problem `messages.sequence` solved in `0003_message_sequence.sql`.

### 3. `AimaCoreService` creates the real approval, not `IntentEngine`

`IntentEngine.analyze` keeps its Phase 1.4 invariant: it never touches the database. The new wiring lives in `AimaCoreService.handleRequest`, which resolves the detected intent's mapped capability (`intentCapabilityMap.ts`) and — only if one exists — calls `ApprovalEngine.evaluate(workspaceId, capability, intent.parameters)` in parallel with the AI provider call. This is what makes "approval requirements cannot be bypassed" true in practice rather than just reported: the moment any of the 9 intents' capabilities is promoted to Tier 3 (via the still-unbuilt per-workspace override, or a future capability registry change), every conversation turn detecting that intent automatically creates a real, trackable `pending_approvals` row — no code path in the conversation pipeline can produce a Tier 3 result without one. Under the shipped default tiers this path creates zero rows (all 9 intents map to Tier 1/2 capabilities today), which is expected, not a gap — it's forward-compatible plumbing, verified in tests by temporarily promoting `create_task` to Tier 3.

### 4. No public "create approval" route

`backend/src/routes/approvals.ts` exposes `list`/`get`/`approve`/`reject` but deliberately no `POST .../approvals` that accepts an arbitrary `actionType`. If it existed, any client could request an approval for a capability it has no business acting on, or use it to probe which capabilities exist. Creation only ever happens as a side effect of a capability-gated code path attempting a Tier 3 action (today, only `AimaCoreService` does this) — the same principle as `ApprovalEngine.evaluate` deciding, not trusting, the tier.

### 5. Parameter extraction stays regex-based, not a second AI call

The Intent Engine's new `parameters` field (e.g. `{ title }` for `create_task`, `{ topic }` for `draft_email`/`draft_proposal`, `{ query }` for `search_memory`/`search_documents`) is extracted by `RuleBasedIntentClassifier` finding the trigger phrase and returning the remainder of the message — no NLP, no additional model call. This keeps intent detection deterministic, testable, and free, consistent with the Phase 1.4 decision to use pattern matching rather than a classifier model. The extracted parameters are used immediately as the payload passed to `ApprovalEngine.evaluate` (decision 3), giving them a real purpose rather than being purely decorative.

### 6. Action Preparation Layer: one generic `drafts` table, not four

Rather than separate tables per draft kind, `backend/src/drafts/` adds one `drafts` table with a `type` enum (`email`/`proposal`/`client_response`/`report`) and generic `title`/`content`/`metadata` columns — mirroring the Task Foundation's "minimal on purpose" precedent (ADR 0006 #4). Each type is gated by its own capability (`draft_email`, `draft_proposal`, `draft_client_response`, `draft_report` — all Tier 2/prepare) so future differentiation in tier or behavior per draft type doesn't require a schema change, only a registry change. Nothing in this phase wires a draft to an actual send action; that's explicitly out of scope ("do not execute external actions") and left for whichever future Tier 3 capability (e.g. `send_email`) consumes it.

## Consequences

- `AimaResponse`/`SendMessageResult` gained a top-level `approvalDecision` field; existing `intent.approval` is unchanged in meaning, now paired with the real decision rather than standing alone.
- `pending_approvals.status`'s `declined` value is renamed to `rejected` — a clean break, no UI depends on the old value.
- `ApprovalEngine.deny()` is renamed to `reject()` to match the new vocabulary; there are no other callers to migrate outside this codebase.
- Every future real Tier 3 capability (e.g. `send_email`) needs no new wiring in the conversation pipeline to get a working approval flow — `AimaCoreService` already creates and surfaces the pending approval automatically once that capability's tier says so.
