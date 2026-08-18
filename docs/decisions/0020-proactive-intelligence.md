# ADR 0020: Proactive Intelligence

**Status:** Decided
**Date:** 2026-07-28
**Relates to:** `docs/decisions/0013-productivity-intelligence.md`, `docs/decisions/0019-advanced-memory-system.md`, `ai-engine/src/proactive/`, `backend/src/proactive/`, `backend/src/insights/briefingService.ts`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Phases 1.6–3.4 built a workspace's real intelligence surfaces — memory, knowledge retrieval, workflows, executions, live integrations, and Productivity Intelligence's read-only Daily Briefing/Task Intelligence/Workspace Insights. Phase 3.5 asks for the layer on top: detect patterns already sitting in that data (repeated tasks, frequently used workflows, recurring approvals, missed deadlines, activity/memory trends) and turn a curated subset of them into explainable, ranked suggestions — while the phase's own final requirements repeat, almost word for word, every safety invariant this codebase has built up so far: no autonomous execution, no automatic messages, no automatic workflow execution, no automatic memory creation, workspace isolation, approval boundaries. Every decision below is designed around detecting and explaining, never acting.

## Decisions

### 1. Pattern detection is generic and backend-agnostic in `ai-engine`; the backend-domain mapping lives in `backend/`

`ai-engine/src/proactive/` knows nothing about tasks, workflows, or approvals — it operates on a plain `OccurrenceEvent { key, occurredAt }` and two counts for trend comparison. `detectRecurringPatterns()` groups by `key` and reports every key that recurred at least `minOccurrences` times; `detectTrend()` compares two already-windowed counts. This single generic function is what "repeated tasks," "frequently used workflows," and "recurring approvals" all reduce to — `backend/src/proactive/patternDetectionService.ts` just feeds it a different key extractor per pattern (task-title keyword via the existing Phase 2.5 `extractKeywords`/`groupRelatedTasks`, `workflowKey`, `actionType`), and adapts the results into the backend's richer `Pattern` type. This mirrors the `RuleBasedIntentClassifier`/`RuleBasedMemoryExtractor` precedent of keeping the reusable logic provider-abstraction-generic while domain adaptation stays where the domain types live.

### 2. Missed deadlines and repeated tasks reuse Phase 2.5's `taskAnalysis.ts` directly, rather than re-deriving the same logic

`findOverdue()` and `groupRelatedTasks()` already existed for Task Intelligence (Phase 2.5). `PatternDetectionService.detectMissedDeadlines`/`detectRepeatedTasks` call them as-is — the "missed deadline" and "repeated task" patterns are literally the same computation Task Intelligence already surfaces, just re-packaged as a `Pattern` with a confidence score. No duplicated keyword-extraction or overdue logic exists anywhere in this phase.

### 3. Confidence is always derived from a concrete signal — occurrence count or trend sample size — never a fixed guess per pattern type

`computeRecurrenceConfidence(occurrences, minOccurrences)` starts at 0.5 exactly at the threshold and grows toward 1 as occurrences climb further past it, capped at 1, and returns 0 below threshold (so a pattern is never reported without having actually met its own bar). Trend confidence (`computeTrendConfidence`) scales with the combined sample size across both windows — a "trend" computed from one event total is reported with low confidence, not asserted as fact. This is the phase's "Return confidence scores... No ML training" requirement satisfied by arithmetic over real counts, not a model.

### 4. Suggestions are a curated, explainable subset of patterns — not every pattern becomes a suggestion

`ProactiveIntelligenceService.getSuggestions()` maps `frequent_workflow` → a `workflow` suggestion, `recurring_approval` → an `execution` suggestion, `repeated_task`/`missed_deadline` → `task` suggestions — a direct, traceable one-to-one mapping, each carrying the originating pattern's `description` as its `explanation` and the pattern's `confidence` unchanged. `activity_trend`/`memory_usage_trend` are reported via `detectPatterns()` but never turned into a suggestion — a trend by itself doesn't imply one specific next action, so forcing it into the fixed `workflow`/`execution`/`memory`/`task`/`integration` suggestion-type set would fabricate specificity the data doesn't support.

### 5. Memory suggestions come from matching a repeated-task keyword against existing memories, bounded to a handful of lookups

For up to `MAX_MEMORY_LOOKUPS` (3) `repeated_task` patterns, `ProactiveIntelligenceService` calls the existing `MemoryService.search()` with the pattern's keyword and only surfaces a `memory` suggestion if the top result's relevance score clears `MEMORY_MATCH_THRESHOLD` (0.5) — reusing Phase 3.4's blended relevance score (similarity/importance/confidence) rather than inventing a new one. The bound keeps this to a small, predictable number of embedding calls per request, and the threshold keeps a weak match from being reported as a confident recommendation.

### 6. Integration suggestions are a flat, always-current check — not pattern-derived, and deliberately lower-confidence

Any of the three fixed providers not currently `connected` (per the existing `IntegrationService.listForWorkspace`, which already returns a placeholder row for every provider) gets a `integration` suggestion at a fixed, modest confidence (0.3). This isn't a "pattern" in the recurrence/trend sense — it's a standing fact about the workspace's configuration — so it's computed independently of `PatternDetectionService` and deliberately given lower confidence than any pattern-backed suggestion, so ranking naturally surfaces genuine behavioral patterns first.

### 7. `calendarHighlights` never calls the live Calendar connector — `read_calendar` is Tier 3 and tier-locked

