# ADR 0003: Conversation Pipeline Design

**Status:** Decided
**Date:** 2026-07-27
**Relates to:** `docs/TECHNICAL_ARCHITECTURE.md` §4 & §7, `backend/src/conversation/`, `database/migrations/0003_message_sequence.sql`

## Context

The Conversation Intelligence Sprint connects the memory system (Intelligence Sprint) to real AI conversations: `User Input → Workspace Context → Memory Retrieval → Context Assembly → AI Provider → Response → Conversation Storage`. Three design questions came up while building it.

## Decisions

### 1. Message ordering needs an explicit sequence, not just `created_at`

`ConversationService.sendMessage` saves a user message and its assistant reply back to back, normally within the same request. Under Postgres's default READ COMMITTED isolation, `now()` is frozen at transaction start — so two inserts in one transaction can get an *identical* `created_at`. Sorting by `created_at` alone left message order undefined in exactly this case (caught by a failing integration test during development, not a hypothetical). `database/migrations/0003_message_sequence.sql` adds a monotonic `sequence` (`BIGSERIAL`) column, and `listMessages` orders by it instead. `created_at` is kept for display purposes; `sequence` is the ordering source of truth.

### 2. Context limits are count-based, not token-based

Both conversation history and retrieved memory are capped by count (`historyLimit` = 10 messages, `memoryLimit` = 5 memories, both configurable per `ConversationService` instance) rather than by counting tokens against a specific model's context window. A single memory snippet is also truncated to 500 characters before being included in the prompt. This is simpler to implement and reason about than token-accounting, and sufficient for an MVP with a single user and modest conversation volumes. If a future model's context window or usage pattern makes count-based caps insufficient, token-aware budgeting is a follow-up decision — not built preemptively here (`docs/DEVELOPMENT_SETUP.md` §9, Rule 1).

### 3. `generate_ai_response` is logged but not gated

Every AI-generated reply is logged to `action_log` via the existing `PermissionEngine`/capability-registry pattern, under a new `generate_ai_response` capability at Tier 1 (`suggest`). Suggest-tier actions aren't gated by design (`docs/PRODUCT_BIBLE.md` §5) — a conversational reply has no external effect and nothing to approve. The reason to route it through the Permission Engine at all, rather than logging it ad hoc, is consistency and transparency: every AIMA action (chat replies included) has one uniform, auditable trail, and if a future capability layered on top of a response (e.g., "this reply also drafted an email") needs a different tier, the registry is already the single place that decision lives.

## Consequences

- `ConversationService` depends on `MemoryService`, `AIProvider`, `ActionLogger`, and `PermissionEngine` — all four abstractions built in prior sprints — with no new abstraction introduced for the pipeline itself. `contextAssembly.ts` is a pure function, deliberately kept outside the service class so it can be unit-tested without a database.
- Cross-workspace access is blocked at the same checkpoint for both memory and messages: `ConversationService` always resolves and verifies `(conversationId, workspaceId)` together before touching history or triggering retrieval, so a request that guesses another workspace's conversation ID learns nothing (`ConversationNotFoundError`, mapped to a generic 404 — it does not reveal whether the conversation exists elsewhere).
- The AI response today is stored as plain text. Turning part of that response into a structured, tiered intent (e.g., a proposed Tier 2 draft) is out of scope until a real external-action capability exists to route it to — tracked as Integration Sprint work in `docs/TECHNICAL_ARCHITECTURE.md` §7 and §10.
