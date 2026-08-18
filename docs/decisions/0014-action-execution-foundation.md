# ADR 0014: Action Execution Foundation

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3, §4, §5, `backend/src/execution/`, `backend/src/integrations/`, `backend/src/permissions/registry.ts`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Through Phase 2.5, AIMA could gate, log, and reason about actions — the Approval Engine, Workflow Engine, Integration Framework, and Capability Registry all existed — but nothing actually *executed* a real external action end-to-end: `send_email` (Tier 3 since Phase 1.4) and `draft_gmail_email` (Tier 3 since Phase 2.3) were registered capabilities with no caller, and GitHub's integration was explicitly documented as read-only by design (ADR 0011 #2, ADR 0012 #4). Phase 2.6 asked for a secure execution layer built entirely on the existing machinery — no redesign — with executors for Gmail (Send Email, Save Draft) and GitHub (Create Issue, Create Pull Request), explicit approval enforcement before contacting any provider, and workflow/conversation integration that only ever previews or suggests, never auto-executes.

The central tensions this phase had to resolve:

1. The phase's own concrete deliverable — GitHub write executors — directly contradicts two prior ADRs' explicit "read-only by design" statements.
2. This environment has no real Gmail/GitHub OAuth credentials and cannot make live API calls, yet the phase's approval-enforcement and execution-state goals need to be genuinely testable.
3. A naive "execute this action" call risks becoming exactly the kind of automatic, unattended execution every prior phase has deliberately avoided.

## Decisions

### 1. GitHub gains two new write capabilities — an explicit founder instruction supersedes the prior "read-only by design" ADRs, not an ambiguous design choice made here

ADR 0011 #2 and ADR 0012 #4 both state the GitHub integration is read-only by design, with no write capability. Phase 2.6's prompt explicitly and unambiguously asked for "GitHub: Create Issue, Create Pull Request... Use the existing Integration Framework." This is treated as the founder's own decision to supersede that earlier design via direct instruction — not an architecture decision left to be inferred — so two new Tier 3, tier-locked capabilities were registered: `create_github_issue` and `create_github_pull_request`, distinct from the pre-existing `draft_github_issue` (Tier 2, writes only to AIMA's own `drafts` table, unaffected by this change). `StubGitHubConnector` gained matching `createIssue`/`createPullRequest` methods. The prior ADRs' text is superseded by this one, not edited retroactively — the history of "why read-only, then why not" is worth keeping.

### 2. `execute()` advances at most one attempt per call and is idempotent on a terminal record — the same structural fix ADR 0012 used for "no automatic execution"

`ExecutionService.execute(workspaceId, executionId)` checks `TERMINAL_EXECUTION_STATUSES.includes(execution.status)` first and short-circuits to return the stored record with zero provider contact if already `succeeded`/`failed`. There is no `executeToCompletion` or retry-loop method. This mirrors `WorkflowService.executeNextStep`'s "one step per call" design (ADR 0012 #1) for the same reason: it makes "no automatic execution" and "idempotent where practical" (both explicit Phase 2.6 requirements) structural properties of the API surface, not policies a caller has to remember. Proven in tests via a `CountingExecutor` test double whose `callCount` stays `1` across repeated `execute()` calls after success.

### 3. Approval is always re-checked fresh at execute time, never trusted from creation time

`execute()` calls `approvalEngine.get()` on every invocation when the execution is `awaiting_approval` — never reads a cached decision captured when the execution was created. This is the same "never trust cached approval state" pattern ADR 0012 #2 established for `WorkflowService.resume()`. It also means a mid-flight integration disconnect is caught: `runExecutor` re-resolves credentials via `IntegrationService.getDecryptedCredentials` immediately before calling the executor, so an integration disconnected after approval but before execution fails cleanly (`failed`, "Integration not connected") instead of using stale credentials.

### 4. `createExecutionRequest` rejects an unconnected integration before creating anything — not just before executing

