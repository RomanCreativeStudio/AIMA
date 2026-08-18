# AIMA

Personal AI operating assistant for Roman Creative Studio, Mythic Forge Studios, personal productivity, and software development.

## Documentation

Start here — these documents are the binding source of truth for product, architecture, and workflow decisions:

- [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md) — `CONST-001`, the highest-authority governance document. Every other document defers to it.
- [`docs/PRODUCT_BIBLE.md`](docs/PRODUCT_BIBLE.md) — AIMA Engineering Handbook v2.0; product vision, engineering governance, ADS v1.0, traceability, ECIA, permission tiers, and roadmap.
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — engineering blueprint.
- [`docs/DEVELOPMENT_SETUP.md`](docs/DEVELOPMENT_SETUP.md) — tools, repo structure, branch strategy, local dev workflow.
- [`docs/README.md`](docs/README.md) — master documentation index and stable ID map.

## Repository Structure

```
AIMA/
├── apps/         # Client applications: macos/, ios/, web/, tvos/ (future)
├── backend/      # API layer, auth, permission engine, intent/approval engines, conversation pipeline, memory + document retrieval, action log
├── ai-engine/    # AI provider, embedding provider, and intent classifier abstractions
├── database/     # Schema migrations
└── docs/         # Constitution, Engineering Handbook, Technical Architecture, workflow guides, ADRs, and documentation index
```

## Getting Started

See [`docs/DEVELOPMENT_SETUP.md`](docs/DEVELOPMENT_SETUP.md) §6 for the full local development workflow. Quick start once dependencies are installed:

```bash
npm install
npm run build
```

Each of `backend/` and `ai-engine/` has its own `.env.example` — copy to `.env` and fill in local values before running.

## Status

Foundation, Intelligence, Conversation Intelligence, Intent & Approval Engine, Knowledge Ingestion, Assistant Core Orchestration (Phase 1.6), Intent & Approval Workflows (Phase 1.7), and User Identity & Workspace Intelligence (Phase 1.8) phases complete: backend API, permission engine, workspace-scoped memory and document retrieval, the full conversation pipeline (memory- and documentation-aware AI requests, stored history), structured intent detection with parameter extraction across 9 intents, a real DB-backed approval lifecycle (`pending`/`approved`/`rejected`/`expired`) that `AimaCoreService` now creates automatically whenever a detected intent's capability requires it, a task foundation, an action preparation layer for future email/proposal/client-response/report drafts, a system health layer, and now real user profiles, per-workspace configuration (type/instructions/behavior), and a structured preference layer that both shape every AI response are all working end-to-end (`npm test` from the repo root) — with no external action ever executed yet. UI clients (`apps/`) are not yet scaffolded — see `docs/TECHNICAL_ARCHITECTURE.md` §10 for the sprint plan.
