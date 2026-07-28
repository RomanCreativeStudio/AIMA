# AIMA Development Setup Guide

**Version:** 0.4
**Status:** Official Engineering Workflow — companion to `docs/PRODUCT_BIBLE.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/PRODUCTION_SETUP.md`
**Owner:** Lead Developer
**Last Updated:** 2026-07-28

This document defines how AIMA is actually built, day to day: tools, repository layout, git workflow, environment setup, testing, and documentation standards. It exists so that development — even as a solo effort — proceeds with the discipline of a real engineering team. Every rule here exists to protect the guarantees made in the Product Bible (user control, workspace isolation, permission tiers, logging) as the codebase grows.

---

## 1. Development Philosophy

AIMA is a long-lived, trust-critical system, not a prototype to be rewritten later. It handles a real person's client relationships, creative IP, personal life, and code. Development must be approached accordingly:

- **Build deliberately, not fast-and-loose.** Speed matters — this is a solo developer building an MVP — but speed is achieved through clarity and small, well-understood increments, not by skipping process.
- **Documentation is part of the system, not an afterthought.** The Product Bible and Technical Architecture documents are binding. Code that contradicts them is a bug, even if it "works." When a real decision is made that isn't yet reflected in the docs, the docs get updated — the docs must never silently drift out of sync with the code.
- **Version control is the record of truth.** Every change of consequence goes through git with a clear message. If it isn't committed, it doesn't count as done.
- **Testing exists to protect trust.** Because AIMA can take real actions (Product Bible §5), untested code in the permission or workspace-isolation paths is treated as a security issue, not a quality-of-life issue.
- **Simplicity is a feature.** Per the Technical Architecture's guiding rule, prefer the boring, well-understood solution over the clever one. Complexity is added only when a real requirement demands it — not in anticipation of one.
- **One developer, professional standards.** Being solo is not a reason to skip branches, PRs (even self-reviewed), or commit discipline. These habits are what let AIMA scale to a team later without a painful transition.

---

## 2. Required Tools

### Operating System
- **macOS** (current or previous major release) — required, since AIMA's primary clients are built with Apple's toolchain (Swift/SwiftUI) and require Xcode.

### Code Editor
- **Xcode** — required for macOS/iPhone/tvOS app development (SwiftUI, simulators, signing).
- **Visual Studio Code** (or JetBrains equivalent) — recommended for backend, AI orchestration, and web dashboard code (TypeScript/Python).