Per the phase's explicit requirement ("Reject unauthorized execution before contacting providers"), `createExecutionRequest` checks `isIntegrationConnected` before ever inserting an `executions` row or evaluating approval. This is stricter than `execute()`'s later re-check (Decision 3): a request for a disconnected provider never gets a database row or a `pending_approvals` entry at all, rather than getting created and then failing at execute time. The two checks exist at different points because they answer different questions — "should this request even be created" versus "is it still safe to run right now."

### 5. All four executors remain deterministic stubs — no live network calls, consistent with the Phase 2.3 precedent

`GmailSendEmailExecutor`/`GmailSaveDraftExecutor`/`GitHubCreateIssueExecutor`/`GitHubCreatePullRequestExecutor` all call into `StubGmailConnector`/`StubGitHubConnector`'s new write methods, which validate credentials via the existing `testConnection` and validate input shape, then return synthesized IDs via `randomUUID()` — no real HTTP calls. This resolves tension #2 above the same way ADR 0011 did: registering a real OAuth app and completing a consent flow is outside this environment's scope, but the framework, approval enforcement, and execution-state tracking this phase actually asked for are all genuinely meaningful and testable against deterministic stubs. Replacing these with live clients is called out explicitly as Integration Sprint work, not a gap in this phase.

### 6. `ExecutionIntentMatcher` is allowed to co-fire with `WorkflowIntentMatcher` on the same message — no dedup logic was built

Both matchers run independently in `ConversationService.sendMessage`; a single message can attach both a `WorkflowSuggestion` and an `ExecutionSuggestion`. No collision-avoidance or precedence logic exists between them, by design: both are purely advisory previews that never themselves create or run anything, so two harmless suggestions on one message carries no risk that would justify the added complexity of deciding which one "wins."

### 7. `executions.sequence` is a `BIGSERIAL` from the migration's first draft, not a later fix

Postgres freezes `now()` at transaction start under READ COMMITTED, so timestamp-only ordering ties for rows touched in the same transaction — the same bug already fixed for `messages` (0003), `pending_approvals` (0006), `conversations` (0010), `workflow_runs` (0012), and `action_log` (0013). Rather than repeat the pattern of shipping a table without it and fixing it in a follow-up migration, `0014_executions.sql` includes `sequence BIGSERIAL` and its supporting index from the start — the sixth table to need this, and the first to get it proactively.

## Consequences

- `send_email` (registered since Phase 1.4) and `draft_gmail_email` (registered since Phase 2.3) both get their first real callers this phase, exercising the full Tier 3 approval-then-execute path against stub data. `read_repositories`/`read_calendar` remain registered with no caller — the same "ready but not yet exercised" state.
- No autonomous agents, scheduled execution, background workers, automatic retries, streaming execution, or multi-action execution exist or are implied by this phase — every execution is a single, explicit, approval-gated request, consistent with every prior phase's same rule.
- Backend test suite grew to 383 tests (from 338): the new `execution/` module's own suite (registry, intent matcher, all four executors, the full `ExecutionService` state machine including the idempotent-retry proof), extended connector tests for the four new stub write methods, and `routes/executions.test.ts`'s full HTTP-level lifecycle coverage, plus mechanical `ConversationService`/`app.ts` wiring updates across every existing route test file.
- `apps/Shared/AIMACore`'s test suite grew with execution model decoding, five new `URLSessionAPIClient` routes, and `ExecutionsViewModel`'s full state-machine coverage (success, validation failure, approval required, approval denied, provider failure via a mid-flight disconnect, idempotent retry, and workspace isolation) against `MockAPIClient`'s in-memory reimplementation of `ExecutionService`.
- The Executions screen (`apps/macos/Sources/AIMA/Views/Executions/`) always routes a new execution through a preview and a confirmation dialog before creating anything, and through a separate explicit "Execute" action afterward — mirroring the backend's three-step split (preview → create → execute) at the UI layer, not just the API layer.
