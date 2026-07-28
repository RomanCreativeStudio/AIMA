# ADR 0012: Workflow Orchestration Foundation

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3, §4, §5, `backend/src/workflows/`, `backend/src/permissions/registry.ts`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Through Phase 2.3, AIMA could perform exactly one gated action per approval — a single capability, evaluated once, executed once. Phase 2.4 asked for something structurally different: a workflow engine that chains several steps together (some internal, some capability-gated), with pause/resume/cancel and execution history, built from four fixed built-in workflows — while still honoring the same rules that have governed every prior phase: no automatic execution, every external step remains approval-gated, and workspace isolation holds.

The central tension: a workflow *looks* like it wants a scheduler or a background job runner, but this codebase has deliberately never had one — every gated action so far has been synchronous, request-driven, and reviewable one step at a time. Building a queue/scheduler for this phase would be new infrastructure disproportionate to "four two-step workflows," and would blur the line between "AIMA prepares an action" and "AIMA runs an action," which is the one line the Product Bible draws hardest.

## Decisions

### 1. `executeNextStep` advances exactly one step — never a "run to completion" call

`WorkflowService.executeNextStep(runId)` performs at most one step's effect and returns. There is no `runToCompletion` method, and no code path where a call to `executeNextStep` internally loops. This is the single decision that resolves the central tension above: it means "no automatic execution" is a structural property of the API surface, not a policy someone has to remember to enforce — a caller (the macOS Workflows screen today, conceivably a scheduler that still requires per-step confirmation later) must explicitly drive every single step of a workflow. It also makes `pause` meaningful: pausing a workflow that runs to completion in one call would be a no-op, but pausing a workflow that only advances one step at a time is a real, observable state (`paused`, distinct from `awaiting_approval`) a run can sit in indefinitely.

### 2. Workflows reuse the existing Tier/Approval machinery — no parallel gating system

A workflow step's `capability` field (present only on steps that touch something outside AIMA's own straightforward internal state) is resolved through the same `ApprovalEngine.evaluate`/`get` calls every other gated action uses. When a step's capability resolves to `requires_approval` (Tier 3), `executeNextStep` creates a real `pending_approvals` row, sets the run to `awaiting_approval`, and returns *without ever invoking the step's handler* — the handler only runs once `resume()` re-checks (fresh, via `ApprovalEngine.get()`, never trusted from creation time) that the approval was actually granted. This was a deliberate rejection of building workflow-specific approval state: a `workflow_step_runs.pending_approval_id` column pointing at a real `pending_approvals` row means the Approvals screen, the chat approval card, and the Workflows detail screen all show the *same* underlying record — there's exactly one lifecycle for "does the user need to confirm this," not two systems that could drift.

### 3. Four workflows, each exactly two steps, deliberately spanning every gating shape that exists

- `draft_email_reply`: compose (internal) → save via `draft_email` (Tier 2/prepare, auto-executes).
- `create_github_issue_draft`: compose (internal) → save via a new `draft_github_issue` capability (Tier 2/prepare, auto-executes).
- `summarize_unread_email`: read via `read_email` (Tier 3/execute_with_approval, **genuinely pauses**) → summarize (internal).
- `daily_workspace_briefing`: gather a snapshot (internal, aggregating `TaskService`/`ApprovalEngine`/`HealthService`) → compose (internal) — nothing to approve at all.

This spread was chosen specifically so the engine's step-execution framework, approval-checkpoint framework, and "some steps have no capability at all" case are all genuinely exercised by real workflows rather than by synthetic test fixtures alone. `summarize_unread_email` is also notable as the first real caller of Phase 2.3's `read_email` capability and `IntegrationService.getDecryptedCredentials` — both existed with no caller since Phase 2.3 shipped, the same "gate exists before anything walks through it" precedent `send_email` has held since Phase 1.4.

### 4. `create_github_issue_draft` needed a new capability, not a reuse of an existing one

