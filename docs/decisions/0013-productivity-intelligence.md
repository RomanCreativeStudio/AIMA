# ADR 0013: Productivity Intelligence

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §3, `backend/src/insights/`, `backend/src/actionLog/`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Through Phase 2.4, AIMA could execute multi-step workflows and track their state, but had no way to summarize "what does this workspace look like right now" without a client stitching together several separate list calls itself. Phase 2.5 asked for that summarization layer — a Daily Briefing, Task Intelligence, Conversation Intelligence, and Workspace Insights — with three hard rules: read-only, no automatic actions, and the existing approval model and workspace isolation both untouched.

The central design question this phase had to answer: does "Daily Briefing" mean a fifth thing built on the Phase 2.4 workflow engine (a `workflow_runs` row, execution state, pause/resume), or a sixth, entirely separate kind of read? The two are easy to conflate — Phase 2.4 already shipped a `daily_workspace_briefing` *workflow* with a `gather_snapshot`/`compose_briefing` step pair that does something similar.

## Decisions

### 1. `BriefingService` is a plain aggregate query, not a workflow — and both now coexist deliberately

`GET /api/workspaces/:id/briefing` calls `BriefingService.getDailyBriefing`, which composes `WorkspaceService`/`TaskService`/`ApprovalEngine`/`WorkflowService`/`ActionLogger` and returns a result synchronously, with no `workflow_runs` row, no execution state, and no side effects at all. This was a deliberate rejection of extending the Phase 2.4 `daily_workspace_briefing` workflow instead: that workflow's `gather_snapshot`/`compose_briefing` steps exist to demonstrate the workflow engine's "some steps have no capability at all" case and to produce one AI-composed paragraph — reusing it for a UI card that needs live, structured, always-current data (not a paragraph fetched from whatever the last completed run happened to compute) would have meant either polling a stale run or silently starting a new one on every Dashboard load, which is exactly the kind of implicit automatic execution this phase's own rules forbid. The two now serve genuinely different purposes: the workflow is something a user explicitly starts and steps through once; the briefing is something the Dashboard re-fetches every time it's opened, with zero persistence of its own.

### 2. Task Intelligence is deliberately deterministic — no AI call

`TaskIntelligenceService` and its pure helpers (`backend/src/insights/taskAnalysis.ts`: `scoreTaskPriority`, `rankTasksByPriority`, `findOverdue`, `findDueSoon`, `groupRelatedTasks`) never touch the `AIProvider`. Suggested priority is a deterministic score (overdue beats due-soon beats a bare declared priority, ties broken by due date then creation order); related-task grouping is keyword-overlap on titles, not embedding similarity. This mirrors the precedent set by `chunking.ts` (deterministic document splitting) and `WorkflowIntentMatcher` (rule-based, not model-based): where a plain, testable heuristic is good enough and avoids nondeterministic output for a feature users will come to rely on as consistent, that's what gets built. `BriefingService`'s "priority tasks" list reuses the exact same `rankTasksByPriority` function — one ranking algorithm, not two that could quietly diverge.

### 3. Conversation Intelligence is the one piece that genuinely needs the AI provider

