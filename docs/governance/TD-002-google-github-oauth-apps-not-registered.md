# TD 002: Production OAuth Credentials Are Placeholder Values — No Real Google or GitHub App Registered

**Document ID:** TD-002
**Status:** Identified
**Priority:** High
**Category:** Infrastructure
**Owner:** Product owner

## Description

Production's `GOOGLE_OAUTH_CLIENT_ID` (and, by the same deployment pattern, `GOOGLE_OAUTH_CLIENT_SECRET`/`GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET`) is set to a literal placeholder value, not a real OAuth application's credentials. Confirmed live during EPIC-007 Sprint 7.1: `POST /api/workspaces/:id/integrations/gmail/oauth/start` against `https://aima-u7c0.onrender.com` returns an `authorizationUrl` containing `client_id=not-yet-registered`. The redirect URI, scopes, and CSRF `state` in that URL are all correct — only the client ID is a placeholder. Following that link sends a real user to Google's real authorization page, which will reject it immediately (`invalid_client`) since no such OAuth application exists.

## Reason Introduced

`loadConfig()` (`backend/src/config/env.ts`) has required `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` and `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` since Phase 2.7 — the backend refuses to start at all without them set to *something*. EPIC-006's production secret generation (Sprint kickoff/execution) filled every required variable so the backend could actually start and be deployed, but registering real Google Cloud/GitHub OAuth applications was explicitly out of scope for every prior sprint (ADR-0015's Consequences: "an actual OAuth app registration... remains outside what this environment can do") and for `docs/PRODUCTION_SETUP.md` §6, which has documented this exact gap, unchecked, since Sprint 6.1. A placeholder value was the only way to satisfy the startup check without a real app.

## Affected Systems

`backend/src/oauth/` (`GoogleOAuthProvider`, `GitHubOAuthProvider`), the OAuth-driven half of `backend/src/integrations/` (Gmail/Calendar/GitHub connect via `POST .../oauth/:provider/callback`), and every capability that depends on a real connected account (`read_email`, `draft_gmail_email`, `send_email`, `read_calendar`, `create_calendar_event`/`update_calendar_event`/`delete_calendar_event`, `read_repositories`, `create_github_issue`, `create_github_pull_request`). The manual credential-entry path (`POST .../integrations/:provider/connect` with hand-supplied tokens) is unaffected by this specific gap, since it never depends on the OAuth app's client ID.

## Impact

Nothing in the codebase is broken — the architecture, code, and tests are all complete and correct (EPIC-007 Sprint 7.1 audit found no architectural problems). But the product-level promise "connect your real Gmail account" cannot actually be delivered yet: any real user attempting to connect Gmail through the OAuth flow hits a Google-side error, not an AIMA one, with no path to success until this is resolved.

## Risk Level

Low as a security matter (the placeholder can't be exploited — Google itself rejects it), **High as a delivery blocker** — this is the single blocking item between the current, fully-built integration framework and Gmail actually working end to end for a real account.

## Recommended Resolution

1. Register a real Google Cloud OAuth application (console.cloud.google.com/apis/credentials): enable the Gmail API and Calendar API, configure the OAuth consent screen, and register `https://aima-u7c0.onrender.com/api/oauth/gmail/callback` and `.../calendar/callback` as authorized redirect URIs. Note: `gmail.send`/`gmail.modify` are Google-restricted-adjacent scopes — expect a consent-screen verification step (possibly multi-day, may require a privacy policy URL) before the app can be used by real accounts beyond a small allow-listed test-user list. This is an external, human, non-code action — nothing in this repository can perform it.
2. Register a real GitHub OAuth application (github.com/settings/developers) with callback URL `https://aima-u7c0.onrender.com/api/oauth/github/callback` — no verification step, effective immediately.
3. Replace the placeholder `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`/`GITHUB_OAUTH_CLIENT_ID`/`_SECRET` values in Render's environment variables with the real ones from steps 1–2.
4. Run a real, live, single end-to-end verification: connect a real Gmail account through the deployed OAuth flow, confirm `workspace_integrations`/`integration_credentials` store real, encrypted tokens, and exercise at least one real read (`listMessages`) and one real Tier 3 write (`sendEmail`, through an explicit approval) against the live Gmail API.
5. Close this entry and update `docs/PRODUCTION_SETUP.md` §6 to reflect real registration.

## Estimated Effort

Small for GitHub (minutes, no review). Small-to-medium for Google, dominated by wait time for OAuth consent-screen verification (a human/process delay, not an engineering one) rather than actual registration effort.

## Related ADRs

`ADR-0011` (External Integrations Foundation), `ADR-0015` (Live Integration Providers) — both explicitly deferred real OAuth app registration as outside their environment's scope.

## Related Requirements

None registered yet — no `REQ-*` currently exists for the Integrations/OAuth subsystem; authoring one is recommended alongside closing this entry.

## Related Architecture

`ARCH-001` §"External Integrations Foundation (Phase 2.3)", §"Live Integration Providers (Phase 2.7)", §10 "Integration Sprint" exit criteria ("AIMA can prepare and, upon explicit approval, execute at least one real external action against a live provider (not a stub)").

## Related ECIA

None registered yet.

## Related Risks

None registered yet.

## Review History

| Version | Date | Reviewer | Change |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Product owner | Initial identification, during EPIC-007 Sprint 7.1's Google integration audit — confirmed live via `client_id=not-yet-registered` in a real production OAuth authorization URL. |