`draft_github_issue` (Tier 2/prepare) is a new capability distinct from the pre-existing GitHub-read capabilities, because it writes to AIMA's own `drafts` table only — the read-only GitHub integration (Phase 2.3, by design) has no write capability, so "creating a GitHub issue draft" can never mean actually creating anything on GitHub. This mirrors `0011`'s ADR #2 distinction between `draft_email` (Tier 2, writes to AIMA's own `drafts`) and `draft_gmail_email` (Tier 3, would write into a connected Gmail account) — same reasoning, applied to a new provider and a new draft type (`github_issue`, added to the existing `draft_type` enum via `ALTER TYPE ... ADD VALUE`).

### 5. `WorkflowIntentMatcher` is advisory-only and lives in `backend/`, not `ai-engine/`

A workflow suggestion attached to a chat response never creates or executes a `WorkflowRun` — it's a `WorkflowSuggestion` the user can act on separately, the same "detect, don't act" boundary `IntentEngine` (Phase 1.4) has always drawn between classifying intent and actually doing something. Unlike `ai-engine`'s `RuleBasedIntentClassifier`, `WorkflowIntentMatcher` lives in `backend/src/workflows/` rather than `ai-engine/`, because it depends on `WorkflowRegistry` — a backend-only concept the AI-abstraction layer has no reason to know about. It was wired into `ConversationService` (a deps-object constructor, low blast radius to extend) rather than `AimaCoreService` (a positional-argument constructor with roughly a dozen call sites) — the matcher only ever needs the raw message text, so it didn't need access to anything `AimaCoreService` uniquely provides.

### 6. `workflow_runs.sequence` — the fourth occurrence of the same frozen-`now()` fix

Postgres freezes `now()` at transaction start under READ COMMITTED, so timestamp-only ordering ties for rows touched in the same transaction — the same bug already fixed for `messages.sequence` (0003), `pending_approvals.sequence` (0006), and `conversations.sequence` (0010). `workflow_runs` gets the identical `BIGSERIAL sequence` treatment for the same reason: the Workflows screen's run history needs a stable "most recent first" ordering that survives a run being created and then immediately advanced within the same request.

### 7. `workflow_step_runs.pending_approval_id` needed `ON DELETE SET NULL`, not the schema default

A real bug, found via a failing route test rather than by inspection: with the FK left at its default `RESTRICT`, deleting a workspace (which cascades through `workspaces → pending_approvals` directly, and separately through `workspaces → workflow_runs → workflow_step_runs`) failed, because Postgres resolves those as two independent cascade chains and the un-cascaded `workflow_step_runs → pending_approvals` edge blocked the delete regardless of ordering between the other two chains. Fixed by making that one FK `ON DELETE SET NULL` — a step run that outlives its approval (because the workspace, and therefore the approval, was deleted) simply loses the pointer rather than blocking the delete.

## Consequences

- `read_email` (Tier 3, registered since Phase 2.3) now has a real caller for the first time, exercising the full Tier 3 pause-for-approval path against `StubGmailConnector`'s deterministic data — `draft_gmail_email`/`read_repositories`/`read_calendar` remain registered with no caller, the same "ready but not yet exercised" state as before.
- No new scheduler, queue, or background worker exists or is implied by this phase — `executeNextStep` is deliberately request-driven and single-step, so "run this workflow unattended" remains a decision for a later phase to make deliberately, not something that fell out of this one by accident.
- `apps/Shared/AIMACore`'s test suite grew from 68 to 91 tests: workflow model decoding, the seven new `URLSessionAPIClient` routes, and `WorkflowsViewModel`'s full state-machine coverage (one-step-at-a-time execution, the Tier 3 pause/approve/resume path, rejected-approval failure, pause/resume, cancel-with-skip, and the "cancel a terminal run" error path) against `MockAPIClient`'s in-memory reimplementation of the same state machine.
- Backend test coverage grew with the new `workflows/` module's own suite (registry, intent matcher, all four handlers, the full `WorkflowService` state machine) plus `routes/workflows.test.ts`, bringing the backend suite to 295 tests, all passing alongside the full existing regression suite.
- The Workflows screen (`apps/macos/Sources/AIMA/Views/Workflows/`) renders whatever step list and status the server returns — no per-workflow knowledge is hardcoded client-side, consistent with `WorkspaceIntegration.requiredCredentialFields`'s "server is the single source of truth for structure" precedent from Phase 2.3.
