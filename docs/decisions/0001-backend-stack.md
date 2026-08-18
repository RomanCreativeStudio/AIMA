# ADR 0001: Backend Stack for the Foundation Sprint

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §8, `docs/DEVELOPMENT_SETUP.md` §2

## Context

`docs/TECHNICAL_ARCHITECTURE.md` §8 left the backend language as an open choice between Node.js (TypeScript) and Python (FastAPI), to be decided "whichever the developer is most fluent in." `docs/DEVELOPMENT_SETUP.md` §2 requires standardizing on one and not mixing backend languages. The Foundation Sprint needed a concrete choice to scaffold `backend/` and `ai-engine/`.

## Decision

- **Language/runtime:** Node.js (LTS 22) + TypeScript, for both `backend/` and `ai-engine/`.
- **Web framework:** Express — the most widely understood option, minimal learning curve, sufficient for the API surface AIMA needs.
- **Monorepo tooling:** npm workspaces (root `package.json` with `workspaces: ["backend", "ai-engine"]`). No additional monorepo tool (Turborepo, Nx) — unnecessary complexity at this scale (`docs/DEVELOPMENT_SETUP.md` §9, Rule 1).
- **Database access:** raw `pg` client, no ORM yet. Schema lives in versioned SQL migration files under `database/migrations/`.
- **Dev/build tooling:** `tsc` for production builds, `tsx` for local dev with file watching.

## Consequences

- TypeScript types can be shared conceptually between `backend/` and `ai-engine/` (e.g. `AIProvider`, `AICompletionRequest`) since both are TypeScript, without a separate shared-types package yet.
- The web dashboard (`apps/web/`, not yet scaffolded) will also be TypeScript (Next.js per the Technical Architecture), keeping one language across the entire non-Apple surface.
- If a future need arises for an ORM or a heavier migration tool, that is a new decision recorded as a new ADR — not a silent addition.
