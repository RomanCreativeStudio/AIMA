# AIMA — iPhone App

Status: **Not yet scaffolded.** Its shared foundation, however, already exists: `apps/Shared/AIMACore` (Phase 2.1) has no SwiftUI/UIKit dependency and is ready for this app to depend on the same way `apps/macos/` does.

This will be a native SwiftUI application, sharing code with `apps/macos/` where practical (per `docs/TECHNICAL_ARCHITECTURE.md` §2 and `docs/DEVELOPMENT_SETUP.md` §3) via `apps/Shared/AIMACore`. It requires Xcode on macOS and is out of scope for this environment/sprint.

Planned responsibilities:
- Quick capture (notes, tasks, voice) and reviewing/approving pending Tier 3 actions on the go.
- Push notifications (APNs) for pending approval requests.
- Talks only to `backend/`'s API — no direct database or AI provider access.

This app is built once the Integration Sprint's client work begins on a macOS development machine.
