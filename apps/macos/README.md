# AIMA — macOS App

Status: **Not yet scaffolded.**

This will be a native SwiftUI application, sharing code with `apps/ios/` where practical (per `docs/TECHNICAL_ARCHITECTURE.md` §2 and `docs/DEVELOPMENT_SETUP.md` §3). It requires Xcode on macOS and is out of scope for this environment/sprint.

Planned responsibilities:
- Primary "power user" client: workspace switching, drafts review, deeper project/knowledge views.
- Talks only to `backend/`'s API — no direct database or AI provider access (per the thin-client rule in the Technical Architecture).
- Persistent connection to the backend for real-time AI responses and Tier 3 approval notifications.

This app is built once the Integration Sprint's client work begins on a macOS development machine.