The Daily Briefing gained `recentMemories`/`calendarHighlights`/`suggestedNextActions` (Phase 3.5, item 2). `recentMemories` is a plain `MemoryService.listMemories` read — no approval concern. But `read_calendar` (`backend/src/permissions/registry.ts`) is permanently locked at Tier 3 minimum: "External account data." A synchronous, ungated `GET .../briefing` calling `CalendarConnector.listEvents()` directly would bypass that lock entirely — the exact kind of authority a plain report must never have. `calendarHighlights` is instead derived from `recentActivity`'s already-fetched entries, filtered to the three calendar *write* action types (`create_calendar_event`/`update_calendar_event`/`delete_calendar_event`) — each of which only ever reached `action_log` after already passing Tier 3 approval and execution. The briefing surfaces *consequences of approved actions*, never a fresh, unapproved read of external data.

### 8. `BriefingService` gains two new optional trailing constructor parameters — the same no-test-ripple pattern as `memoryExtractor` (Phase 3.4)

`memoryService`/`proactiveIntelligenceService` are optional positional parameters defaulting to `undefined`; when absent, `recentMemories`/`suggestedNextActions` are simply empty arrays. `BriefingService` is constructed positionally (not a deps object) in roughly 15 existing test files that only need it to exist for router wiring, not to test its output — making the new dependencies optional means none of those files needed updating, while `briefingService.test.ts` and the real `index.ts` wiring get the full behavior by passing them explicitly.

### 9. `ProactiveIntelligenceService`/`PatternDetectionService` are new, optional `AppDependencies`/`AppDependencies` fields — the `/proactive/*` routes mount conditionally

Following the same pattern Phase 3.1's `nodeEnv`/`logger`/`errorReporter` established: `proactiveIntelligenceService` is an optional field on `AppDependencies`, and `app.ts` only mounts `proactiveRouter` when it's present. Every existing route test file's `createApp({...})` call keeps compiling unchanged; only `index.ts` (real wiring) and the new `routes/proactive.test.ts` need to supply it.

### 10. AIMACore adds genuinely new models (`Suggestion`, `Pattern`) rather than overloading existing ones, and extends `DailyBriefing` the same way Phase 3.4 extended `MemoryRecord`

`Suggestion`/`Pattern` mirror the backend's `Suggestion`/`Pattern` types exactly — there was nothing pre-existing to conflate them with. `DailyBriefing` gains `recentMemories`/`calendarHighlights`/`suggestedNextActions` via a custom `init(from:)` that `decodeIfPresent`s each and defaults to `[]`, so a payload from before this phase (including the existing `ModelDecodingTests` fixture) still decodes — the same backward-compatible-decode posture `SendMessageResult.memorySuggestions` established in Phase 3.4. A new `SuggestionsViewModel` backs a dedicated, filterable view of the full pattern/suggestion set, while `DashboardViewModel` gains its own `patterns`/`suggestions` properties (the *full* lists, not the briefing's capped top-3) and `ChatViewModel`/`WorkspaceViewModel` each gain one explicit-only, on-demand fetch (`loadWorkspaceSuggestions`/`loadActivitySummary`) — never auto-fetched, mirroring `loadConversationIntelligence`'s "no automatic actions" rule exactly.

### 11. macOS renders every suggestion as an inline card — no popups, no notifications, nothing dismissible-as-if-urgent

The Dashboard's Recommendations/Pattern Insights sections and Chat's `RecommendationsCardView` are plain, scrollable, inline content — the same visual language as the existing Daily Briefing/Conversation Intelligence cards, appearing only when data exists and only after an explicit load. Nothing uses `.alert`, `.sheet` as an interruption, `NSUserNotification`, or any other attention-grabbing mechanism — satisfying "No popup interruptions. No background notifications." as a structural property of the views, not a policy someone has to remember to follow.

## Consequences

- `ai-engine`'s test suite grew from 51 tests (Phase 3.4) to 66: a new `proactive/` module (`patternEngine.test.ts`, `ranking.test.ts`) covering recurrence detection, confidence bounds, trend direction/change-ratio, and divide-by-zero safety.
- `backend/`'s test suite grew from 540 tests (Phase 3.4) to 570: `patternDetectionService.test.ts` (all six pattern types, workspace isolation), `proactiveIntelligenceService.test.ts` (all five suggestion types, ranking order, workspace isolation), extended `briefingService.test.ts` (recentMemories/calendarHighlights/suggestedNextActions, both present and defaulted-empty), and `routes/proactive.test.ts` (both new routes, validation, 404 mapping).
- `apps/Shared/AIMACore`'s test suite grew from 176 tests (Phase 3.4) to 189: new `SuggestionsViewModelTests`, extended `DashboardViewModelTests`/`ChatViewModelTests`/`WorkspaceViewModelTests`, and new `ModelDecodingTests`/`URLSessionAPIClientTests` cases for `Suggestion`/`Pattern`/the extended `DailyBriefing`.
- The macOS app's module boundary was re-verified the same way ADR 0009/0017/0018/0019 established: `swift build` inside `apps/macos` fails only on `no such module 'SwiftUI'`, confirming the new Dashboard sections, `SuggestionRow`/`RecommendationsCardView`, and the Workspace screen's Activity Summary introduce no other compile error.
- No autonomous execution was added: nothing in `PatternDetectionService`/`ProactiveIntelligenceService` writes to any table, creates a task/workflow run/execution/memory, or connects an integration. Every method is a plain read composed from services that already existed.
- No automatic messages: suggestions and patterns are only ever returned from an explicit `GET` request; the Daily Briefing's `suggestedNextActions` is populated the same synchronous way the rest of the briefing already was, with no new send/notify path.
- Workspace isolation and the existing approval system are both unchanged — every proactive read still goes through the workspace-scoped services that enforce them, and `calendarHighlights`' design decision (item 7 above) exists specifically to keep the Tier 3 `read_calendar` lock intact.
