# AIMA Engineering Handbook v2.0

**Document ID:** HB-001
**Document Name:** AIMA Engineering Handbook
**Version:** 2.4.0
**Status:** Active living source of truth
**Authority Level:** Binding engineering handbook; subordinate to the AIMA Constitution (`CONST-001`)
**Owner:** Lead Product Architect / Lead Software Architect
**Dependencies:** `CONST-001`, ADR index, Technical Architecture, Development Setup, Production Setup
**Dependents:** Architecture documents, ADRs, requirements, API/database/testing/deployment documentation, sprint plans
**Review Frequency:** Every sprint close and before every major release
**Last Updated:** 2026-08-01
**Related Documents:** [`docs/CONSTITUTION.md`](CONSTITUTION.md), [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md), [`docs/DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md), [`docs/README.md`](README.md)

---

## Document Governance

### Purpose

This handbook is the living engineering source of truth for AIMA. It preserves the founding Product Bible, organizes engineering knowledge into stable volumes, and defines how future documentation evolves without full rewrites.

### Owner

The handbook is jointly owned by the Lead Product Architect and Lead Software Architect until a formal Engineering Council is active.

### Authority Level

1. **AIMA Constitution (`CONST-001`)** — highest authority. Any conflict is resolved in favor of the Constitution.
2. **AIMA Engineering Handbook (`HB-001`)** — binding product and engineering operating model.
3. **Architecture documents (`ARCH-*`) and ADRs (`ADR-*`)** — binding implementation and decision records within their stated scope.
4. **Sprint, setup, API, database, testing, and deployment documents** — operational guidance subordinate to the above.

### Version

Current handbook version: **2.0.0**.

### Status

Active. This document replaces the Product Bible as the broader engineering handbook while preserving the Product Bible's original content in Volume I and related volume sections.

### Review Frequency

- Sprint close: verify links, changed assumptions, and newly created documentation IDs.
- Major release: review all volume summaries, governance tables, and traceability placeholders.
- Constitution change: immediate impact review.

### Update Triggers

Update this handbook when any of the following occurs:

- A constitutional article changes or is added.
- A product principle, permission tier, workspace rule, roadmap item, or engineering law changes.
- A new major subsystem is introduced.
- A new ADR changes an existing architectural commitment.
- A requirement affects multiple volumes.
- A documentation gap blocks implementation or review.

### Semantic Versioning Policy

- **Major (`X.0.0`)**: structural reorganization, authority model change, or constitutional alignment change.
- **Minor (`2.X.0`)**: new volume, new chapter, new governance artifact, or substantial content addition.
- **Patch (`2.0.X`)**: typo fixes, link repairs, clarifications that do not alter meaning.

### Change Log

| Version | Date | Change |
| --- | --- | --- |
| 2.4.0 | 2026-08-01 | Established the canonical Engineering Change Impact Analysis (ECIA) framework: added `docs/governance/ECIA-INDEX.md` and `docs/governance/ECIA-TEMPLATE.md`, moved the inline ECIA checklist and template there (preserved, not deleted) and extended them with Architecture/ADRs/Implementation/Security/Operations categories, registered `ECIA-*` in the Permanent Numbering Standard and `ECIA-INDEX`/`ECIA-TEMPLATE` in the Documentation Ownership and Master Documentation Index tables. No ECIA records, requirements, ADRs, implementations, or tests were invented — the framework is empty by design. |
| 2.3.0 | 2026-08-01 | Established the canonical Requirements Traceability Matrix: added `docs/requirements/RTM.md` (`RTM-001`), moved the inline Requirements Traceability Matrix section's table and column definitions there (preserved, not deleted), registered `RTM-*` in the Permanent Numbering Standard and `RTM-001` in the Documentation Ownership and Master Documentation Index tables. No requirements, ADRs, implementations, or tests were invented — the matrix's one row remains the pre-existing illustrative placeholder. |
| 2.2.0 | 2026-08-01 | Established the Requirements framework: added `docs/requirements/REQ-TEMPLATE.md` and `docs/requirements/REQ-INDEX.md`, registered `REQ-INDEX`/`REQ-TEMPLATE` in the Master Documentation Index, updated the Documentation Ownership table's Requirements row to point at the real (no longer "Future") `docs/requirements/` location, and added a note to the Requirements Traceability Matrix clarifying its `REQ-001 Placeholder` row is illustrative, not a registered requirement. No requirements were authored — the framework is empty by design. |
| 2.1.0 | 2026-08-01 | Established the ADR framework: added `docs/decisions/ADR-TEMPLATE.md` and `docs/decisions/ADR-INDEX.md`, registered `ADR-INDEX`/`ADR-TEMPLATE` in the Master Documentation Index, and replaced this handbook's inline ADR list with a pointer to the new canonical index (per this handbook's own Documentation Review Workflow: preserve existing useful content, move it rather than delete it). |
| 2.0.1 | 2026-08-01 | Reconciliation patch: imported the authoritative Constitution text into `CONST-001` (replacing its placeholder), cleared now-stale "placeholder" language pointing at it, and registered `DEV-001`/`DEPLOY-001`/`DOC-INDEX-001` in the Permanent Numbering Standard, Documentation Ownership, and Master Documentation Index tables — those documents already declared these IDs in their own ADS headers but were never added to the registries. |
| 2.0.0 | 2026-07-31 | Reorganized the Product Bible into the AIMA Engineering Handbook v2.0, added ADS v1.0, stable IDs, volume structure, traceability, ECIA, and governance. |
| 0.1 | 2026-07-27 | Founding Product Bible draft. |

### Documentation Ownership

| Area | Stable ID Prefix | Owner | Primary Location |
| --- | --- | --- | --- |
| Constitution | `CONST-*` | Founder / Engineering Council | `docs/CONSTITUTION.md` |
| Handbook | `HB-*` | Lead Product Architect / Lead Software Architect | `docs/PRODUCT_BIBLE.md` |
| Architecture | `ARCH-*` | Lead Software Architect | `docs/TECHNICAL_ARCHITECTURE.md` and future `docs/architecture/` |
| ADRs | `ADR-*` | Authoring engineer + reviewer | `docs/decisions/` |
| Requirements | `REQ-*` | Product owner | `docs/requirements/` |
| APIs | `API-*` | Backend owner | Future `docs/api/` |
| Risks | `RISK-*` | Engineering Council | Future `docs/governance/risk-register.md` |
| Technical debt | `TD-*` | Engineering Council | Future `docs/governance/technical-debt-register.md` |
| Sprints | `SPR-*` | Sprint owner | Future `docs/sprints/` |
| Development Setup | `DEV-*` | Lead Software Architect | `docs/DEVELOPMENT_SETUP.md` |
| Production Setup | `DEPLOY-*` | Lead Software Architect | `docs/PRODUCTION_SETUP.md` |
| Documentation Index | `DOC-INDEX-*` | Lead Product Architect / Lead Software Architect | `docs/README.md` |
| Requirements Traceability Matrix | `RTM-*` | Product owner + Lead Software Architect | `docs/requirements/RTM.md` |
| Engineering Change Impact Analysis | `ECIA-*` | Authoring engineer + reviewer | `docs/governance/` |

### Documentation Review Workflow

1. Identify impacted document IDs before writing.
2. Preserve existing useful content; move it rather than delete it.
3. Mark unknown details as **Placeholder** or **Open Question** instead of inventing implementation facts.
4. Add or update cross-references in the master documentation index.
5. Run documentation validation (`git diff --check` and Markdown formatting/link checks where available).
6. Include documentation impact in the PR body.

---

## AIMA Documentation Standard (ADS) v1.0

Every major engineering document must include this metadata block:

```markdown
**Document ID:** <STABLE-ID>
**Document Name:** <Human-readable name>
**Version:** <SemVer>
**Status:** Draft | Active | Deprecated | Superseded
**Authority Level:** <Constitution | Handbook | Architecture | ADR | Operational>
**Owner:** <Role>
**Dependencies:** <Documents this depends on>
**Dependents:** <Documents/processes that depend on this>
**Review Frequency:** <Cadence>
**Last Updated:** <YYYY-MM-DD>
**Related Documents:** <Links>
```

### Permanent Numbering Standard

Stable identifiers must never be reused after publication.

| Prefix | Meaning | Example |
| --- | --- | --- |
| `CONST-*` | Constitution articles/documents | `CONST-001` |
| `HB-*` | Handbook sections/documents | `HB-001` |
| `ADR-*` | Architecture Decision Records | `ADR-001` |
| `ARCH-*` | Architecture documents | `ARCH-001` |
| `REQ-*` | Requirements | `REQ-001` |
| `API-*` | API documents/endpoints | `API-001` |
| `RISK-*` | Risks | `RISK-001` |
| `TD-*` | Technical debt items | `TD-001` |
| `SPR-*` | Sprints | `SPR-001` |
| `DEV-*` | Development setup/workflow documents | `DEV-001` |
| `DEPLOY-*` | Production/deployment documents | `DEPLOY-001` |
| `DOC-INDEX-*` | Documentation index documents | `DOC-INDEX-001` |
| `RTM-*` | Requirements Traceability Matrix document(s) | `RTM-001` |
| `ECIA-*` | Engineering Change Impact Analysis records | `ECIA-001` |

### Universal Chapter Template

Every new major chapter should include these headings, using **Placeholder** when details are not yet known:

- Purpose
- Scope
- Requirements
- Architecture
- Dependencies
- Interfaces
- Security
- Performance
- Scalability
- Failure Recovery
- Testing
- Observability
- Future Expansion
- Technical Debt
- Known Risks
- Open Questions
- Related Constitution Articles
- Related ADRs
- Related Requirements
- Related APIs
- Related Database Objects
- Related Future Epics

---

## Master Documentation Index

| Document Area | Stable ID | Current Location | Status |
| --- | --- | --- | --- |
| Constitution | `CONST-001` | [`docs/CONSTITUTION.md`](CONSTITUTION.md) | Active. Highest-authority governance document. |
| Engineering Handbook | `HB-001` | [`docs/PRODUCT_BIBLE.md`](PRODUCT_BIBLE.md) | Active. |
| Technical Architecture | `ARCH-001` | [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) | Active companion architecture document. |
| ADRs | `ADR-0001+` | [`docs/decisions/`](decisions/) | Active decision log. |
| ADR Index | `ADR-INDEX` | [`docs/decisions/ADR-INDEX.md`](decisions/ADR-INDEX.md) | Active. Canonical index of every ADR's status, date, and file. |
| ADR Template | `ADR-TEMPLATE` | [`docs/decisions/ADR-TEMPLATE.md`](decisions/ADR-TEMPLATE.md) | Active. Governs `ADR-0022` onward. |
| Roadmap | `HB-ROADMAP` | Volume I and Volume XI below; [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) §10 | Active. |
| Sprint Documentation | `SPR-*` | Future `docs/sprints/` | Placeholder. |
| Requirements | `REQ-*` | [`docs/requirements/`](requirements/) | Framework active (`REQ-INDEX`/`REQ-TEMPLATE`); no requirements registered yet. |
| Requirements Index | `REQ-INDEX` | [`docs/requirements/REQ-INDEX.md`](requirements/REQ-INDEX.md) | Active. Canonical index of every requirement's status and file; currently empty. |
| Requirements Template | `REQ-TEMPLATE` | [`docs/requirements/REQ-TEMPLATE.md`](requirements/REQ-TEMPLATE.md) | Active. Governs how future requirements (`REQ-001` onward) are authored. |
| Requirements Traceability Matrix | `RTM-001` | [`docs/requirements/RTM.md`](requirements/RTM.md) | Active. Canonical requirement↔architecture↔ADR↔database↔API↔implementation↔tests↔documentation matrix; currently one illustrative placeholder row. |
| ECIA Index | `ECIA-INDEX` | [`docs/governance/ECIA-INDEX.md`](governance/ECIA-INDEX.md) | Active. Canonical index of every Engineering Change Impact Analysis record; currently empty. |
| ECIA Template | `ECIA-TEMPLATE` | [`docs/governance/ECIA-TEMPLATE.md`](governance/ECIA-TEMPLATE.md) | Active. Governs how future ECIA records (`ECIA-001` onward) are authored. |
| API Documentation | `API-*` | Future `docs/api/` | Placeholder. |
| Database Documentation | `DB-*` | [`database/README.md`](../database/README.md), future `docs/database/` | Partial. |
| Risk Register | `RISK-*` | Future `docs/governance/risk-register.md` | Placeholder. |
| Technical Debt Register | `TD-*` | Future `docs/governance/technical-debt-register.md` | Placeholder. |
| Development Setup | `DEV-001` | [`docs/DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md) | Active. |
| Documentation Index | `DOC-INDEX-001` | [`docs/README.md`](README.md) | Active. |
| Testing Documentation | `TEST-*` | [`docs/DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md) §7 | Partial — testing standards currently live as a section of `DEV-001`; a dedicated `TEST-*` document is future scope. |
| Deployment Documentation | `DEPLOY-001` | [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) | Active. |

### ADR Index

The canonical, actively-maintained ADR index is [`decisions/ADR-INDEX.md`](decisions/ADR-INDEX.md) (`ADR-INDEX`) — it lists every ADR's status, date, and file, and is the single place to update when a new ADR is added. New ADRs are authored from [`decisions/ADR-TEMPLATE.md`](decisions/ADR-TEMPLATE.md) (`ADR-TEMPLATE`), which adds Alternatives Considered/Trade-offs/Risks/Revision History fields on top of the lighter format ADR-0001 through ADR-0021 used. This section previously duplicated the full list inline; per this handbook's own Documentation Review Workflow ("Preserve existing useful content; move it rather than delete it"), that content was moved to the canonical index above rather than kept as a second, driftable copy.

---

# Volume I — Product

## Vision

A future where one person can run multiple ventures and creative pursuits with the operational leverage of a full team — because a trusted AI assistant handles the organizing, drafting, tracking, and preparing, while the human retains every meaningful decision.

## Mission

To build an AI assistant that earns total trust through transparency and control, and uses that trust to eliminate the busywork standing between the user and their best creative and business work.

## Core Principles

The founding Product Bible principles remain binding: Trust, Privacy, User Control, Reliability, Intelligence, and Transparency. They now operate under the Constitution and alongside the engineering laws in Volume II.

## Success Metrics

**Placeholder:** Define measurable trust, reliability, workspace-isolation, approval-safety, response-quality, and productivity outcomes. Do not add vanity metrics that incentivize unsafe autonomy.

## Target Users

AIMA v0.1–v1.0 remains optimized for a single founding user: a solo creator-entrepreneur-developer operating Roman Creative Studio, Mythic Forge Studios, personal productivity, and software development workspaces.

## Roadmap

The founding roadmap is preserved below in “Preserved Product Bible Content.” Future roadmap updates must retain historical context and add dated changes rather than silently rewriting prior intent.

---

# Volume II — Engineering

## Philosophy

AIMA engineering follows the Constitution and these sprint principles:

- Optimize for Change, Not Perfection.
- Every Decision Should Leave the Project Better Than Before.
- Process Serves the Product, Not the Other Way Around.
- Institutionalize Learning.

## Engineering Laws

1. The Constitution wins over all other documents.
2. User trust, control, privacy, and reversibility outrank feature breadth.
3. Backend enforcement is required for permissions, workspace isolation, and audit logging.
4. AI output is advisory until deterministic code validates and gates it.
5. Documentation that contradicts working behavior must be corrected in the same change that discovers the contradiction.
6. New complexity requires a current requirement, not a speculative future use case.

## Development Lifecycle

See [`docs/DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md). Future updates should add lifecycle detail here only when it is stable enough to govern more than one sprint.

