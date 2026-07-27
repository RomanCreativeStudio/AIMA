# AIMA Technical Architecture Document

**Version:** 0.1 (Founding Draft)
**Status:** Engineering Source of Truth — companion to `docs/PRODUCT_BIBLE.md`
**Owner:** Lead Software Architect
**Last Updated:** 2026-07-27

This document translates the AIMA Product Bible into an engineering blueprint. Where the Product Bible defines *what AIMA must be* (principles, permission tiers, workspace separation), this document defines *how the system is built* to deliver on those commitments. If any part of this architecture conflicts with the Product Bible, the Product Bible wins and this document must be revised.

---

## 1. System Overview

AIMA is a single logical assistant exposed through multiple client surfaces, backed by one shared backend, one shared data layer, and one AI orchestration layer. There is one user, one identity, and one continuous memory — but that memory and data are partitioned by workspace (Section 6) and gated by a permission system (Section 5) at every layer, not just in the UI.

```
                    ┌──────────────────────────────────────────────┐
                    │                  Clients                      │
                    │  macOS app · iPhone app · Web dashboard       │
                    │  (Future: Apple TV companion)                 │
                    └───────────────────┬────────────────────────────┘
                                        │ HTTPS / WebSocket (auth'd)
                    ┌───────────────────▼────────────────────────────┐
                    │                Backend API                     │
                    │  Auth · Workspace router · Permission engine   │
                    │  Action logger · Business logic (RCS/MFS/etc.) │
                    └───────┬───────────────────────┬────────────────┘
                            │                        │
                ┌───────────▼───────────┐  ┌─────────▼──────────────┐
                │   Database + Storage   │  │   AI Orchestration       │
                │  (workspace-scoped)    │  │  Model calls · Memory    │
                │                        │  │  Context · Retrieval     │
                └────────────────────────┘  └──────────┬───────────────┘
                                                        │
                                            ┌───────────▼───────────┐
                                            │   LLM Provider(s)      │
                                            │  (Claude API, etc.)    │
                                            └────────────────────────┘
```

**Core architectural commitments (non-negotiable, inherited from the Product Bible):**
- The backend — not the client, and not the AI model — is the enforcement point for permissions, workspace isolation, and logging. Clients render and collect input; they do not decide what's allowed.
- The AI model proposes; the backend disposes. A model output that implies an external action is never executed directly — it is always routed through the permission engine first.
- One codebase, one API, many thin clients. Business logic lives in the backend, not duplicated per platform.

---

## 2. Application Architecture

All clients are **thin, presentation-focused surfaces** over the same backend API. No client holds business logic, permission logic, or direct AI/database access. This keeps the multi-platform surface (macOS, iOS, web, future tvOS) sustainable for a solo developer.

### Shared approach
- **One shared codebase across Apple platforms** using Swift and SwiftUI (macOS + iPhone + future Apple TV share a single SwiftUI target with platform-specific view variants). This is the single highest-leverage decision in this document for a solo developer in the Apple ecosystem.
- **Web dashboard as a separate lightweight client**, same API, used for cross-platform access and quick browser-based interaction (e.g., from a work PC). Not a full feature-parity requirement in early versions — it can lag the native app.
- All clients authenticate the same way (Section 3) and render the same underlying concepts: workspaces, conversation, suggestions/drafts/pending-approvals, and activity log.

### macOS App
- Primary "power user" surface: full workspace switching, side-by-side drafts, deeper project/knowledge views.
- Long-lived, persistent connection to the backend for real-time AI responses and notifications.

### iPhone App
- Optimized for quick capture (notes, tasks, voice) and reviewing/approving pending actions on the go.
- Push notifications used for Tier 3 approval requests ("AIMA has a draft reply ready for Client X — review?").

### Web Dashboard
- Read/write access to the same workspaces via browser; useful when away from an Apple device.
- No local storage of sensitive data beyond session-scoped cache.

### Future Apple TV Companion
- Presentation-only surface (e.g., ambient daily briefing, MFS production board on a big screen). Not an input-heavy surface. Deferred until core product is proven — mentioned here only to confirm the shared-SwiftUI approach won't need rearchitecting to support it later.

---

## 3. Backend Architecture

