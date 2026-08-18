# AIMA — iPhone App

Status: **Scaffolded (Alpha Launch sprint).** A real SwiftUI app now lives in this folder — a thin presentation
layer over `apps/Shared/AIMACore`, the same cross-platform package `apps/macos/` depends on. No `.xcodeproj`
exists (none exist anywhere in this repo); this is a plain-text SwiftPM `Package.swift`, opened directly in
Xcode via **File > Open...** on `apps/ios/Package.swift`, exactly like `apps/macos/`.

**Honest disclosure, per this sprint's own rule ("never fake verification"): nothing in this folder has ever
been compiled, simulator-run, or device-run.** This repository's development environment for this sprint is
Linux, with no Xcode, no iOS SDK, and no physical Apple hardware available. `AIMACore` — the only part of this
app that is cross-platform — has been built and tested on Linux; the SwiftUI layer below has only been written
and reviewed, never built. The first real compile of this app happens the first time someone opens it in Xcode.

## What exists

- `Package.swift` — `.iOS(.v17)`, one `.executableTarget` depending on `../Shared/AIMACore`, mirroring
  `apps/macos/Package.swift`'s structure exactly.
- `Sources/AIMA/AIMAApp.swift` — entry point; gates content on `AuthenticationManager.state`, same pattern as
  macOS's `AIMAApp.swift`.
- `Sources/AIMA/DependencyContainer.swift` — the composition root; a smaller sibling of macOS's container,
  exposing only the `make*ViewModel()` factories the six tabs below actually use. Zero AppKit/UIKit code —
  pure Foundation/AIMACore, same as macOS's.
- `Sources/AIMA/Views/` — `LoginView`, `RootTabView` (a `TabView`, in place of macOS's `NavigationSplitView`
  sidebar — a phone screen has no room for a persistent sidebar), and one view per tab: `DashboardView`,
  `ChatView`, `TasksView`, `MemoryView`, `WorkspaceView`, `SettingsView`. Every one of them is a direct or
  lightly-adapted port of its macOS counterpart, built against the exact same `AIMACore` view models — there is
  no new business logic anywhere in this folder.

### The six tabs

Chosen to map directly onto this sprint's own end-to-end verification list:

| Tab | Backs |
|---|---|
| Dashboard | Daily Briefing, Needs Attention (nudge dismiss), Recommendations, Pending Approvals (approve/reject), Tasks Overview |
| Chat | Send a message, accept a detected action suggestion (creates a task), inline approval card |
| Tasks | View/filter every task in the active workspace |
| Memory | View/search/create/archive/delete memories |
| Workspace | Switch workspace, cross-workspace digest |
| Settings | Backend URL (see **Networking** below), profile, sign out |

### Known v1 gaps (deliberate, not oversights)

Per the sprint's own instruction ("do not rebuild Alpha functionality that already exists... minimal changes"),
this app reuses `AIMACore`'s view models but does not give every macOS screen its own iOS tab. Not included in
this pass, all reachable later the same way macOS's screens were added one at a time:

- **Onboarding.** `AuthenticationManager.hasCompletedOnboarding` is a pure read; `AIMAApp` here doesn't check it,
  so a signed-in user always lands straight in `RootTabView`. Non-fatal — onboarding is a one-time preference
  write, not a requirement to use anything else.
- **Approvals as its own tab.** Folded into Dashboard's existing "Pending Approvals" section instead.
- **Integrations, Workflows, Executions, Search, Feedback, Admin.** Each has a working `AIMACore` view model
  already; adding an iOS tab for any of them is additive, not a new architecture.
- **Voice.** Explicitly Beta per this sprint's own rules — intentionally excluded.
- **Editing a memory.** Create/archive/delete are wired; editing an existing memory's content is not.

## Building and running (Xcode required — macOS only)

1. On a Mac with Xcode installed, open `apps/ios/Package.swift` directly (**File > Open...**, not "Open Recent" —
   pick the file itself).
2. Xcode resolves the local `../Shared/AIMACore` package dependency automatically.
3. Pick an iOS Simulator or a connected physical iPhone as the run destination, then **Run**.
4. **Signing (physical device only):** this is a personal/development build, not one meant for the App Store —
   in the target's **Signing & Capabilities** tab, select your own Apple ID team ("Automatically manage
   signing"). This is an Xcode-GUI-only step; there is no `Package.swift` field for it.

### Required manual Xcode configuration (cannot be expressed in `Package.swift`)

A plain SwiftPM executable target like this one has no `Info.plist` in the repository — Xcode generates and
manages one for it via build settings in the GUI. Two settings must be added there before the app can reach a
LAN backend on a physical device; neither can be set from this repo's source files, and neither has been set
(there is no Xcode installation available to set them from):

- **App Transport Security (ATS) exception.** iOS blocks plaintext HTTP by default. Reaching a Mac's local
  backend over `http://192.168.x.x:4000` (see **Networking** below) needs either `NSAllowsLocalNetworking` or a
  scoped `NSExceptionDomains` entry added to the target's Info settings. Do not disable ATS globally
  (`NSAllowsArbitraryLoads`) — scope the exception to local development.
- **Local Network usage description (`NSLocalNetworkUsageDescription`).** iOS 14+ requires a usage-purpose
  string before an app can discover/connect to devices on the local network, which a LAN backend connection
  triggers a permission prompt for.

Until both are set, a build will run against a mock (`AIMA_USE_MOCK_API=1`) or an HTTPS backend fine, but a
physical iPhone reaching a Mac's plain-HTTP backend over Wi-Fi will fail with an ATS error.

## Networking (Mac ↔ iPhone over LAN)

The backend has no hardcoded `localhost` anywhere in this app — `APIConfiguration.resolved(environment:userDefaults:)`
(Alpha Launch sprint, `apps/Shared/AIMACore/Sources/AIMACore/Configuration/APIConfiguration.swift`) resolves the
backend base URL with this precedence:

1. `AIMA_API_BASE_URL` environment variable (an Xcode scheme override), if set.
2. The most recently saved Settings-tab value — persists across relaunches via `UserDefaults`.
3. `http://127.0.0.1:4000` (`developmentDefault`) — only meaningful in the Simulator (or on the Mac itself), never on a physical iPhone.

To connect a physical iPhone to a Mac running the backend on the same Wi-Fi network:

1. On the Mac, find its LAN IP: `ipconfig getifaddr en0` (Wi-Fi) or `ipconfig getifaddr en1`.
2. Start the backend so it's reachable beyond `127.0.0.1` — see `backend/README.md`.
3. On the iPhone, open **Settings** in the app and enter `http://<mac-lan-ip>:4000`, then **Apply**. This is
   saved (`APIConfiguration.save`) and reused on every future launch — it only needs to be entered once.
4. For a future production deployment, the same field accepts an `https://` URL; no code change is required.

## What has and hasn't been verified

- **AIMACore (Linux, automated):** builds and its full test suite passes (`swift build` / `swift test` from
  `apps/Shared/AIMACore`) — this is the layer every view above depends on for its actual behavior.
- **This app's SwiftUI layer:** reviewed for correctness against `AIMACore`'s real public API (every
  `make*ViewModel()` call, every model property referenced here was checked against its source), but **never
  compiled**. A first Xcode build may surface real type errors this review missed — that is expected and
  should be treated as normal first-build cleanup, not evidence the approach is wrong.
- **Simulator:** not run — no simulator tooling available in this environment.
- **Physical iPhone:** not run — no device available in this environment.