## Sprint Workflow

**Placeholder:** Future sprint documents use `SPR-*` IDs and link requirements, ADRs, tests, documentation updates, and release notes.

## Architecture Review Gates

A change needs architecture review when it alters permission tiers, workspace isolation, provider boundaries, database schema, API contracts, deployment posture, or constitutional guarantees.

## Engineering Council

**Placeholder:** Until formally established, the founder/lead architect acts as council. The future council owns handbook governance, risk/debt triage, and cross-volume consistency.

## CTO Reviews

**Placeholder:** Required before major releases, high-risk integrations, data model changes, and changes to action execution or approval flows.

## Red Team Reviews

**Placeholder:** Required for external integrations, Tier 3 execution paths, authentication/authorization changes, workspace-bridging mechanisms, and sensitive logging/observability changes.

## Definition of Done

A change is done only when code, tests, documentation, ADR/ECIA impact, and user-facing behavior align with the Constitution and this handbook.

---

# Volume III — Architecture

## System Overview

See [`docs/TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) for the current detailed architecture. Summary: AIMA is one logical assistant across thin clients, one backend enforcement layer, one workspace-scoped data layer, and one AI orchestration layer.

## Services

Current service boundaries are documented in the Technical Architecture and ADRs. Future service documents should use `ARCH-*` IDs.

## Module Boundaries

Preserve the existing separation between `apps/`, `backend/`, `ai-engine/`, `database/`, and `docs/`.

## Dependency Graph

**Placeholder:** Maintain a dependency graph once module count or cross-service coupling makes it necessary.

## Interfaces

**Placeholder:** Future API/interface documentation uses `API-*` IDs and must link to affected requirements and tests.

## Versioning Strategy

Use SemVer for documents and explicit migration/version plans for APIs, schemas, and provider interfaces.

---

# Volume IV — AI

## AI Engine

The AI engine owns provider abstractions, prompt/context assembly support, and model-facing orchestration helpers. The backend remains the enforcement point.

## Provider Layer

Provider-specific behavior must stay behind provider interfaces; provider swaps require ADR coverage when they alter capability, cost, privacy, or reliability assumptions.

## Planning

**Placeholder:** Planning behavior must remain explainable and permission-aware.

## Reflection

**Placeholder:** Reflection mechanisms must not silently mutate memory, tasks, external systems, or user data.

## Tool Calling

Tool calls that produce consequential actions must route through capability registration, approval evaluation, execution logging, and workspace scoping.

## Prompt Orchestration

Prompts support behavior; they do not replace deterministic safety gates.

## Context Management

Context retrieval must preserve workspace isolation and cite/reveal sources when needed for trust and transparency.

---

# Volume V — Memory

## Short-Term Memory

**Placeholder:** Conversation/session context rules belong here once formalized.

## Long-Term Memory

Long-term memory must be user-controlled, workspace-scoped, auditable, and reversible where practical.

## Semantic Search

See ADR 0021 for current semantic search and context retrieval decisions.

## Embeddings

Embedding provider decisions are documented in ADR 0002 and later memory ADRs.

## Ranking

Ranking must optimize usefulness without breaking workspace isolation or transparency.

## Compression

**Placeholder:** Future compression must preserve user meaning and provide recovery/audit strategy for lossy transformations.

## Forgetting Strategy

**Placeholder:** Define archive/delete/forget semantics before expanding autonomous memory management.

## Context Injection

Context injection must be explicit, bounded, workspace-aware, and observable in debugging/review workflows.

---

# Volume VI — Backend

## Authentication

See Technical Architecture and backend documentation. Authentication changes require security review.

## Users

Current product scope is single-user first. Multi-user support is future scope and must not distort founding-user simplicity.

## Workspaces

Workspace separation is a constitutional/handbook-level guarantee and must be enforced structurally in backend data access.

## Permissions

The four-tier permission system remains binding and is preserved in full below.

## Database

Database migrations live under `database/migrations/`. Future database docs should use stable `DB-*` IDs.

## APIs

**Placeholder:** Create endpoint-level `API-*` docs as API surface stabilizes.

## Storage

Storage must treat user business data, creative IP, client data, and personal notes as sensitive by default.

---

# Volume VII — Frontend

## Design System

**Placeholder:** Document shared visual language, tokens, and interaction patterns when stable.

## Components

Client components remain presentation-focused and call backend APIs rather than duplicating business logic.

## Navigation

Navigation should reinforce workspace separation and make pending approvals/action logs discoverable.

## Accessibility

**Placeholder:** Define accessibility acceptance criteria for each client surface.

## Apple Human Interface Guidelines

Apple-platform clients should follow Apple HIG conventions unless doing so conflicts with AIMA trust, control, or transparency requirements.

---

# Volume VIII — Skills

## Skill Registry

**Placeholder:** Future skill registry docs must define ownership, permission tiers, inputs/outputs, and review requirements.

## Plugin System

**Placeholder:** No production plugin architecture is specified in this sprint.

## Skill Lifecycle

**Placeholder:** Define proposal, review, activation, monitoring, rollback, and retirement states before enabling broad skill expansion.

## Permissions

Every skill must map to a capability and permission tier before implementation.

## External Integrations

External integrations are sensitive by default and require Tier 3 gating where they read from or write to connected third-party accounts.

---

# Volume IX — Operations

## Testing

Testing protects trust. Permission, workspace isolation, logging, external execution, and memory behavior require regression coverage.

## Logging

Logs must be useful for auditability and debugging without exposing secrets or sensitive user content unnecessarily.

## Monitoring

**Placeholder:** Define service health, latency, provider failures, approval/execution failures, and retrieval quality signals.

## CI/CD

**Placeholder:** CI should run build/test/lint/docs validation appropriate to changed areas.

## Deployment

See [`docs/PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md).

