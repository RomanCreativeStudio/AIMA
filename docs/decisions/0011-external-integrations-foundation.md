# ADR 0011: External Integrations Foundation

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §2, §3, §5, §10, `backend/src/integrations/`, `backend/src/permissions/registry.ts`, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Through Phase 2.2, AIMA had no concept of a connected external account at all — every capability operated purely on data already inside AIMA's own database (memory, documents, tasks, drafts). Phase 2.3 asked for the foundation of real external integrations: a provider framework, three read-only connectors (Gmail, GitHub, Calendar), an encrypted credential layer with validation and rotation, four new approval-gated capabilities, and a macOS Integrations screen — explicitly *not* wiring any of it into a live read pipeline yet ("no automation execution").

The central tension this phase had to resolve: building something that looks and behaves like a real integration (so the framework, credential handling, and UI are genuinely exercised) without either (a) fabricating a working OAuth flow this environment cannot complete, or (b) quietly shipping something that only pretends to validate credentials.

## Decisions

### 1. Connectors are deterministic stubs, not live API clients — stated plainly, not hidden

`StubGmailConnector`/`StubGitHubConnector`/`StubCalendarConnector` (`backend/src/integrations/connectors/`) implement `IntegrationConnector`'s full contract — `testConnection` plus a real read method (`listMessages`/`listRepositories`+`listIssues`/`listEvents`) — but never make an HTTP request. Each one's doc comment states exactly which real API endpoint a live implementation would call and why this phase doesn't call it: registering a real Google/GitHub OAuth app and completing a user consent flow is outside what this sandboxed environment can do, and pretending otherwise (e.g. hardcoding a "successful" response regardless of credentials) would be worse than admitting the gap — it would make `testConnection`'s validation meaningless. Every stub still does real, useful work: it validates that required credential fields are present and returns deterministic sample data, so `IntegrationService` and the macOS UI both have a genuine contract to build and test against. `GET`/read routes were deliberately never added to `backend/src/routes/integrations.ts` for the same reason — a route with nothing real behind it would be a UI element pretending to a capability that doesn't exist yet.

### 2. Even read access is Tier 3 and tier-locked

`read_email`, `draft_gmail_email`, `read_repositories`, `read_calendar` are all registered at `execute_with_approval` with `tierLocked: true` — the same treatment `send_email` has had since Phase 1.4. This is a deliberate broadening of what "external effect" means in the Permission Architecture (§5): previously, only actions that *change* something outside AIMA (sending an email) were locked at Tier 3. Reading a connected Gmail inbox, a private GitHub repository, or a personal calendar is not a write, but it is AIMA acting on data the user doesn't already have inside the product — exactly the category the Product Bible's permission tiers exist to gate deliberately, not automatically. `draft_gmail_email` is a distinct capability from the pre-existing `draft_email` (Tier 2, Phase 1.4) rather than a reuse: the old one only ever writes to AIMA's own local `drafts` table, while this one would draft directly inside a connected Gmail account — different blast radius, different capability, even though the verb is the same.

### 3. `IntegrationRegistry` and `CapabilityRegistry` stay two separate concerns

An `IntegrationDefinition` (`backend/src/integrations/registry.ts`) names which capability its read/write access is gated by (`readCapability`/`writeCapability`), but does not itself hold a permission tier — that's `CapabilityRegistry`'s job, unchanged. This mirrors how `DraftService`'s `DRAFT_CAPABILITY_MAP` (Phase 1.7) names a capability without owning tier logic. The integrations route composes both registries at response time (`GET /api/workspaces/:id/integrations` calls `PermissionEngine.resolveTier` per capability) rather than duplicating tier information into `IntegrationDefinition` — one source of truth for "what tier is this," reachable from anywhere a capability name is known.

### 4. Credentials are encrypted as one JSON blob per integration, not field-by-field

`IntegrationService.connect`/`rotate` `JSON.stringify` the full credentials object before calling `CredentialEncryptor.encrypt`, storing one `(ciphertext, iv, authTag)` row in `integration_credentials` rather than encrypting each field separately. Per-field encryption would add real complexity (a variable number of ciphertext/iv/tag triples per integration) for no real benefit here — the credentials for one integration are always read and written together, never partially. `disconnect` deletes the credential row outright rather than merely marking it inactive: a disabled integration has no legitimate reason to keep a decryptable secret around, and reconnecting later goes through `connect` again with fresh credentials.

### 5. The macOS credential form is generated from the API response, not hardcoded per provider

`WorkspaceIntegration.requiredCredentialFields` (added to the `GET .../integrations` response specifically for this) lets `CredentialEntrySheet` render exactly the right `SecureField`s for whichever provider it's connecting, with no per-provider `switch` in the client. This was a small but deliberate addition beyond the initial plan (the field was originally going to be Gmail/GitHub/Calendar-specific knowledge baked into the Swift client) — duplicating `IntegrationRegistry`'s knowledge of required fields into the client would drift the moment a provider's requirements changed server-side. `backend/src/routes/integrations.test.ts` and `apps/Shared/AIMACore`'s model-decoding tests both assert on this field explicitly so the contract can't silently regress.

## Consequences

- Four new Tier 3, tier-locked capabilities exist with no caller yet — the same state `send_email` has been in since Phase 1.4, and for the same reason: the gate should exist before anything can walk through it, not be bolted on after the fact under time pressure.
- `apps/Shared/AIMACore`'s test suite grew from 54 to 68 tests, covering `WorkspaceIntegration` decoding, the four new `URLSessionAPIClient` routes, and `IntegrationsViewModel`'s connect/disconnect/rotate/error-handling behavior — all genuinely run via `swift test` on Linux, since none of this phase's new AIMACore code touches an Apple-only API (unlike Phase 2.2's Markdown rendering).
- Backend test coverage (`backend/src/integrations/*.test.ts`, `connectors/*.test.ts`, `routes/integrations.test.ts`) totals 38 new tests, bringing the backend suite to 254 — including AES-256-GCM round-trip/tamper/wrong-key tests for `AesGcmCredentialEncryptor`, which is worth calling out explicitly given it's the one piece of this phase handling real secret material.
- The next real integration work (Integration Sprint, §10) is to replace one stub connector with a genuine API client and wire a route that actually performs a gated read — at that point `IntegrationService.getDecryptedCredentials` (already built, already tested, never yet called by anything) becomes load-bearing for the first time.
- No backend schema outside `backend/src/integrations/` and `backend/src/permissions/registry.ts` changed this phase — Phase 2.3 is additive, not a refactor of anything Phase 1.4–2.2 built.
