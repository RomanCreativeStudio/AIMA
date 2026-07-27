# ADR 0004: Intent & Approval Engine Design

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §4 & §5, `backend/src/intent/`, `backend/src/approval/`, `ai-engine/src/intent/`

## Context

Phase 1.4 asked for structured intent detection and approval workflows "without executing external actions." Four design questions came up.

## Decisions

### 1. Rule-based classification, not a second AI call

`RuleBasedIntentClassifier` (`ai-engine/src/intent/`) uses ordered regex pattern matching, not a call to the AI provider. Calling the model a second time per turn just to classify intent would add latency, cost, and a second failure mode for a fixed, tiny intent set (7 values). The classifier sits behind an `IntentClassifier` interface — mirroring the `AIProvider`/`EmbeddingProvider` pattern from prior sprints — so a future model-based (or structured tool-call) implementation can replace it without any caller changing. No registry/env-var selection layer was added yet (unlike `AI_PROVIDER`/`EMBEDDING_PROVIDER`), since there is only one implementation; add one when a second implementation actually exists (`docs/DEVELOPMENT_SETUP.md` §9, Rule 1 — avoid unnecessary complexity).

### 2. Conversation integration is metadata-only; the Approval Engine is a separate, DB-backed lifecycle

This was the central design tension. Two readings of "approval workflow" were possible: (a) every conversation turn creates real, persisted approval state, or (b) conversation turns only *report* what approval state an action would have. We chose a split:

- **`IntentEngine.analyze()`** (`backend/src/intent/intentEngine.ts`) is pure and database-free: classifier → capability lookup → `PermissionEngine.evaluate()` → an `ApprovalState` computed in memory. It never creates a `pending_approvals` row. This satisfies "detect intent, attach structured metadata, do not execute actions" literally — there is no side effect to point to.
- **`ApprovalEngine`** (`backend/src/approval/approvalEngine.ts`) is the real, DB-backed lifecycle — `evaluate` (creates a pending approval for a Tier 3 capability), `approve`, `deny`, `getStatus` — fully implemented and tested, but **not invoked by the conversation pipeline in this phase**. None of the initial 7 intents (`chat`, `remember`, `create_task`, `draft_email`, `summarize`, `search_memory`, `unknown`) map to a Tier 3 capability: by the Product Bible's own classification (Foundation Sprint registry), all of them are internal/reversible (Tier 1 or Tier 2). Building an HTTP surface to approve/deny something that conversation traffic can never actually create would be speculative. `ApprovalEngine` is exercised directly in tests today (using the real `send_email` Tier 3 capability from the registry) and is ready to be wired into conversation-triggered actions the moment a real Tier 3 capability exists to detect (Integration Sprint).

### 3. `capabilities` table populated via startup sync, not a static seed migration

`ApprovalEngine.evaluate` needs a `capabilities.id` to satisfy `pending_approvals.capability_id`'s `NOT NULL` foreign key — a gap that existed since `0001_init.sql` (the table was created but nothing ever inserted into it; the code registry was designed as the sole source of truth, per `docs/TECHNICAL_ARCHITECTURE.md` §5). Rather than a one-time SQL seed migration (which would drift the moment a capability's tier changes in code), `syncCapabilitiesToDatabase` upserts the live registry into the table by `action_type` every time the backend starts. This was caught as a real blocker while writing `ApprovalEngine`'s first integration test, not designed speculatively.

### 4. A new `summarize_content` capability, Tier 1

The `summarize` intent needed a capability to resolve a tier against. Summarizing is text-only output with no side effect, same as `generate_ai_response` — so it's registered at Tier 1 (`suggest`), not gated, consistent with the "no capability defaults to Tier 4" and "internal actions can default lower" precedents already in the registry.

## Consequences

- No new abstraction was needed for "detect intent, don't act on it" — `IntentEngine` composes three already-built pieces (`IntentClassifier`, `INTENT_CAPABILITY_MAP`, `PermissionEngine`) and adds no state of its own.
- The response schema (`SendMessageResult`) now includes `intent: { intent, confidence, approval, suggestedNextAction }` alongside the existing `userMessage`/`assistantMessage`/`retrievedMemories` — validated by a dedicated schema-shape test (`conversationService.test.ts`) so a future field rename or removal is caught immediately.
- `ApprovalEngine`'s workspace isolation mirrors `ConversationNotFoundError`'s pattern exactly: a `pending_approvals` id from another workspace is reported as `PendingApprovalNotFoundError`, identical to a nonexistent id, so a cross-workspace guess learns nothing.
- The first real Tier 3 capability (e.g., actually sending an email) is the trigger for two follow-up changes, both explicitly deferred: routing that capability's detected intent through `ApprovalEngine.evaluate` from within `ConversationService`, and exposing HTTP routes to approve/deny it. Building either before that capability exists would be untestable end-to-end and premature.