## Incident Response

**Placeholder:** Define severity levels, user notification standards, rollback authority, and post-incident learning workflow.

## Backup Strategy

**Placeholder:** Define database/storage backup cadence, restore tests, retention, and sensitive-data handling.

---

# Volume X — Governance

## Constitution

`CONST-001` is the highest-authority governance document. If it is absent or incomplete in a working copy, contributors must treat that as a documentation gap and avoid making conflicting claims.

## ADR System

ADRs live in [`docs/decisions/`](decisions/). They preserve historical context and should not be retroactively rewritten to hide superseded decisions.

## Risk Register

**Placeholder:** Future `RISK-*` items should record description, affected areas, likelihood, impact, mitigation, owner, status, and review date.

## Technical Debt Register

**Placeholder:** Future `TD-*` items should record debt description, reason accepted, affected areas, cost of delay, remediation plan, owner, and target review.

## Requirements Traceability Matrix

Every requirement must map through this chain:

Requirement → Architecture → ADR → Database → API → Implementation → Tests → Documentation

The canonical matrix now lives in [`docs/requirements/RTM.md`](requirements/RTM.md) (`RTM-001`), alongside the Requirements framework it traces (`REQ-INDEX`/`REQ-TEMPLATE`). It was moved out of this handbook, not deleted, per this handbook's own Documentation Review Workflow: preserve existing useful content, move it rather than delete it. Its single row remains illustrative scaffolding, not a registered requirement — see `RTM-001`'s own scope note.