### API Layer
- A single backend service exposing a versioned API (REST for CRUD/workflow operations, WebSocket or SSE for streaming AI responses and real-time notifications).
- API is organized around **workspace-scoped resources**: every request carries a workspace context, and the API layer resolves data access accordingly (see Section 6).
- The API layer is the only component allowed to talk to the database, storage, and the AI orchestration layer. Clients never call the LLM provider or database directly.

### Authentication
- Single-user system in early versions — authentication exists primarily to secure the account against unauthorized device/browser access, not to manage multiple tenants.
- Use a managed auth provider (Section 8) rather than building auth from scratch — solo developer time is better spent on AIMA's actual value.
- Session-based auth for clients (short-lived access tokens + refresh tokens), device-level revocation supported (e.g., "sign out this device") from day one, since this is a security-relevant control that's cheap to add early and expensive to retrofit.

### Database
- One primary relational database, with a `workspace_id` (or equivalent partition key) present on every workspace-scoped table, enforced at the schema and query level — not just filtered in application code (Section 6 details isolation).
- Core entities: Users, Workspaces, Conversations/Messages, Memory Records, Knowledge Documents, Tasks/Projects, Leads/Clients (RCS), Story/Character Records (MFS), Action Log entries, Permission Tier assignments.

### Storage
- Separate object storage for unstructured/binary content: documents, images, proposal PDFs, creative assets, exported files.
- Storage objects reference their owning workspace and are subject to the same isolation rules as database rows.

### Security
- All traffic over TLS. All stored sensitive data encrypted at rest.
- Secrets (API keys, provider credentials) held in a managed secrets store, never in client code or repo.
- Detailed in Section 9.

---

## 4. AI Architecture

### AI Model Communication
- The backend's AI orchestration layer is the sole caller of the LLM provider. It assembles: system instructions (AIMA's identity, active workspace rules, permission tier context), retrieved memory/knowledge (below), and the user's current input, then streams the response back through the API layer to the client.
- Model-agnostic interface internally (a thin adapter around the provider call) so the underlying model/provider can be upgraded without touching the rest of the system.

### Memory System
Implemented in the Intelligence Sprint as `memory_records` (database/migrations/0002_memory_scopes.sql) plus `backend/src/memory/memoryService.ts`. Four scopes cover the categories from docs/PRODUCT_BIBLE.md:

