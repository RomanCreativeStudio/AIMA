# AIMA — macOS App

Status: **Productivity Intelligence built (Phase 2.5).** Not yet usable end-to-end without a Mac + Xcode to build it — see "Known limitation" below.

A native SwiftUI application built with Swift Package Manager (no `.xcodeproj` — open this folder's `Package.swift` directly in Xcode via **File > Open...**; Xcode treats a `swift-tools-version` manifest as a first-class project). Talks only to `backend/`'s API — no direct database or AI provider access, per the thin-client rule in `docs/TECHNICAL_ARCHITECTURE.md` §2.

## Structure

- **`Package.swift`** — an executable target (`AIMA`) depending on `../Shared/AIMACore`. macOS 14+ only.
- **`Sources/AIMA/AIMAApp.swift`** — the `@main` entry point; builds the single `DependencyContainer` for the process.
- **`Sources/AIMA/DependencyContainer.swift`** — the composition root (dependency injection, item 1): owns the one `APIClient` instance (real `URLSessionAPIClient` or `MockAPIClient`, chosen via `AIMA_USE_MOCK_API`/`AIMA_API_BASE_URL`/`AIMA_USER_ID` environment variables until real auth exists), and is the only place that constructs view models.
- **`Sources/AIMA/Navigation/RootNavigationView.swift`** — the navigation architecture (Phase 2.1, item 1): a `NavigationSplitView` sidebar switching between the eight main screens, owning the single `WorkspaceViewModel` shared by every screen that needs to know the active workspace.
- **`Sources/AIMA/Views/`** — the eight main screens:
  - `Dashboard/DashboardView.swift` — current workspace, system status, pending approvals (with inline approve/reject), task overview, plus three Phase 2.5 sections: a Daily Briefing card (pending approvals/active workflows/priority tasks/recent activity), Productivity widgets (due-soon/overdue counts, related-task groups), and Workspace Insight cards (activity/workflow/approval/task-completion metrics) — all read-only, re-fetched every time the screen loads.
  - `Chat/ChatView.swift` (+ `ConversationListView`, `MessageListView`, `MessageInputView`, `ApprovalCardView`, `WorkflowSuggestionCardView`, `ConversationIntelligenceCardView`) — conversation list, message history rendered as Markdown, message input, AI responses, an inline approval card (Phase 2.2, item 3) when the AI's response requires one, an advisory workflow-suggestion card (Phase 2.4, item 4) when the message matches a built-in workflow — purely informational, it never starts a run itself — and a "Summarize Conversation" button (Phase 2.5, item 3) that fetches a summary, suggested follow-ups, and related memories on explicit request only, never automatically alongside a message.
  - `Tasks/TasksView.swift` (Phase 2.2, item 4) — every task in the active workspace, filterable by status, each row showing a color-coded priority indicator.
  - `Approvals/ApprovalsView.swift` (+ `ApprovalsListView`, `ApprovalDetailView`, Phase 2.2, item 3) — a full, filterable approvals list plus a detail pane (payload, timestamps, approve/reject) — a fuller view than the Dashboard's pending-only quick list.
  - `Integrations/IntegrationsView.swift` (+ `IntegrationCardView`, `CredentialEntrySheet`, Phase 2.3, item 5) — a card per fixed provider (Gmail/GitHub/Calendar) showing connection status and capability display, plus connect/disconnect/rotate actions; the credential sheet is built dynamically from `WorkspaceIntegration.requiredCredentialFields`, not hardcoded per provider.
  - `Workflows/WorkflowsView.swift` (+ `WorkflowsListView`, `WorkflowDetailView`, `NewWorkflowRunSheet`, `WorkflowStatusPills`, Phase 2.4, item 5) — a two-pane layout: the four built-in workflows (each startable via a freeform key/value input sheet, since `WorkflowDefinition` carries no declared field list) plus run history on the left, the selected run's step-by-step progress, approval checkpoints, and execute-next-step/pause/resume/cancel actions on the right. "Execute Next Step" only ever advances one step per tap, mirroring the backend's `WorkflowService`.
  - `Workspace/WorkspaceSwitcherView.swift` — switch between Personal, Roman Creative Studio, Mythic Forge Studios, Development.
  - `Settings/SettingsView.swift` — backend connection, user preferences, configuration.

All business logic, typed models, networking, and view models live in `../Shared/AIMACore` — this target is a thin SwiftUI presentation layer over it, consistent with every other AIMA client.

## Known limitation: Xcode/macOS required, not available in this repo's dev environment

This target `import`s SwiftUI/AppKit and can only be built, run, or previewed with Xcode on macOS. The environment this and the prior phase were built in is Linux-only (no Xcode), so:
- **Not verified here:** a real `swift build`/`xcodebuild` of this target, and SwiftUI Previews actually rendering.
- **Verified here instead:** `../Shared/AIMACore` (models, networking, view models — everything this app's logic actually depends on) builds and its full test suite passes via `swift test` on Linux (see `../Shared/AIMACore/README.md`). Running `swift build` for *this* package on Linux fails with exactly one distinct error, `no such module 'SwiftUI'` (repeated per file) — confirming the split is clean: nothing platform-agnostic leaked into this target, and nothing here has a logic bug hiding behind the platform mismatch.
- **A specific Phase 2.2 exception:** `MessageBubble`'s Markdown rendering (`AttributedString(markdown:)`) had to live in *this* target rather than `AIMACore`, because that initializer doesn't exist at all in the Linux Foundation this repo's toolchain ships (confirmed by a failed trial build, not just an untested code path) — it's a real Apple-Foundation-only API, not merely an untested one. It's the one piece of Phase 2.2 that couldn't even be given Linux-side test coverage; everything else new this phase (`ApprovalsViewModel`, `TasksViewModel`, `ChatViewModel`'s approval-card handling, `JSONValue.displayString`) is fully covered by `AIMACoreTests`.
- **Phase 2.3 hit no such exception:** the Integrations screen's logic (`IntegrationsViewModel`, credential validation, the dynamic form's field list) is ordinary Swift/Foundation with no SwiftUI-only dependency, so it's fully covered by `AIMACoreTests` — only the views themselves (`IntegrationsView`/`IntegrationCardView`/`CredentialEntrySheet`) share Phase 2.1's general "SwiftUI can't compile on Linux" limitation, not a deeper one.
- **Phase 2.4 likewise hit no exception:** `WorkflowsViewModel`'s full one-step-at-a-time state machine (create/execute/pause/resume/cancel, including the Tier 3-gated `summarize_unread_email` pause-for-approval path) is ordinary Swift/Foundation and fully covered by `AIMACoreTests` against `MockAPIClient`'s in-memory reimplementation of the backend's state machine; only the views (`WorkflowsView`/`WorkflowsListView`/`WorkflowDetailView`/`NewWorkflowRunSheet`/`WorkflowStatusPills`/`WorkflowSuggestionCardView`) share the general SwiftUI-on-Linux limitation.
- **Phase 2.5 likewise hit no exception:** `DashboardViewModel`'s Daily Briefing/Task Intelligence/Workspace Insights loading and `ChatViewModel.loadConversationIntelligence` are ordinary Swift/Foundation, fully covered by `AIMACoreTests` against `MockAPIClient`'s reimplementation of the backend's deterministic ranking/grouping/aggregation logic; only the new Dashboard sections and `ConversationIntelligenceCardView` share the general SwiftUI-on-Linux limitation.

Whoever next opens this repo on a Mac should: open `apps/macos/Package.swift` in Xcode, build and run the `AIMA` scheme, and confirm the `#Preview` blocks in each view render against `MockAPIClient`. That verification step is still owed and is called out explicitly rather than assumed.

## Running against a real backend

```bash
# from backend/, with a migrated database (see database/README.md)
npm run dev
```

Then set `AIMA_API_BASE_URL` (defaults to `http://127.0.0.1:4000`, `backend/README.md`'s local dev port) in the app's scheme environment variables, or run with `AIMA_USE_MOCK_API=1` to use `MockAPIClient` and skip the backend entirely.