## Engineering Change Impact Analysis (ECIA)

Every material engineering change should identify its impact across requirements, ADRs, architecture, database, APIs, implementation, tests, documentation, security, and operations.

The canonical ECIA framework now lives in [`docs/governance/ECIA-INDEX.md`](governance/ECIA-INDEX.md) (canonical index) and [`docs/governance/ECIA-TEMPLATE.md`](governance/ECIA-TEMPLATE.md) (`ECIA-TEMPLATE`, the authoring template). This handbook's original eight-category checklist and inline template were moved there, not deleted, and extended with the Architecture, ADRs, Implementation, Security, and Operations categories — per this handbook's own Documentation Review Workflow: preserve existing useful content, move it rather than delete it. No ECIA record has been authored yet; the index is currently empty.

## Release Process

**Placeholder:** Release process must include versioning, validation, rollback readiness, documentation updates, and user-impact notes.

---

# Volume XI — Future

## Long-Term Vision

AIMA becomes a durable, evolving record of how its user works, thinks, and creates — a compounding asset, not just a tool.

## Enterprise Expansion

**Placeholder:** Enterprise expansion is future scope and must not compromise the founding single-user experience prematurely.

## Research

**Placeholder:** Research topics should be captured without being mistaken for committed roadmap items.

## Experimental Features

