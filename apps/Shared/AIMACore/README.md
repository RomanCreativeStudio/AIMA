# AIMACore

The platform-agnostic half of every AIMA client (Phase 2.1, `docs/decisions/0009-macos-experience-foundation.md`): typed API models, the networking layer, and view models. No dependency on SwiftUI/AppKit/UIKit — everything here is plain Swift + Foundation, so it builds and tests identically on macOS, iOS, tvOS, or (for verification without Xcode) Linux.

`apps/macos/` depends on this package and adds only its own SwiftUI views and app entry point; `apps/ios/` and `apps/tvos/` are expected to do the same once their own sprints begin (`docs/DEVELOPMENT_SETUP.md` §3: "Shared Swift code between `macos/` and `ios/` lives in a shared package").

## Structure

- **`Sources/AIMACore/Models/`** — `Codable`/`Identifiable`/`Equatable` structs mirroring the backend's JSON response shapes exactly (field names already match — the backend's own `map*Row` functions produce camelCase, so no key-conversion strategy is needed): `UserProfile`, `Workspace` (+ `WorkspaceSlug`/`WorkspaceType`), `Conversation`, `Message` (+ `IntentAnalysis`, `SendMessageResult`), `TaskItem`, `PendingApproval`/`ApprovalDecision`, `Preference`, `SystemHealth`. `JSONValue.swift` represents the backend's freeform JSONB fields (`preferences`, `assistantBehavior`, `metadata`) where a fixed Swift type would be speculative.
- **`Sources/AIMACore/Networking/`** — `APIClient` (a protocol, mirroring the `AIProvider`/`EmbeddingProvider`/`IntentClassifier` provider-abstraction pattern already used in `backend/`/`ai-engine/`), `URLSessionAPIClient` (the real implementation), `APIError` (a closed, typed error set with user-facing messages).
- **`Sources/AIMACore/Configuration/APIConfiguration.swift`** — environment configuration (backend base URL, request timeout); reads `AIMA_API_BASE_URL` if set.
- **`Sources/AIMACore/Mocks/MockAPIClient.swift`** — an in-memory `APIClient` seeded with sample data across all four fixed workspaces, for SwiftUI previews and ViewModel tests. An `actor`, mirroring how `ai-engine`'s `MockProvider`/`MockEmbeddingProvider` stand in for a real provider in backend tests.
- **`Sources/AIMACore/ViewModels/`** — `DashboardViewModel`, `ChatViewModel`, `WorkspaceViewModel`, `SettingsViewModel`. Built with the `Observation` framework's `@Observable` macro, **not** Combine's `ObservableObject`/`@Published` — Combine has no Linux implementation, and this package needs to build and test on Linux. `@Observable` is fully cross-platform and is what current SwiftUI/Xcode versions expect anyway.

## Testing

```bash
cd apps/Shared/AIMACore
swift build
swift test
```

Runs on macOS, or on Linux with a Swift 5.10+/6.x toolchain installed (`https://www.swift.org/install/linux/`) — no Xcode required. `Tests/AIMACoreTests/` covers model decoding (each fixture copied from a real backend response, not invented), `URLSessionAPIClient` (a custom `URLProtocol` intercepts requests — no real network or backend needed), and every view model against `MockAPIClient`.
