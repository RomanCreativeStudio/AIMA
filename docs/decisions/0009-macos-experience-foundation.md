# ADR 0009: macOS Experience Foundation

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §2, §10, `apps/Shared/AIMACore/`, `apps/macos/`, `backend/src/conversation/`

## Context

Every backend system through Phase 1.8 (core orchestration, identity, workspaces, preferences, memory, knowledge, intent, approvals, tasks, health) existed with no client at all — `apps/macos`, `apps/ios`, and `apps/tvos` were structural placeholders. Phase 2.1 asked for the first usable AIMA application: a SwiftUI macOS app with a real navigation architecture, four screens (Dashboard, Chat, Workspace, Settings), typed API models, a networking layer, and tests — explicitly not yet the voice interface, external integrations, or automation execution described elsewhere in the roadmap.

This phase was executed in a Linux-only environment with no Xcode or macOS SDK available. That constraint shaped every structural decision below: the goal was to make as much of the app genuinely, mechanically verifiable as possible (real compiles, real test runs) rather than write SwiftUI code that could only be eyeballed, and to be explicit about the remaining gap rather than claim a verification that didn't happen.

## Decisions

### 1. Split into a platform-agnostic package plus a thin SwiftUI app

`apps/Shared/AIMACore` holds every model, the `APIClient` networking abstraction, configuration, mocks, and view models — no import of SwiftUI, AppKit, UIKit, or Combine anywhere in it. `apps/macos` is a small executable target that depends on it and adds only views and an app entry point. This mirrors the provider-abstraction pattern already used by `ai-engine` (`AIProvider`/`EmbeddingProvider`) and `backend/src/intent` (`IntentClassifier`): the platform/vendor-specific edge is isolated behind a protocol, and everything else is boring, testable Swift. It also means `apps/ios` and `apps/tvos` (§2, Future Apple TV Companion) can depend on the same package later without duplicating a single model or API call.

This split is also what made real Linux verification possible at all: `AIMACore` builds and its 37-test suite runs via plain `swift build`/`swift test`, while `apps/macos` was confirmed to fail *only* on `error: no such module 'SwiftUI'` (via `swift build`, after `AIMACore` itself built cleanly as its dependency) — proof the module boundary is clean and no logic errors are hiding behind the platform mismatch, without pretending a SwiftUI build actually happened.

### 2. `Observation`'s `@Observable`, not Combine's `ObservableObject`

The four view models (`DashboardViewModel`, `ChatViewModel`, `WorkspaceViewModel`, `SettingsViewModel`) were initially written against `ObservableObject`/`@Published`, the conventional SwiftUI-adjacent choice — but Combine has no Linux implementation, so nothing depending on it would build outside Xcode, closing off the verification path decision 1 relies on. Switching to the `Observation` framework's `@Observable` macro (confirmed working on Linux via a standalone test project first) keeps the same reactive-UI ergonomics with zero Combine dependency, at the cost of raising the package's platform minimums from macOS 13/iOS 16/tvOS 16 to macOS 14/iOS 17/tvOS 17 (the versions with Observation-integrated SwiftUI). Given this is a pre-release MVP with no existing user base to strand on older OS versions, that cost was accepted.

### 3. Swift Package Manager over a hand-crafted `.xcodeproj`

`apps/macos/Package.swift` declares an `executableTarget`; there is no `.xcodeproj`. Xcode opens a package manifest directly via "File > Open...", so nothing is lost for the eventual Mac developer, and the manifest itself is a plain text file `swift package dump-package` can validate without Xcode — another piece of decision 1's verification story.

### 4. A real backend gap, found and closed: conversation listing

The Chat screen's "conversation list" requirement had no backing endpoint — `ConversationService` could create a conversation and send/fetch messages, but nothing returned "all conversations in this workspace." This was in-scope to fix, not scope creep, since the macOS screen structurally cannot exist without it: added `ConversationService.listConversations(workspaceId)` and `GET /api/workspaces/:workspaceId/conversations`, ordered newest-active-first. "Active" needed a real signal, so `sendMessage` now calls a new `touchConversation()` after saving the user's message, bumping `updated_at` (previously a dead column) and a new `sequence` column. The `sequence` column exists for the same reason `messages.sequence` (`0003_message_sequence.sql`) and `pending_approvals.sequence` (`0006_approval_lifecycle.sql`) do: Postgres freezes `now()` at transaction start under READ COMMITTED, so two conversations touched inside the same transaction tie on `updated_at` alone. `0010_conversation_sequence.sql` adds the column and index; `touchConversation()` bumps it via `sequence = DEFAULT` (re-evaluating `nextval()`).

### 5. `JSONValue` for the backend's freeform JSONB fields

`preferences`, `assistantBehavior`, `metadata`, and approval `payload` are all backend JSONB columns with no fixed shape yet. Rather than invent a speculative Swift type for each, `JSONValue` is one recursive `Codable` enum (`.string`/`.number`/`.bool`/`.object`/`.array`/`.null`) used everywhere a JSONB field surfaces — consistent with this project's repeated preference for the boring, general solution over premature per-field modeling (`docs/DEVELOPMENT_SETUP.md` §9, Rule 1).

## Consequences

- `apps/Shared/AIMACore`'s 37 tests (model decoding against real backend response fixtures, `URLSessionAPIClient` against a stubbed `URLProtocol`, all four view models against `MockAPIClient`) are genuine, reproducible verification, runnable in CI on Linux with no Xcode dependency.
- The SwiftUI layer in `apps/macos` (views, navigation, `#Preview` blocks) has **not** been compiled, run, or previewed — that requires a real Mac with Xcode. `apps/macos/README.md` states this limitation explicitly rather than implying a build that didn't happen. This is the one concrete follow-up before the app can be considered done, not just written.
- `conversations.sequence` (migration 0010) is now the third table with this exact monotonic-ordering column; any future table needing "stable recency ordering" should reach for the same pattern rather than trusting `updated_at`/`created_at` alone.
- `apps/ios`/`apps/tvos` READMEs were updated to point at `apps/Shared/AIMACore` as their ready-made shared foundation — their own sprints should not need to re-solve models/networking/view-models, only add SwiftUI views.
