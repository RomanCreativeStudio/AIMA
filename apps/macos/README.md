# AIMA — macOS App

Status: **Foundation scaffolded (Phase 2.1).** Not yet usable end-to-end without a Mac + Xcode to build it — see "Known limitation" below.

A native SwiftUI application built with Swift Package Manager (no `.xcodeproj` — open this folder's `Package.swift` directly in Xcode via **File > Open...**; Xcode treats a `swift-tools-version` manifest as a first-class project). Talks only to `backend/`'s API — no direct database or AI provider access, per the thin-client rule in `docs/TECHNICAL_ARCHITECTURE.md` §2.

## Structure

- **`Package.swift`** — an executable target (`AIMA`) depending on `../Shared/AIMACore`. macOS 14+ only.
- **`Sources/AIMA/AIMAApp.swift`** — the `@main` entry point; builds the single `DependencyContainer` for the process.
- **`Sources/AIMA/DependencyContainer.swift`** — the composition root (dependency injection, item 1): owns the one `APIClient` instance (real `URLSessionAPIClient` or `MockAPIClient`, chosen via `AIMA_USE_MOCK_API`/`AIMA_API_BASE_URL`/`AIMA_USER_ID` environment variables until real auth exists), and is the only place that constructs view models.
- **`Sources/AIMA/Navigation/RootNavigationView.swift`** — the navigation architecture (item 1): a `NavigationSplitView` sidebar switching between the four main screens, owning the single `WorkspaceViewModel` shared by every screen that needs to know the active workspace.
- **`Sources/AIMA/Views/`** — the four main screens (item 2):
  - `Dashboard/DashboardView.swift` — current workspace, system status, pending approvals, task overview.
  - `Chat/ChatView.swift` (+ `ConversationListView`, `MessageListView`, `MessageInputView`) — conversation list, message history, message input, AI responses.
  - `Workspace/WorkspaceSwitcherView.swift` — switch between Personal, Roman Creative Studio, Mythic Forge Studios, Development.
  - `Settings/SettingsView.swift` — backend connection, user preferences, configuration.

All business logic, typed models, networking, and view models live in `../Shared/AIMACore` — this target is a thin SwiftUI presentation layer over it, consistent with every other AIMA client.

## Known limitation: Xcode/macOS required, not available in this repo's dev environment

This target `import`s SwiftUI/AppKit and can only be built, run, or previewed with Xcode on macOS. The environment this phase was built in is Linux-only (no Xcode), so:
- **Not verified here:** a real `swift build`/`xcodebuild` of this target, and SwiftUI Previews actually rendering.
- **Verified here instead:** `../Shared/AIMACore` (models, networking, view models — everything this app's logic actually depends on) builds and its full test suite passes via `swift test` on Linux (see `../Shared/AIMACore/README.md`). Running `swift build` for *this* package on Linux fails with exactly one error, `no such module 'SwiftUI'` — confirming the split is clean: nothing platform-agnostic leaked into this target, and nothing here has a logic bug hiding behind the platform mismatch.

Whoever next opens this repo on a Mac should: open `apps/macos/Package.swift` in Xcode, build and run the `AIMA` scheme, and confirm the `#Preview` blocks in each view render against `MockAPIClient`. That verification step is still owed and is called out explicitly rather than assumed.

## Running against a real backend

```bash
# from backend/, with a migrated database (see database/README.md)
npm run dev
```

Then set `AIMA_API_BASE_URL` (defaults to `http://127.0.0.1:4000`, `backend/README.md`'s local dev port) in the app's scheme environment variables, or run with `AIMA_USE_MOCK_API=1` to use `MockAPIClient` and skip the backend entirely.
