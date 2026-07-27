# ADR 0010: Daily Assistant Interface

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §2, §10, `apps/Shared/AIMACore/`, `apps/macos/`

## Context

Phase 2.1 gave AIMA its first usable macOS shell: four screens (Dashboard, Chat, Workspace, Settings) over a thin SwiftUI layer, backed by the platform-agnostic `AIMACore` package. It was explicitly a foundation — Dashboard only counted tasks rather than listing them, the Chat screen's intent/approval banner was read-only text, and there was no dedicated place to browse or act on approvals beyond the Dashboard's pending-only list. Phase 2.2 asked for the app to become something actually usable day to day: deeper Chat (Markdown, workspace-aware context), a real Approval UI (list, detail, approve/reject, and a chat-embedded card), and real Task display (status, priority) — still with no voice, no external integrations, and no automation execution.

This phase was executed in the same Linux-only environment as Phase 2.1 (no Xcode). That constraint surfaced a sharper version of the same problem this time: not just "SwiftUI can't compile here," but a specific Foundation API — `AttributedString(markdown:)` — that doesn't exist in the open-source Linux Foundation at all, confirmed by a failed trial build rather than assumed.

## Decisions

### 1. Approvals and Tasks become their own screens, not just richer Dashboard sections

The Dashboard's pending-approvals section and task-count rollup stay exactly as Phase 2.1 built them — they're a fast, at-a-glance summary, and that's the right shape for a dashboard. But "Approval detail" and "Display workspace tasks" (item 4) are fuller browsing experiences: filtering by any status, seeing a payload, seeing every task regardless of state. Rather than growing the Dashboard's cards into something that does both jobs badly, two new top-level sections were added — Approvals and Tasks — each following the same list-drives-detail (Approvals) or filtered-list (Tasks) shape already established by Chat's conversation list. `RootNavigationView`'s `AppSection` grew from four cases to six; a new `workspaceScopedView` helper collects the "real workspace vs. still loading vs. none selected" three-way branch all four workspace-scoped screens (Chat, Tasks, Approvals, and previously just Chat) now share, rather than triplicating it.

### 2. The chat approval card fetches the full `PendingApproval`, not just the id

`SendMessageResult.approvalDecision` (Phase 1.7) carries only a `state` and an optional `pendingApprovalId` — enough for the existing advisory intent banner, not enough for an actionable card (which needs the action type, payload, and expiry to render). `ChatViewModel.sendDraftMessage` now calls the new `APIClient.getApproval` immediately after a message result carries a real `pendingApprovalId`, storing the result as `lastPendingApproval`. This is a second network round-trip per turn requiring approval, accepted because approval-requiring turns are the rare case (no shipped capability defaults to Tier 3 yet — see Consequences) and because reusing the existing single-approval fetch (already needed by the Approvals detail pane) is simpler than growing `SendMessageResult`'s shape to inline the full record for a still-hypothetical capability.

### 3. `getApproval` closes a gap Phase 1.7 already opened but never used

The backend's `GET /api/workspaces/:workspaceId/approvals/:approvalId` route (`docs/decisions/0007-intent-and-approval-workflows.md`) has existed since Phase 1.7 with no client ever calling it — `AIMACore`'s `APIClient` protocol simply hadn't grown a method for it yet. Adding `getApproval` to the protocol, `URLSessionAPIClient`, and `MockAPIClient` required no backend change at all; it's the same pattern Phase 2.1 used when it discovered the conversations-list gap, except this time the endpoint was already there and only the client was missing.

### 4. A test hook simulates the one flow no shipped capability triggers yet

Every capability currently resolves to its code-registered default tier (`docs/decisions/0008-user-identity-and-workspace-intelligence.md`'s consequences), and none of those defaults is Tier 3 — so, honestly, `ApprovalEngine.evaluate()` never actually creates a real pending approval under today's shipped configuration, meaning the chat approval card has nothing genuine to render yet in a live system. Rather than leave that code path untested until some future phase promotes a capability to Tier 3, `MockAPIClient.forceNextMessageToRequireApproval(workspaceId:actionType:)` seeds a real `PendingApproval` and arranges for the next `sendMessage` call to return a decision pointing at it — an actor-isolated test hook in the same spirit as the existing `setShouldFail`. This lets `ChatViewModelTests` exercise fetch-card / approve-card / reject-card / clear-on-switch genuinely, ahead of the capability work that will eventually make this a real, live scenario.

### 5. Markdown rendering could not be made a testable `AIMACore` helper

The original plan (mirroring every other Phase 2.2 addition) was a small, Linux-testable `AIMACore.MarkdownRenderer` wrapping `AttributedString(markdown:)`. A trial build proved this API doesn't exist at all in the Linux Foundation this repo's toolchain ships — not merely untested, but genuinely absent (a real Apple-Foundation-only capability, unlike the rest of `Foundation`, which is cross-platform). Markdown parsing for `MessageBubble` therefore had to move into `apps/macos` directly, alongside the rest of the SwiftUI-only code this phase already couldn't verify on Linux. This is a narrower version of Phase 2.1's platform split, not a violation of it: the boundary is still "SwiftUI/platform-only code lives in `apps/macos`," it's just that this particular Foundation API turned out to belong on that side of the line too.

## Consequences

- `AIMACore`'s test suite grew from 37 to 54 tests, covering `getApproval`, `ApprovalsViewModel`, `TasksViewModel`, `JSONValue.displayString`, `TaskStatus.displayName`, and `ChatViewModel`'s new approval-card and conversation-switch-clears-stale-state behavior — all genuinely run via `swift test` on Linux.
- Chat's Markdown rendering is the one piece of Phase 2.2 with zero automated test coverage in this environment, and will remain so until it's exercised on a real Mac — called out explicitly in `apps/macos/README.md` and `apps/Shared/AIMACore/README.md` rather than left implicit.
- `ChatViewModel.selectConversation` now clears `lastIntent`/`lastApprovalDecision`/`lastPendingApproval` — a correctness fix uncovered while building the approval card (a stale card pointing at the wrong conversation's approval would have been a real bug, not just a cosmetic one), applied narrowly rather than expanded into an unrelated cleanup pass.
- The Approvals screen's "Approve"/"Reject" and the Dashboard's inline buttons now both exist and both work against the same `ApprovalEngine` routes; neither supersedes the other, since the Dashboard's is a quick action and the Approvals screen's is the full browsing experience — consistent with decision 1.
- No backend changes were needed this phase beyond what Phase 1.7 already shipped — Phase 2.2 was purely a client-side deepening, unlike Phase 2.1 which required a small backend addition (`listConversations`).
