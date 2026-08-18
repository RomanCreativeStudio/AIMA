# AIMA — Web Dashboard

Status: **Not yet scaffolded.**

Per `docs/TECHNICAL_ARCHITECTURE.md` §2 and §8, this will be a Next.js + TypeScript client providing browser-based access to AIMA — a secondary surface to the native Apple apps, not required to have feature parity in early versions.

Planned responsibilities:
- Read/write access to workspaces via the same backend API used by the native apps.
- No local storage of sensitive data beyond session-scoped cache.
- No business logic, direct database access, or direct AI provider calls — calls `backend/` only.

Scaffolding is deferred to the Integration Sprint (`docs/TECHNICAL_ARCHITECTURE.md` §10) per this sprint's scope: backend and AI engine foundations first, no UI work yet.
