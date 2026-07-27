# AIMA

Personal AI operating assistant for Roman Creative Studio, Mythic Forge Studios, personal productivity, and software development.

## Documentation

Start here — these documents are the binding source of truth for product, architecture, and workflow decisions:

- [`docs/PRODUCT_BIBLE.md`](docs/PRODUCT_BIBLE.md) — product vision, principles, permission tiers, roadmap.
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — engineering blueprint.
- [`docs/DEVELOPMENT_SETUP.md`](docs/DEVELOPMENT_SETUP.md) — tools, repo structure, branch strategy, local dev workflow.

## Repository Structure

```
AIMA/
├── apps/         # Client applications: macos/, ios/, web/, tvos/ (future)
├── backend/      # API layer, auth, permission engine, memory/retrieval, business logic, action log
├── ai-engine/    # AI provider abstraction, embedding provider abstraction
├── database/     # Schema migrations
└── docs/         # Product Bible, Technical Architecture, this workflow guide
```

## Getting Started

See [`docs/DEVELOPMENT_SETUP.md`](docs/DEVELOPMENT_SETUP.md) §6 for the full local development workflow. Quick start once dependencies are installed:

```bash
npm install
npm run build
```

Each of `backend/` and `ai-engine/` has its own `.env.example` — copy to `.env` and fill in local values before running.

## Status

Foundation and Intelligence Sprints complete: backend API, permission engine, and workspace-scoped memory/retrieval are working end-to-end (`npm test` from the repo root). UI clients (`apps/`) are not yet scaffolded — see `docs/TECHNICAL_ARCHITECTURE.md` §10 for the sprint plan.