Experimental features must be labeled, reversible, permission-aware, and isolated from production guarantees until promoted through review.

---

# Preserved Product Bible Content

The following founding Product Bible content is preserved for historical continuity and remains binding unless superseded by the Constitution or an explicit handbook/ADR update.

## 1. Product Overview

### Product Name
**AIMA** — AI Management Assistant (working expansion; see Section 7 for naming evolution).

### Purpose
AIMA is a personal AI operating assistant that unifies a creator-entrepreneur's professional and creative life — Roman Creative Studio, Mythic Forge Studios, personal productivity, and software development — into a single, trustworthy command center. AIMA reduces the cognitive overhead of context-switching between businesses, projects, and roles by organizing information, preparing work, and executing approved actions on the user's behalf.

### Vision Statement
A future where one person can run multiple ventures and creative pursuits with the operational leverage of a full team — because a trusted AI assistant handles the organizing, drafting, tracking, and preparing, while the human retains every meaningful decision.

### Mission Statement
To build an AI assistant that earns total trust through transparency and control, and uses that trust to eliminate the busywork standing between the user and their best creative and business work.

### Target User
A single primary user in this founding version: a solo creator-entrepreneur-developer who simultaneously:
- Runs a client services business (Roman Creative Studio)
- Builds original creative IP (Mythic Forge Studios / The Fracture Protocol)
- Manages personal life and productivity
- Writes and ships software