Unlike task ranking, "what should the user ask next" and "summarize this conversation" have no deterministic substitute — `ConversationIntelligenceService` calls `AIProvider.complete()` twice (summary, follow-ups) and `MemoryService.getWorkspaceContext` once (related memories, keyed off the conversation's last user message). This is also the one Productivity Intelligence feature the macOS client surfaces behind an explicit action — a "Summarize Conversation" button (`ChatViewModel.loadConversationIntelligence`) — rather than loading it automatically alongside every message, specifically because it costs a real AI call and produces content (follow-up suggestions) a user might reasonably not want generated on every single turn. Task Intelligence and Workspace Insights, being cheap deterministic reads, load automatically with the Dashboard; Conversation Intelligence does not load automatically with Chat.

### 4. `ActionLogger` gains its first read methods — and immediately needed the same sequence-column fix as four tables before it

`ActionLogger.list`/`countByOutcome` are new (`action_log` previously had only `log`, a write). `list`'s first implementation ordered by `created_at DESC, id DESC`, on the reasoning that a display-only "recent activity" feed didn't need the same ordering rigor as `pending_approvals`/`workflow_runs`. That reasoning was wrong in exactly the way the ADR history already documents: a test logging two entries in the same transaction hit the frozen-`now()` problem (`created_at` identical under READ COMMITTED), and `id` — a random UUID, not a sequence — doesn't preserve insertion order as a tiebreaker. `database/migrations/0013_action_log_sequence.sql` adds the same monotonic `sequence` column already used for `messages` (0003), `pending_approvals` (0006), `conversations` (0010), and `workflow_runs` (0012) — the fifth table to need it, and a reminder that "this ordering doesn't really matter" is not a safe assumption to make about any table `ActionLogger` writes to, however casual the reader.

### 5. Workspace Insights returns aggregate counts only, never row-level detail

`WorkspaceInsightsService.getInsights` returns `ActivityMetrics`/`WorkflowMetrics`/`ApprovalMetrics`/`TaskCompletionMetrics` — all totals and breakdowns, no individual approvals, tasks, or log entries. Anywhere a client needs the actual items (not just the count), it already has a dedicated endpoint (`listApprovals`, `listTasks`, `listWorkflowRuns`, `BriefingService`'s own row-level fields) — Workspace Insights exists specifically to be cheap enough to compute on every Dashboard load without those endpoints' full payload, so it was kept to what a metrics widget actually needs.

### 6. No new capability, no new gate — every Productivity Intelligence route is a plain, ungated `GET`

None of the four new routes call `PermissionEngine`, create a `pending_approvals` row, or log to `ActionLogger` — matching the existing precedent of other pure-read endpoints (`listTasks`, `listApprovals`, `listWorkflowRuns`) rather than treating "AI looked at your data and summarized it" as an action requiring the same approval machinery as "AI is about to send an email." This is a deliberate reading of the Product Bible's permission model: the tiers exist to gate AIMA *doing* something, and reading + summarizing what's already inside AIMA's own database isn't a new capability class, it's the same category of read every dashboard has always performed, just aggregated. Workspace isolation is unaffected: every service method still takes `workspaceId` and resolves through the same `assertWorkspaceExists`/scoped-`WHERE` pattern every other service uses, with no new isolation logic introduced or bypassed.

## Consequences

- `apps/Shared/AIMACore`'s test suite grew from 91 to 107 tests, covering the four new model families (`Memory`, `ActionLogRecord`, `Briefing`, `TaskIntelligence`, `ConversationIntelligence`, `WorkspaceInsights`), the four new `URLSessionAPIClient` routes, and `DashboardViewModel`/`ChatViewModel`'s new loading behavior against `MockAPIClient`'s reimplementation of the backend's deterministic ranking/grouping/aggregation logic — not canned fixtures.
- Backend test coverage grew with `backend/src/insights/`'s own suite (pure `taskAnalysis.ts` unit tests plus DB-backed service tests for all four services) and `routes/insights.test.ts`, plus `actionLog/logger.test.ts` (the module's first tests at all), bringing the backend suite to 338 tests.
- The Dashboard now performs seven concurrent reads on load (workspace, health, approvals, tasks, briefing, task intelligence, insights) via `async let` — acceptable for an MVP single-workspace screen; if this ever becomes a real latency concern, the fix is a single composite backend endpoint, not fewer reads client-side, since each one is independently useful elsewhere (Tasks screen, Approvals screen, Workflows screen).
- `MemoryRecord`/`RankedMemoryResult` exist in `AIMACore` for the first time — `SendMessageResult.retrievedMemories` stayed a loosely-typed `[JSONValue]` since Phase 2.1 specifically because nothing needed a fixed shape until Conversation Intelligence's related memories did.
- No backend schema changed except `action_log` (one additive column). Nothing in `workspaces`, `tasks`, `pending_approvals`, or `workflow_runs` was touched — this phase reads existing tables, it doesn't reshape them.