- **`workspace`** — general durable knowledge about a workspace (the default/catch-all).
- **`user`** — a durable personal-preference fact (e.g., "always draft proposals in a formal tone"). Recorded **within** a workspace, not globally across workspaces — see the design note below.
- **`conversation`** — tied to a specific `conversation_id`; required for this scope.
- **`project`** — tied to a `project_key` tag (a lightweight string, not a full `projects` table, to avoid a relational entity the MVP doesn't need yet); required for this scope.

**Design note (see `docs/decisions/0002-memory-and-embeddings.md`):** every memory row still carries a required `workspace_id` — workspace isolation (§6) is never relaxed, even for "user" scope. A memory scoped `user` is a durable fact recorded *inside* a given workspace, not a cross-workspace global. True cross-workspace recall remains the explicit, logged bridging described in docs/PRODUCT_BIBLE.md §6, and is not implemented by the memory system itself.

Short-term (in-session conversation history) memory is not yet implemented — `conversations`/`messages` tables exist (§3) but nothing yet writes to them; that lands with the chat pipeline in the Integration Sprint.

### Context Management
- `MemoryService.getWorkspaceContext(workspaceId, query, limit)` is the retrieval entry point: it ranks all memory in a workspace (any scope) by relevance to a query string. This is the retrieval **building block** — it is not yet wired into an actual AI request's system prompt (that assembly step — workspace → memory → knowledge → conversation turns → new input — is Integration Sprint scope, once the chat pipeline exists to assemble into).
- Context retrieval is workspace-scoped by construction: `MemoryService.search` always filters by `workspace_id`, so it is not possible for MFS character memory to be returned for an RCS query unless the caller explicitly bridges workspaces (Product Bible §6) — which nothing in the current codebase does yet.

### Knowledge Retrieval
- Retrieval uses pgvector's HNSW index (`idx_memory_records_embedding`, cosine distance) over the `embedding` column — similarity search happens in Postgres, not in application code.
- Embeddings are produced through the same provider-abstraction pattern as chat completions: `ai-engine/src/embeddings/` defines an `EmbeddingProvider` interface with `MockEmbeddingProvider` (deterministic hashed bag-of-words, no network — the default) and `OpenAIEmbeddingProvider` (real embeddings via `text-embedding-3-small`, called with `fetch` rather than adding the full `openai` SDK dependency). Selected at runtime via `EMBEDDING_PROVIDER`, mirroring `AI_PROVIDER`.
- `MemoryService.search` returns ranked results (`1 - cosine_distance` as `score`), optionally filtered by scope, `conversationId`, or `projectKey` — this is the RAG "retrieve relevant chunks" step; the "inject into the prompt" step is not yet built (see Context Management above).

### Future Multi-Agent Capability
- Not built in the MVP, but the orchestration layer is designed so that a single "AIMA" request can later be decomposed into specialized sub-agents (e.g., a "research agent," a "drafting agent," a "code agent") coordinated by a controller — because context assembly, memory, and permission-checking are already centralized rather than duplicated per client. This is a reason to keep orchestration server-side and centralized now, not a feature to build now.

---

## 5. Permission Architecture

This section is the technical enforcement of the Product Bible's four-tier system (Suggest / Prepare / Execute with Approval / Automatic Safe). Enforcement lives in the backend's **Permission Engine**, a dedicated component every action-producing code path must pass through.

### Mechanism
1. Every capability in the system is registered with a **declared tier** (Tier 1–4) in a central capability registry — no code path can perform an action without an entry here (Development Rule from Product Bible §9: "No unclassified capabilities").
2. When the AI orchestration layer produces an output that maps to a registered action (e.g., "send this email," "log this task"), it does not execute it — it emits an **intent object**: `{ action_type, tier, payload, workspace, rationale }`.
3. The Permission Engine inspects the intent's tier:
   - **Tier 1 (Suggest):** Rendered to the user as text/UI only. No intent execution path exists — nothing to gate.
   - **Tier 2 (Prepare):** The engine persists the drafted artifact (email draft, proposal, plan) in a "pending review" state, visible to the user. No external or irreversible effect occurs.
   - **Tier 3 (Execute with Approval):** The engine creates a **pending approval record** and blocks execution until the specific user, on the specific client, explicitly confirms that specific instance. Only after confirmation does the engine invoke the actual action (send email, push commit, etc.).
   - **Tier 4 (Automatic Safe):** The engine checks whether this action *category* has been explicitly promoted by the user (a flag on the capability registry entry, user-controlled). If yes, it executes immediately; if the promotion flag is ever off, it behaves as Tier 3.
4. Every Tier 3 and Tier 4 execution writes an entry to the **Action Log** (what, when, why, which workspace, which tier, outcome) before returning success to the user. Logging is not optional and not best-effort — a failed log write blocks the action.
5. Certain action types (external communication, financial actions, deletions) are marked **tier-locked at Tier 3 minimum** in the registry itself — the promotion mechanism structurally cannot move them to Tier 4, per Product Bible §5.

### Why this belongs in the architecture, not the prompt
Relying on the AI model to "remember" to ask for permission is not sufficient — model behavior is probabilistic and prompts can be misinterpreted or, in future multi-agent scenarios, bypassed. The Permission Engine is a deterministic backend gate that runs regardless of what the model outputs, ensuring the Product Bible's guarantees hold even as the AI layer evolves.

---

## 6. Workspace Architecture

Workspace isolation (Personal, RCS, MFS, Development) is enforced structurally at the data layer, not just filtered in the UI.

- **Partitioning:** Every workspace-scoped table/collection carries a `workspace_id`. All queries issued by the API layer are scoped by the active workspace context derived from the authenticated request — there is no code path that queries "all data" without an explicit, logged cross-workspace exception.
- **Memory and knowledge partitioning:** Long-term memory records and knowledge base documents (Section 4) are tagged by workspace at creation and retrieved only within that workspace's scope by default.
- **Cross-workspace bridging:** When the user explicitly requests it (Product Bible §6, Cross-Workspace Rule 2), the API layer performs an explicit, named cross-workspace query (e.g., `bridge_query(source=MFS, target=RCS, reason=...)`), which is itself logged as an action. This keeps bridging rare, visible, and intentional rather than an accidental default.
- **Workspace-aware permission defaults:** The capability registry (Section 5) can carry different default tiers per workspace for the same action type — e.g., "send email" may default to a stricter confirmation flow in RCS (client-facing, reputational risk) than a similar internal notification in Personal.
- **UI-level reinforcement:** Clients visually distinguish the active workspace (e.g., color/label) so the user always knows which context AIMA is operating in — a usability safeguard on top of the structural backend enforcement.

---

## 7. Data Flow

**User → Application → Backend → AI → Response → User**

1. **User** provides input via a client (typed message, voice, or a structured action like "create task").
2. **Application (client)** authenticates the request, attaches the active workspace context, and sends it to the Backend API. The client performs no business logic — it forwards intent and renders results.
3. **Backend (API layer)** validates the request, resolves workspace scope, assembles relevant context (recent conversation, retrieved memory/knowledge for that workspace — Section 4), and forwards an AI request to the orchestration layer.
4. **AI (orchestration + model)** generates a response, which may include plain text and/or one or more **intents** (proposed actions with a declared tier).
5. Intents are passed to the **Permission Engine** (Section 5):
   - Tier 1/2 intents are attached to the response as suggestions/drafts.
   - Tier 3 intents create a pending approval and are attached to the response as "awaiting your confirmation."
   - Tier 4 intents (if promoted) execute immediately and are logged, then attached to the response as "done — here's what I did."
6. **Response** (text + any drafts/pending approvals/completed-action confirmations) streams back through the Backend API to the **Application**.
7. **User** reads the response, and — for Tier 2/3 items — takes the next action (edit, approve, decline), which re-enters this same flow as a new request.

Every hop in this flow is workspace-scoped and, where an action occurred, logged — so the user (or a future audit view) can always reconstruct "what happened, in what workspace, at what tier, and why."

---

## 8. Technology Recommendations

Recommendations are optimized for **one developer, Apple-first, low operational overhead, and fast path to a working MVP** — while avoiding choices that would require a rewrite to scale later.

| Layer | Recommendation | Why |
|---|---|---|
| macOS + iPhone (+ future tvOS) app | **Swift + SwiftUI**, single shared codebase with platform targets | Native Apple integration (notifications, Shortcuts, iCloud), one codebase for three platforms, strong tooling, no cross-platform framework tax. |
| Web dashboard | **Next.js (React) + TypeScript** | Mature, huge ecosystem, easy to deploy, good fit for a secondary/lighter-weight client; TypeScript keeps it consistent with a Node backend if chosen. |
| Backend API | **Node.js (TypeScript) + Express** — decided for the Foundation Sprint, see [ADR 0001](decisions/0001-backend-stack.md) | Both Node and Python were viable; Node was chosen to share TypeScript types with `ai-engine/` and the future web dashboard. |
| Database | **PostgreSQL** (managed, e.g., Supabase or a managed Postgres host) | Relational integrity for workspace partitioning, mature, supports `pgvector` for embeddings — avoids running a separate vector database in the MVP. |
| Object storage | **S3-compatible storage** (e.g., Supabase Storage, Cloudflare R2, or AWS S3) | Cheap, standard, works with any backend choice. |
| Auth | **Managed auth provider** (e.g., Supabase Auth, Clerk, or Auth0) | Don't build auth in-house; get sessions, device management, and security best practices "for free." |
| AI model provider | **Claude API (Anthropic)** as primary model | Strong reasoning and tool-use for an assistant that must reliably respect permission tiers; use the provider-agnostic adapter (Section 4) to avoid lock-in. |
| Embeddings / retrieval | **`pgvector` inside Postgres** initially; dedicated vector DB only if scale demands it later | Avoids introducing a second database system before it's needed. |
| Hosting / deployment | **Managed platform** (e.g., Fly.io, Render, or Vercel for the web dashboard + API) | Minimal DevOps burden for a solo developer; scale-up path exists without a re-architecture. |
| Notifications (mobile) | **Apple Push Notification service (APNs)**, native | Required for Tier 3 approval prompts on iPhone; standard Apple integration. |
| Background/scheduled jobs | Lightweight job queue (e.g., built-in cron on the hosting platform, or a simple queue like BullMQ if Node) | Needed for things like daily briefings or follow-up reminders; keep it simple until volume demands more. |

**Guiding rule:** every recommendation favors a **managed service over self-hosted infrastructure** wherever the cost is reasonable, because solo-developer time is the scarcest resource in this project — not infrastructure spend.

---

## 9. Security Considerations

### Authentication
- Managed auth provider (Section 8) with short-lived access tokens and refresh tokens.
- Per-device session tracking with user-visible "signed in devices" list and one-tap revocation.
- All authentication endpoints rate-limited to mitigate credential-stuffing/brute-force attempts, even in a single-user system (defense against a compromised password).

### Data Protection
- Encryption in transit (TLS everywhere) and at rest (managed database/storage encryption).
- Workspace partitioning (Section 6) enforced at the query layer, treated as a security boundary, not just an organizational convenience.
- Regular, automated backups of the database and object storage, with a tested restore process — the user's client data, creative IP, and code context are irreplaceable if lost.

### API Security
- All backend endpoints require authenticated, workspace-scoped requests; no anonymous or cross-workspace-by-default endpoints.
- Input validation and output encoding on every endpoint to prevent injection-class vulnerabilities.
- LLM provider API keys and other secrets held server-side only, in a managed secrets store — never shipped in client binaries or web bundles.
- Rate limiting on AI-invoking endpoints to control cost exposure and abuse risk.

### User Privacy
- No user data (client details, creative IP, code, personal notes) is used to train third-party models beyond what the LLM provider's data-use terms allow for API traffic — this must be explicitly verified against the chosen provider's policy before launch.
- Clear, user-visible data boundaries: the user can see what AIMA has stored about them, per workspace, and can delete it.
- The Action Log (Section 5) doubles as a privacy tool: the user can always see what AIMA did with their data and when.

---

## 10. Development Roadmap

Four sprints, each producing a working, demonstrable increment. Scope is intentionally conservative per sprint — the goal is a real product quickly, not a fully-featured one immediately.

### Foundation Sprint
- Stand up backend (API layer, managed auth, Postgres with workspace partitioning, object storage).
- Build the macOS/iPhone shared SwiftUI client shell: login, workspace switcher, basic chat interface.
- Implement Tier 1 (Suggest) and Tier 2 (Prepare) only — no external actions yet.
- Basic conversation flow: user message → AI response, scoped to a workspace.
- **Exit criteria:** User can log in, pick a workspace, chat with AIMA, and receive workspace-appropriate responses and drafts.

### Intelligence Sprint
- Build long-term memory storage and retrieval (Section 4), scoped per workspace. ✅ Done — `memory_records` scope model, `MemoryService.createMemory`/`search`/`getWorkspaceContext`, pgvector HNSW ranking, workspace-isolated by construction.
- Build project knowledge base ingestion + retrieval (embeddings via `pgvector`). ✅ Done as the `project` memory scope (`project_key` tag) — a full document-ingestion pipeline (e.g., chunking uploaded files) is not yet built; today's "knowledge" is whatever is explicitly stored as a memory record via the API.
- Improve context assembly so responses reflect real memory/history, not just the current conversation. ⏳ Not done — `getWorkspaceContext` provides the ranked retrieval; wiring its output into an actual chat request's system prompt is Integration Sprint scope (no chat pipeline exists yet to assemble into).
- **Exit criteria met:** AIMA can store and retrieve relevant memory/knowledge per workspace, ranked by relevance, with permission enforcement and workspace isolation intact. Retrieval is not yet connected to a live conversation — that requires the Integration Sprint's chat pipeline.

### Integration Sprint
- Build the Permission Engine fully (Section 5): capability registry, pending-approval flow, Tier 3 execution, Action Log.
- Implement first real external-action capability end-to-end (e.g., sending an email draft after approval, or a GitHub integration action).
- Add push notifications (iPhone) for pending approvals.
- Ship the web dashboard as a secondary client against the now-stable API.
- **Exit criteria:** AIMA can prepare and, upon explicit approval, execute at least one real external action, fully logged and visible to the user.

### Testing Sprint
- Security review pass: verify workspace isolation cannot be bypassed via API, confirm no secrets are reachable from client code, validate rate limiting and auth revocation.
- Permission system audit: exercise every registered capability and confirm it behaves exactly per its declared tier, including the Tier-3-minimum lock on external/irreversible actions.
- Real-world usage testing across all four workspaces with actual RCS/MFS/personal/dev data to surface UX friction and incorrect context bleed.
- Backup/restore drill: confirm database and storage backups actually restore cleanly.
- Fix and harden based on findings; document known limitations honestly rather than hiding them.
- **Exit criteria:** The developer can confidently use AIMA daily across all workspaces, trusting that permission boundaries, workspace isolation, and data durability hold under real use.