AIMA v0.1–v1.0 is designed and tuned for this single user. Multi-user/team support is a future consideration (Section 7), not a current requirement, and must not shape early architecture decisions at the expense of this user's experience.

---

## 2. Product Principles

These principles are non-negotiable filters for every feature decision. If a proposed feature violates one of these, it must be redesigned or rejected.

### Trust
AIMA must behave predictably. It never surprises the user with an action they didn't expect. Trust is built incrementally — AIMA earns expanded autonomy over time through a consistent track record, not by default.

### Privacy
The user's business data, creative IP, client information, and personal notes are sensitive by default. AIMA must minimize data exposure, never share data across workspaces without cause, and never transmit user data externally beyond what is strictly required to perform a requested task.

### User Control
The user is always the final decision-maker. AIMA can be overridden, paused, or corrected at any time. No action AIMA takes should be difficult to undo, and any action that *is* hard to undo requires explicit, informed approval first.

### Reliability
AIMA must do what it says it will do, consistently. A system that is powerful but unreliable is worse than a simple system that is dependable. Reliability is prioritized over feature breadth.

### Intelligence
AIMA should demonstrate genuine understanding of the user's businesses, projects, and goals — not generic assistance. Its value comes from context-aware judgment: knowing what matters, what's urgent, and what's connected.

### Transparency
AIMA always shows its reasoning and sources when asked, clearly labels what it has done versus what it is proposing, and never obscures or silently modifies user data. The user should never have to wonder "what did AIMA actually do here?"

---

## 3. Core Capabilities

These are the major capability categories AIMA is expected to grow into. Not all are built in early versions (see Section 8), but all future features should map cleanly into one of these categories.

1. **Communication Assistance** — Drafting emails, messages, and client replies; summarizing threads; never sending without approval.
2. **Lead & Client Management** — Tracking leads, client status, project stages, and follow-up timing for RCS.
3. **Proposal & Document Preparation** — Drafting proposals, quotes, contracts, and creative briefs for user review.
4. **Project & Task Management** — Organizing multi-step projects across RCS, MFS, and personal life with status tracking.
5. **Creative & Story Development** — Supporting Mythic Forge Studios' worldbuilding, character bibles, story continuity, and production tracking for The Fracture Protocol.
6. **Personal Productivity** — Daily planning, task capture, note organization, and reminders.
7. **Learning & Knowledge Management** — Organizing notes, research, and learning materials into retrievable knowledge.
8. **Software Development Assistance** — Coding help, repository understanding, GitHub integration, and documentation support.
9. **Automation & Workflow Execution** — Running approved, repeatable workflows (e.g., "prepare my weekly RCS status update") with minimal friction.
10. **Insight & Recommendation** — Surfacing patterns, risks, and opportunities across workspaces (e.g., "this lead has gone quiet for 10 days").

---

## 4. User Experience Philosophy

AIMA should feel like a **highly competent, discreet chief of staff** — not a chatbot, not a novelty, not a black box.