### Git
- **Git** (latest stable) installed and configured with a signed commit identity where possible.
- A GUI git client (e.g., GitHub Desktop, Fork, or Xcode's built-in git support) is optional but recommended for reviewing diffs before committing.

### GitHub Workflow
- **GitHub CLI (`gh`)** recommended for creating PRs and managing issues from the terminal.
- Repository hosted on GitHub under the `RomanCreativeStudio/AIMA` organization/repo.
- Branch protection on `main` (Section 4) configured via GitHub repository settings.

### Apple Development Tools
- **Xcode Command Line Tools**.
- **Apple Developer Program membership** — required before any TestFlight distribution or device-specific testing (push notifications, APNs) can be configured; not required to begin local simulator development.
- **SF Symbols** app (optional) for consistent iconography across apps.
- **Swift toolchain (5.10+/6.x)** — the platform-agnostic `apps/Shared/AIMACore` package (Phase 2.1, `docs/decisions/0009-macos-experience-foundation.md`) has no SwiftUI/Combine dependency, so it also builds and runs its full test suite with `swift build`/`swift test` on a non-Apple machine with the [Linux Swift toolchain](https://www.swift.org/install/linux/) installed — useful for CI or a non-macOS contributor, though the `apps/macos`/`apps/ios`/`apps/tvos` SwiftUI executables themselves still require Xcode.

### Backend Development Tools
- **Node.js 22 (LTS) + TypeScript** — decided for `backend/` and `ai-engine/` in the Foundation Sprint (see `docs/decisions/0001-backend-stack.md`). Use the version pinned in the repo's `.nvmrc`.
- **npm** (workspaces) as the package manager — no separate monorepo tool.
- **Docker** (optional but recommended) for running local dependencies (e.g., a local Postgres instance) consistently.

### Database Tools
- **PostgreSQL** client — either a local install or Docker container for development, matching the managed Postgres provider used in production (Technical Architecture §8).
- A database GUI (e.g., TablePlus, Postico, or the provider's own dashboard, such as Supabase Studio) for inspecting data during development.

### Testing Tools
- **XCTest** (built into Xcode) for macOS/iOS unit and UI testing.
- **Jest** (Node) or **Pytest** (Python) for backend unit/integration testing, matching the chosen backend language.
- **Postman** or `curl`/`httpie` for manual API testing during development.

---

## 3. Repository Structure

AIMA is developed as a single monorepo. This keeps the product's shared contracts (API types, permission tier definitions, workspace schema) consistent across every client and service without duplication or version drift — appropriate for a solo developer who cannot afford to keep multiple repos in sync by hand.

```
AIMA/
├── apps/           # All client applications (thin presentation layer)
│   ├── Shared/AIMACore/  # Platform-agnostic Swift package: models, networking,
│   │                     # view models — no SwiftUI/Combine dependency (Phase 2.1)
│   ├── macos/      # macOS app (SwiftUI, depends on Shared/AIMACore)
│   ├── ios/        # iPhone app (SwiftUI, shares code with macos/ where practical)
│   ├── web/         # Web dashboard (Next.js/TypeScript)
│   └── tvos/       # Future Apple TV companion (created when that sprint begins)
│
├── backend/        # API layer, auth, permission engine, business logic, action log
│
├── ai-engine/      # AI orchestration: model adapter, context assembly,
│                    # memory system, retrieval (RAG), future multi-agent controller
│
├── database/       # Schema, migrations, seed data, workspace partitioning definitions
│
└── docs/           # Product Bible, Technical Architecture, this guide, and all
                     # future decision records / ADRs
```

**Folder purposes:**

- **`apps/`** — Every user-facing client lives here. Per the Technical Architecture, clients contain no business logic or direct AI/database access; they call `backend/`'s API only. Shared Swift code between `macos/` and `ios/` lives in a shared package within `apps/` rather than being duplicated.
- **`backend/`** — The single source of enforcement for authentication, workspace isolation, the permission engine, and the action log (Technical Architecture §5–6). All business logic for RCS, MFS, Personal, and Development workspaces lives here, not in any client.
- **`ai-engine/`** — Everything related to talking to the LLM provider, assembling context, managing memory, and retrieving knowledge (Technical Architecture §4). Kept separate from `backend/` because it has a distinct concern (AI orchestration) and a distinct future growth path (multi-agent), even though it is only ever called by `backend/`.
- **`database/`** — Schema definitions and migrations are version-controlled here so the database structure has the same review/history discipline as application code. No schema change ships without a migration file in this folder.
- **`docs/`** — All binding product and engineering documentation. If it isn't in `docs/`, it isn't official.

Additional top-level folders (e.g., `scripts/`, `.github/` for CI workflows) may be added as needed, but the five above are the foundational structure and should not be renamed or restructured without updating this document.

---

## 4. Branch Strategy

### Main Branch (`main`)
- Always represents a stable, working state of AIMA.
- Protected: no direct pushes. All changes arrive via reviewed, merged pull requests.
- Every merge to `main` should be deployable.

### Development Branch (`develop`)
- Integration branch where completed feature branches are merged before being batched into a `main` release.
- Used once the project has enough concurrent work-in-progress to warrant it (typically from the Integration Sprint onward — Technical Architecture §10). In the Foundation Sprint, merging feature branches directly to `main` is acceptable given the low concurrency of solo development.

### Feature Branches
- Branch naming: `feature/<short-description>` (e.g., `feature/permission-engine`, `feature/rcs-lead-tracking`).
- Bug fixes: `fix/<short-description>`. Documentation-only changes: `docs/<short-description>`.
- One feature branch = one coherent unit of work. Keep them small enough to review in one sitting.
- Branch from `develop` (or `main`, pre-`develop`), never from another in-progress feature branch.

### Pull Requests
- Every change of consequence — including solo-authored ones — goes through a PR, even if self-merged. This preserves a reviewable history and forces a moment of self-review before merge.
- PR description states: what changed, why, and which Product Bible/Architecture sections it touches (if any).
- Any PR that touches the permission engine, authentication, or workspace-isolation logic must explicitly note that in the description and receive an extra self-review pass before merge, given the trust-critical nature of that code (Section 1).
- CI (once established) must pass before merge.

### Commit Standards
- Commit messages follow a clear, consistent style: a short imperative summary line (e.g., "Add workspace partitioning to leads table"), followed by an optional body explaining *why* if not obvious.
- Prefer multiple small, focused commits over one large commit — each commit should represent one logical change.
- Never commit secrets, API keys, or `.env` files (Section 5).

---

## 5. Environment Configuration

### Environment Variables
- All configuration that varies by environment (local, staging, production) — database URLs, API base URLs, feature flags — is provided via environment variables, never hardcoded.
- Each app/service that needs configuration ships an `.env.example` file documenting every required variable (name and description, never real values) so the project can be set up from scratch by reading one file.

### API Keys
- LLM provider keys, auth provider keys, and any third-party service keys are treated as secrets (below) — never committed, never logged, never sent to any client.
- Client apps never hold provider API keys directly; all provider calls are proxied through `backend/`/`ai-engine/`, consistent with the Technical Architecture's rule that clients have no direct AI/database access.

### OAuth Configuration (Phase 2.7)
- Gmail, GitHub, and Calendar are connected via real OAuth 2.0 (docs/decisions/0015-live-integration-providers.md) — a workspace never types in an access token by hand as the primary path; the backend drives the authorization-code flow and stores the resulting tokens itself, encrypted (Phase 2.3's `CredentialEncryptor`, unchanged).
- One Google Cloud OAuth app (https://console.cloud.google.com/apis/credentials) covers both `gmail` and `calendar` — same `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, different scopes and redirect URIs. Register two authorized redirect URIs on that one app:
  - `{PUBLIC_BACKEND_URL}/api/oauth/gmail/callback`
  - `{PUBLIC_BACKEND_URL}/api/oauth/calendar/callback`
- A separate GitHub OAuth app (https://github.com/settings/developers) provides `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET`, with an authorization callback URL of `{PUBLIC_BACKEND_URL}/api/oauth/github/callback`.
- `PUBLIC_BACKEND_URL` is this backend process's own reachable URL (`http://127.0.0.1:4000` for local development) — it's how the fixed OAuth redirect URIs above get built, and it must match exactly what's registered with each provider, protocol and port included.
- All five variables (`PUBLIC_BACKEND_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`) are required at startup the same way `CREDENTIAL_ENCRYPTION_KEY` is (`backend/.env.example`) — `npm run dev` fails fast with a clear message if any is missing. Tests never need real values: every OAuth/connector test in `backend/`'s suite injects a fake `fetch` (`backend/src/testUtils/fakeFetch.ts`) and never reaches a real provider.

### Voice Provider Configuration (Phase 3.2, real provider in Phase 3.3)
- Speech-to-text and text-to-speech are both provider abstractions (`ai-engine/src/voice/`), the same pattern as `AIProvider`/`EmbeddingProvider` — `SPEECH_TO_TEXT_PROVIDER`/`TEXT_TO_SPEECH_PROVIDER` both default to `mock`, so voice sessions work with zero vendor setup, and `mock` remains fully supported for local development and tests.
- `"openai"` (Phase 3.3, docs/decisions/0018-real-voice-provider-integration.md) is the first real provider — set `SPEECH_TO_TEXT_PROVIDER=openai`/`TEXT_TO_SPEECH_PROVIDER=openai` and `SPEECH_TO_TEXT_PROVIDER_API_KEY`/`TEXT_TO_SPEECH_PROVIDER_API_KEY` (an OpenAI API key; both can share one key). Optional `_MODEL` (defaults: `whisper-1` for STT, `tts-1` for TTS) and `_TIMEOUT_MS` (default 30000) per provider. A missing API key for a non-`mock` selection fails fast at provider construction, the same fail-fast philosophy as every other required credential in this codebase.
- A provider failure (timeout, vendor error, bad credentials) never reaches the client verbatim — `VoiceService` wraps it in a generic `VoiceProviderError`, returned as HTTP 502 with a safe message. No vendor's raw error body is ever forwarded.
- No microphone audio is ever persisted server-side, by design — only transcript text and response text are stored (`voice_turns`, `database/migrations/0016_voice.sql`). This is unchanged by which provider (`mock` or `openai`) is configured.

### Memory Intelligence Configuration (Phase 3.4)
- No new environment variables or vendor accounts are required — memory scoring/ranking/extraction is entirely local computation (`backend/src/memory/ranking.ts`, `ai-engine/src/memory/RuleBasedMemoryExtractor.ts`), the same "no AI call" posture as `RuleBasedIntentClassifier`/`WorkflowIntentMatcher`.
- `RuleBasedMemoryExtractor` only ever *detects* candidate facts/preferences and attaches them to a chat response as advisory `memorySuggestions` — it has no database access and cannot save anything. A memory is only ever persisted by an explicit `POST /api/workspaces/:id/memories` call, whether that's the user directly or a client acting on one of those suggestions. There is no configuration flag to change this; it is structural (docs/decisions/0019-advanced-memory-system.md).
- Existing memory rows from before this phase need no migration/backfill step: `database/migrations/0017_memory_intelligence.sql`'s new columns are all nullable or defaulted (importance 0.5, confidence 1.0, `memory_type` `long_term`).

### Proactive Intelligence Configuration (Phase 3.5)
- No new environment variables or vendor accounts are required — pattern detection, ranking, and confidence scoring are all local computation (`ai-engine/src/proactive/`, `backend/src/proactive/`), the same "no AI call, deterministic" posture as `RuleBasedIntentClassifier`/`RuleBasedMemoryExtractor`.
- `GET .../proactive/patterns` and `GET .../proactive/suggestions` never create, execute, or send anything — every result is computed fresh from existing data on each request, nothing is persisted, and nothing is auto-acted-on. There is no configuration flag to change this; it is structural (docs/decisions/0020-proactive-intelligence.md).
- The Daily Briefing's `calendarHighlights` never calls the live Calendar connector, by design — `read_calendar` remains Tier 3 and permanently tier-locked (unchanged from Phase 2.3/2.7); the briefing only ever surfaces calendar *writes* that already went through approval.

### Production Configuration (Phase 3.1)
- Running the backend anywhere other than a developer's own machine — a staging host, a production deployment — is covered in full by `docs/PRODUCTION_SETUP.md`, not this document. In short: set `NODE_ENV=production`, use `backend/.env.production.example` as your template, and `PUBLIC_BACKEND_URL` must be `https://` (enforced by `loadConfig()`, `backend/src/config/env.ts`).
- Two additional optional variables control database connection behavior in any environment: `DATABASE_SSL` (set `true` for managed Postgres providers that require TLS) and `DATABASE_POOL_MAX` (bounds simultaneous connections; defaults to 10).
- This phase adds no requirement for real OAuth credentials or a live deployment — it only makes the backend's existing configuration production-ready (validation, logging, error monitoring, health checks). See `docs/decisions/0016-production-deployment-foundation.md`.

### Secrets Management
- Local development: secrets live in a `.env` file at the relevant app/service root, listed in `.gitignore`, never committed.
- Production: secrets live in the hosting platform's managed secrets store (Technical Architecture §8), injected as environment variables at runtime — never baked into a build artifact.
- If a secret is ever accidentally committed, it is treated as compromised: rotate it immediately, then clean the git history.

### Local Configuration
- Each app/service includes a minimal local config guide (or references this document) so that running AIMA locally requires no undocumented tribal knowledge — important even for a solo developer, since "future you" is effectively a new team member.

---

## 6. Local Development Workflow

1. **Clone the repository**
   ```
   git clone https://github.com/RomanCreativeStudio/AIMA.git
   cd AIMA
   ```

2. **Install dependencies**
   - Backend/AI engine: run the package manager install command in `backend/` and `ai-engine/` (e.g., `npm install` or `poetry install`).
   - Web dashboard: run the install command in `apps/web/`.
   - macOS/iOS: open `apps/macos/Package.swift` (or the relevant app's `Package.swift`) directly in Xcode via "File > Open..." — there is no `.xcodeproj`; dependencies (including the local `apps/Shared/AIMACore` package) resolve via Swift Package Manager automatically.

3. **Configure environment**
   - Copy each `.env.example` to `.env` in the corresponding folder and fill in local values (local database URL, a development-tier LLM API key, etc.).
   - Start local dependencies if using Docker (e.g., local Postgres container).
   - Run any pending database migrations against the local database (`database/`).

4. **Run applications**
   - Start `backend/` locally (e.g., `npm run dev` / `poetry run dev`).
   - Start `ai-engine/` locally if run as a separate process, or confirm it's loaded as a module by `backend/` per the current architecture.
   - Run `apps/web/` locally against the local backend.
   - Build and run `apps/macos/` or `apps/ios/` from Xcode, pointed at the local backend via environment configuration.

5. **Test changes**
   - Run the relevant automated test suite (Section 7) before committing.
   - Manually exercise the specific workspace/feature affected, including a quick check that workspace isolation and permission tiers still behave correctly if the change touches those systems.
   - Only then commit and open a PR (Section 4).

---

## 7. Testing Standards

### Unit Testing
- Every non-trivial function in `backend/` and `ai-engine/` — especially permission tier logic, workspace scoping, and context assembly — should have unit test coverage.
- Tooling: Node's built-in `node:test` runner via `tsx` (`npm test` in either package, or from the repo root to run both) — no test framework dependency beyond that, per the "avoid unnecessary complexity" rule (§9). Example: `backend/src/permissions/engine.test.ts`, `ai-engine/src/embeddings/MockEmbeddingProvider.test.ts`.
- Swift code in `apps/` uses XCTest for logic that isn't purely presentational (e.g., view models). `apps/Shared/AIMACore`'s suite (model decoding, `URLSessionAPIClient` against a stubbed `URLProtocol`, and every view model against `MockAPIClient`) runs via `swift test` and is verifiable without Xcode; the SwiftUI views in `apps/macos` themselves are only verifiable via Xcode Previews/builds on a real Mac.

### Integration Testing
- Backend API endpoints and services are tested end-to-end against a **real local Postgres database** (`aima_test`, migrated per `database/README.md`) — not mocked. Set `TEST_DATABASE_URL` if your local database differs from the default. Service-level tests wrap each test in a transaction that's rolled back (`backend/src/testUtils/db.ts`); HTTP-level route tests seed and clean up their own rows.
- Special focus: workspace isolation (a request scoped to RCS must never return MFS/Personal/Development data — see `backend/src/memory/memoryService.test.ts`) and permission tier enforcement (every action-producing route must call the `PermissionEngine` and log to `action_log` — see `backend/src/routes/memories.test.ts`).

### Feature Testing
- Before a feature is considered done, it is tested as a full flow through the relevant client — not just at the API layer — to confirm the actual user-facing behavior matches the Product Bible's intent (e.g., a Tier 3 email draft genuinely requires a tap/click to send, not just returns the correct API response).

### Manual Testing Requirements
- Every PR that touches permission logic, workspace isolation, or authentication requires a manual test pass by the developer, documented in the PR description (what was manually verified), in addition to automated tests — this is a trust-critical area where automated coverage alone is not yet sufficient trust for a solo team.
- Before any release/merge to `main`, a manual smoke test across all four workspaces is performed.

---

## 8. Documentation Standards

### When Documentation Is Required
- Any change to the Product Bible or Technical Architecture's stated behavior requires updating those documents in the same PR as the code change — code and docs must never diverge.
- New capabilities added to the permission registry (Technical Architecture §5) must be documented with their tier and rationale, at minimum in the PR description; significant ones warrant a short addition to the Technical Architecture.
- Any non-obvious architectural decision (a tradeoff, a deviation from the original plan) is recorded as a short decision note in `docs/` rather than left implicit in a commit message.

### How Decisions Are Recorded
- Significant decisions (technology swaps, permission tier changes, workspace model changes) get a brief entry appended to the relevant document's revision history, or, once volume warrants it, a dedicated `docs/decisions/` log of short Architecture Decision Records (ADRs) — one file per decision, stating context, decision, and consequences.
- Routine implementation detail does not need a decision record — only choices a future developer (or future self) would otherwise have to re-derive or might reverse by accident.

### Versioning Rules
- `docs/PRODUCT_BIBLE.md` and `docs/TECHNICAL_ARCHITECTURE.md` carry a version number in their header. Increment the minor version (e.g., 0.1 → 0.2) for meaningful additions, and note the date of change.
- This document (`DEVELOPMENT_SETUP.md`) follows the same versioning convention.
- Breaking changes to established workflow (e.g., changing the branch strategy) should bump the version and be called out clearly at the top of the relevant section.

---

## 9. MVP Development Rules

Binding rules for the first AIMA release, to keep a solo developer's scope achievable without compromising the platform's foundation:

1. **Avoid unnecessary complexity.** Build the simplest thing that correctly satisfies the Product Bible and Technical Architecture — no speculative abstraction, no infrastructure "just in case." (Product Bible §9, Rule 10.)
2. **Build working features first, polish second.** A feature that works end-to-end at Tier 2 is worth more than a beautifully designed feature that isn't wired up yet. Get the full loop (Technical Architecture §7) working before refining UI or prompt quality.
3. **Security is never optional, even in MVP scope.** Authentication, workspace isolation, and the permission engine are not "V2 features" — they ship in the Foundation Sprint and are never bypassed "temporarily" to move faster.
4. **Maintain clean architecture from day one.** Clients stay thin, business logic stays in `backend/`, AI orchestration stays in `ai-engine/`. Shortcuts that blur these boundaries "just for the MVP" are exactly what makes a codebase unmaintainable — they are not allowed even under deadline pressure.
5. **One workspace proven end-to-end before expanding to four.** Build and fully validate the core loop (chat → memory → knowledge retrieval → permission-gated action → logging) in one workspace (recommend Development or RCS) before replicating the pattern across Personal and MFS.
6. **No Tier 4 automation in the MVP.** Per the Product Bible, automatic-safe actions are only earned after a track record — the MVP should not ship with any pre-promoted Tier 4 capability.
7. **Every external-action capability ships with its Tier 3 approval flow, never without it.** There is no "send now, confirm later" path.
8. **Prefer deferring a feature over building it unsafely.** If a capability can't yet be built with proper permission-tier and workspace-isolation enforcement, it is not ready to ship — regardless of how useful it would be.

---

## 10. First Development Sprint Preparation

Before any application code is written, the following must be complete:

1. **Documentation foundation in place** — `docs/PRODUCT_BIBLE.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and this `docs/DEVELOPMENT_SETUP.md` exist, are internally consistent, and are treated as binding. *(Complete as of this document.)*
2. **Repository structure created** — the `apps/`, `backend/`, `ai-engine/`, `database/`, `docs/` folders exist per Section 3, even if most are empty scaffolding initially.
3. **Branch protection configured** — `main` is protected on GitHub per Section 4 before the first PR is opened.
4. **Toolchain installed and verified** — Xcode, chosen backend runtime, Postgres (local or Docker), and git are installed and confirmed working (e.g., a blank Xcode project builds, a blank backend server starts, a local Postgres connection succeeds).
5. **Core accounts provisioned** — GitHub repo access confirmed, chosen managed auth provider account created, chosen managed database/storage provider account created, LLM provider (Claude API) account and a development-tier API key obtained.
6. **Environment configuration scaffolding in place** — `.env.example` files created for `backend/` and `ai-engine/` listing the variables identified in Section 5, even before all values are known.
7. **Capability registry stub defined** — a starting structure for the permission engine's capability registry (Technical Architecture §5) exists in `backend/`, even if empty, so the very first real capability built has a place to declare its tier from day one.
8. **Foundation Sprint scope confirmed** — the developer has re-read Technical Architecture §10's Foundation Sprint definition and agrees it is the immediate next work.

Once all eight items are checked off, the Foundation Sprint (Technical Architecture §10) may begin.