- **Calm, not chatty.** AIMA communicates efficiently. It doesn't perform enthusiasm or pad responses. It respects the user's time and attention.
- **Prepared, not presumptuous.** AIMA shows up with drafts, options, and organized information — not with actions already taken that the user must now discover and undo.
- **Context-aware, not context-blind.** AIMA knows which workspace it's operating in and behaves accordingly (see Section 6). It doesn't mix a client email tone with a creative brainstorm tone.
- **Honest about uncertainty.** When AIMA isn't sure, it says so and asks — it doesn't guess silently and present the guess as fact.
- **Consistent, not novel-for-novelty's-sake.** The same kind of request should produce the same kind of behavior every time. Predictability is a feature.
- **In service of flow, not interruption.** AIMA should reduce the number of times the user has to stop and manage AIMA itself. Notifications and check-ins should be meaningful, not noisy.

The emotional target: the user should feel **lighter and more in control** after interacting with AIMA — never more anxious, more surveilled, or more uncertain about what happened.

---

## 5. Permission and Approval System

AIMA's actions are classified into four tiers. Every capability built into AIMA must be explicitly assigned to one of these tiers before it ships — no capability may be built "unclassified."

### Tier 1 — Suggest
AIMA proposes an idea, option, or observation. No draft or action is created. The user decides whether to act at all.
*Example: "This lead hasn't replied in 9 days — want me to draft a follow-up?"*

### Tier 2 — Prepare
AIMA creates a draft, document, or plan for the user to review, but nothing leaves AIMA's workspace and no external or irreversible change occurs.
*Example: Drafting a client proposal, writing a follow-up email into a review queue, outlining a production schedule.*

### Tier 3 — Execute with Approval
AIMA has prepared an action and is authorized to carry it out **only after the user explicitly confirms this specific instance.** This is the default tier for anything external-facing or hard to reverse.
*Example: Sending an email, posting a message, submitting a form, committing to a calendar invite, pushing code to a shared branch.*

### Tier 4 — Automatically Handle Safely
Actions that are low-risk, easily reversible, internal to AIMA's own organizational systems, and previously approved as a *category* by the user may be automated without per-instance confirmation.
*Example: Filing a note into the correct project folder, updating a task's status, tagging a lead, logging a summary of a call.*

**Governing rules:**
- No capability defaults to Tier 4. A capability only moves to Tier 4 after (a) it has operated successfully at Tier 3 repeatedly, and (b) the user explicitly promotes it.
- Anything that sends external communication, spends money, deletes data, or is otherwise hard to reverse is **permanently Tier 3 at minimum** — it can never be auto-promoted to Tier 4, regardless of track record.
- Every Tier 3/4 action must be logged with what was done, when, and why, and must be visible to the user on request.
- The user can revoke any Tier 4 automation and return it to Tier 3 at any time, instantly.

---

## 6. Workspace Separation System

AIMA operates across four distinct workspaces. Separation exists to prevent context bleed (e.g., client data appearing in creative work, personal notes surfacing in a business proposal) and to let AIMA apply the right tone, rules, and data sources to the right task.

### Personal Workspace
- Contains: daily planning, personal tasks, notes, learning materials, personal goals.
- Isolation: Never referenced in RCS or MFS outputs unless the user explicitly pulls it in.

### Roman Creative Studio (RCS) Workspace
- Contains: clients, leads, proposals, outreach, project management for the web design business.
- Isolation: Client and business data stays within RCS context. Tone here is professional/client-facing by default.

### Mythic Forge Studios (MFS) Workspace
- Contains: The Fracture Protocol IP, character bibles, story continuity, production tracking, creative assets.
- Isolation: Creative/IP material stays within MFS context. Tone here is collaborative/creative by default.

### Development Workspace
- Contains: code, repositories, GitHub integration, technical documentation, dev workflows — including AIMA's own codebase.
- Isolation: Technical context stays separate from business/creative tone; precise and technical by default.

### Cross-Workspace Rules
1. **Default isolation:** Each workspace only sees its own data. Cross-workspace visibility is opt-in per request, not default behavior.
2. **Explicit bridging:** The user can explicitly ask AIMA to bring information from one workspace into another (e.g., "use my MFS production calendar to see if I have bandwidth for a new RCS client"). AIMA performs this only when asked, and states clearly when it has done so.
3. **Shared identity, separate memory:** AIMA is one assistant with one continuous relationship with the user, but it maintains workspace-scoped context so it doesn't conflate a client of RCS with a character in MFS, for example.
4. **Workspace-aware permissions:** Approval tiers (Section 5) can carry different defaults per workspace — e.g., RCS client communication is inherently more sensitive (external, reputational) than personal task management, and its permission defaults should reflect that even within the same tier.

---

## 7. Future Product Vision

**Year 1:** AIMA is a deeply personalized single-user assistant, proven reliable across all four workspaces, trusted with an expanding set of Tier 4 automations.

**Years 2–3:** AIMA becomes the operational backbone of Roman Creative Studio and Mythic Forge Studios — capable of running structured workflows (client onboarding, production pipelines) end-to-end with light supervision. AIMA may extend limited, carefully scoped access to a small team (e.g., a contractor or collaborator) under the same permission philosophy, with the founding user retaining ultimate control.

**Years 3–5:** AIMA's workspace-separation and permission-tier architecture is generalized into a reusable platform — potentially offered to other creator-entrepreneurs running multiple ventures, positioning AIMA as a category-defining "personal AI COO" product rather than a single-user tool.

**Long-term:** AIMA becomes a durable, evolving record of how its user works, thinks, and creates — a compounding asset, not just a tool. Its judgment gets better because its history with this specific user gets deeper, never because it was granted more autonomy than it earned.

**Guardrail across all horizons:** No matter how capable AIMA becomes, Section 2's principles and Section 5's permission system remain absolute. Growth means AIMA gets *more useful*, never *less supervised* than the user wants.

---

## 8. Version Roadmap

### AIMA v0.1 — Foundation
- Establish workspace separation (Section 6) at a basic level.
- Implement Tier 1 (Suggest) and Tier 2 (Prepare) capabilities only.
- Core use cases: personal task/notes capture, basic RCS lead tracking, basic MFS note/story organization, basic dev/GitHub Q&A.
- No external communication sending. No Tier 3/4 automation yet.
- Goal: prove AIMA understands context and produces genuinely useful drafts/organization.

### AIMA v0.2 — Guided Action
- Introduce Tier 3 (Execute with Approval) for a small, well-defined set of actions (e.g., sending a drafted email after explicit confirmation).
- Add proposal creation and structured project management for RCS.
- Add production/character tracking structure for MFS.
- Add activity logging so every action is auditable.
- Goal: prove AIMA can be trusted to act, one confirmed step at a time.

### AIMA v1.0 — Trusted Assistant
- Full four-tier permission system operational, including a defined promotion path to Tier 4 for proven, low-risk categories.
- All four workspaces fully operational with cross-workspace bridging on request.
- End-to-end workflows available across RCS, MFS, personal, and dev use cases.
- Full transparency/audit log accessible to the user at any time.
- Goal: AIMA is the user's daily operating layer across all areas of work.

### Future Versions (v1.x+)
- Expanded Tier 4 automation library, grown only through demonstrated reliability.
- Deeper MFS creative tooling (story bible intelligence, continuity checking).
- Deeper RCS business intelligence (pipeline health, capacity planning).
- Potential limited multi-user/collaborator access, governed by the same permission philosophy.
- Potential platformization for other users (Section 7, Years 3–5).

---

## 9. Development Rules

Binding rules for anyone (human or AI) building features into AIMA:

1. **No unclassified capabilities.** Every new feature must be assigned a permission tier (Section 5) before implementation begins, not after.
2. **No silent external actions.** Any code path that can send a communication, spend money, or make a change outside AIMA's own data store must require explicit per-instance user approval (Tier 3) unless formally promoted to Tier 4 by the user.
3. **No Tier 4 by default.** New features ship at Tier 1, 2, or 3. Promotion to Tier 4 is a deliberate, user-driven, logged decision — never a default configuration or a developer shortcut.
4. **Irreversible actions require a confirmation step, always.** Deletions, sends, submissions, and financial actions must have a distinct, explicit confirmation UX — never bundled into a broader "yes" to something else.
5. **Respect workspace boundaries in code, not just prompts.** Data access layers must enforce workspace isolation (Section 6) structurally — cross-workspace access must be an explicit, logged query, not a byproduct of shared storage or shared context windows.
6. **Every consequential action is logged.** Tier 3 and Tier 4 actions must write an auditable record (what, when, why, which workspace) that the user can review without needing to ask AIMA to recall it from memory.
7. **Favor reversibility in design.** When given a choice between two implementations, prefer the one that is easier to undo, pause, or roll back.
8. **No dark patterns.** Never design confirmation flows to nudge the user toward approval (e.g., no pre-checked boxes, no urgency manufactured to rush a decision, no burying the "decline" option).
9. **Explain on request, always.** Any AIMA output or action must be traceable to an explanation the user can request in plain language — "why did you do/suggest this?" must always have an answer.
10. **Build for this user first.** Do not add generalization, multi-tenancy, or configurability for hypothetical future users at the cost of complexity or friction for the founding single user. Generalize only when Section 7's later horizons are actually being pursued.
11. **Principles override roadmap pressure.** If a shipping deadline or feature request conflicts with Section 2's principles or Section 5's permission system, the principles win. Ship later, or ship a smaller version, rather than compromise trust or control.
12. **This document is the source of truth.** Any proposed feature, design, or business decision that contradicts this Product Bible must either be rejected or trigger a deliberate, explicit revision of this document — never a quiet exception.

---

*This is a living document. Amendments should be deliberate, versioned, and reflect real product learnings — not casual edits.*
