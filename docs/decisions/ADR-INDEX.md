# AIMA ADR Index

**Document ID:** ADR-INDEX
**Document Name:** AIMA Architecture Decision Record Index
**Version:** 1.0.0
**Status:** Active
**Authority Level:** Operational index; subordinate to `CONST-001`, `HB-001`, and `ARCH-001`
**Owner:** Authoring engineer + reviewer (per `HB-001`'s Documentation Ownership table)
**Dependencies:** `CONST-001`, `HB-001`, `ARCH-001`
**Dependents:** Contributors, future ADRs, `HB-001`'s Master Documentation Index
**Review Frequency:** Every new or superseded ADR
**Last Updated:** 2026-08-02
**Related Documents:** [`ADR-TEMPLATE.md`](ADR-TEMPLATE.md), [`../PRODUCT_BIBLE.md`](../PRODUCT_BIBLE.md), [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md)

---

## Purpose

This is the single, canonical index of every Architecture Decision Record in AIMA. It exists so a decision's status, date, and file location can be found in one place without cross-checking `docs/decisions/` against `HB-001`'s own copy — this file is authoritative; `HB-001`'s ADR Index section is retained for convenience but must be kept in sync with this one, not edited independently.

## Adding a New ADR

1. Start from [`ADR-TEMPLATE.md`](ADR-TEMPLATE.md).
2. Use the next sequential number after the highest one below.
3. Add a row to the table, in numeric order.
4. Never reuse or renumber a stable ADR ID after publication (`HB-001`'s Permanent Numbering Standard).

## Index

| ADR ID | Title | Status | Date | File |
| --- | --- | --- | --- | --- |
| ADR-0001 | Backend Stack for the Foundation Sprint | Decided | 2026-07-27 | [`0001-backend-stack.md`](0001-backend-stack.md) |
| ADR-0002 | Memory Scope Model and Embedding Provider | Decided | 2026-07-27 | [`0002-memory-and-embeddings.md`](0002-memory-and-embeddings.md) |
| ADR-0003 | Conversation Pipeline Design | Decided | 2026-07-27 | [`0003-conversation-pipeline.md`](0003-conversation-pipeline.md) |
| ADR-0004 | Intent & Approval Engine Design | Decided | 2026-07-27 | [`0004-intent-and-approval-engine.md`](0004-intent-and-approval-engine.md) |
| ADR-0005 | Knowledge Ingestion Foundation | Decided | 2026-07-27 | [`0005-knowledge-ingestion.md`](0005-knowledge-ingestion.md) |
| ADR-0006 | Assistant Core Orchestration Layer | Decided | 2026-07-27 | [`0006-assistant-core-orchestration.md`](0006-assistant-core-orchestration.md) |
| ADR-0007 | Intent & Approval Workflows | Decided | 2026-07-27 | [`0007-intent-and-approval-workflows.md`](0007-intent-and-approval-workflows.md) |
| ADR-0008 | User Identity & Workspace Intelligence Layer | Decided | 2026-07-27 | [`0008-user-identity-and-workspace-intelligence.md`](0008-user-identity-and-workspace-intelligence.md) |
| ADR-0009 | macOS Experience Foundation | Decided | 2026-07-27 | [`0009-macos-experience-foundation.md`](0009-macos-experience-foundation.md) |
| ADR-0010 | Daily Assistant Interface | Decided | 2026-07-27 | [`0010-daily-assistant-interface.md`](0010-daily-assistant-interface.md) |
| ADR-0011 | External Integrations Foundation | Decided | 2026-07-27 | [`0011-external-integrations-foundation.md`](0011-external-integrations-foundation.md) |
| ADR-0012 | Workflow Orchestration Foundation | Decided | 2026-07-28 | [`0012-workflow-orchestration-foundation.md`](0012-workflow-orchestration-foundation.md) |
| ADR-0013 | Productivity Intelligence | Decided | 2026-07-28 | [`0013-productivity-intelligence.md`](0013-productivity-intelligence.md) |
| ADR-0014 | Action Execution Foundation | Decided | 2026-07-28 | [`0014-action-execution-foundation.md`](0014-action-execution-foundation.md) |
| ADR-0015 | Live Integration Providers | Decided | 2026-07-28 | [`0015-live-integration-providers.md`](0015-live-integration-providers.md) |
| ADR-0016 | Production Deployment Foundation | Decided | 2026-07-28 | [`0016-production-deployment-foundation.md`](0016-production-deployment-foundation.md) |
| ADR-0017 | Voice Assistant Foundation | Decided | 2026-07-28 | [`0017-voice-assistant-foundation.md`](0017-voice-assistant-foundation.md) |
| ADR-0018 | Real Voice Provider Integration | Decided | 2026-07-28 | [`0018-real-voice-provider-integration.md`](0018-real-voice-provider-integration.md) |
| ADR-0019 | Advanced Memory System | Decided | 2026-07-28 | [`0019-advanced-memory-system.md`](0019-advanced-memory-system.md) |
| ADR-0020 | Proactive Intelligence | Decided | 2026-07-28 | [`0020-proactive-intelligence.md`](0020-proactive-intelligence.md) |
| ADR-0021 | Semantic Search & Context Retrieval | Decided | 2026-07-29 | [`0021-semantic-search-and-context-retrieval.md`](0021-semantic-search-and-context-retrieval.md) |
| ADR-0022 | Authentication Architecture | Decided | 2026-08-01 | [`0022-authentication-architecture.md`](0022-authentication-architecture.md) |
| ADR-0023 | Authentication Rate Limiting | Decided | 2026-08-01 | [`0023-authentication-rate-limiting.md`](0023-authentication-rate-limiting.md) |
| ADR-0024 | Database Security Boundary (RLS Decision) | Decided | 2026-08-01 | [`0024-database-security-boundary.md`](0024-database-security-boundary.md) |
| ADR-0025 | First Production Hosting Platform & Database Host | Decided | 2026-08-02 | [`0025-first-production-hosting.md`](0025-first-production-hosting.md) |

**Next available ID:** `ADR-0026`.

## Status Legend

- **Proposed** — drafted, not yet reviewed/adopted.
- **Decided** — adopted and in effect. All 24 entries above are `Decided`; none have been superseded to date.
- **Deprecated** — no longer recommended, but not replaced by a specific later ADR.
- **Superseded by ADR-00NN** — replaced by a specific later decision; the original text is preserved, not deleted (`CONST-001` Article X).

## Format Note

ADR-0001 through ADR-0021 predate [`ADR-TEMPLATE.md`](ADR-TEMPLATE.md) and use a lighter format (Status/Date/Relates to, Context, Decision(s), Consequences) without the template's Alternatives Considered/Trade-offs/Risks/Revision History sections. They are indexed here as-is; the template applies starting at `ADR-0022`. See `ADR-TEMPLATE.md`'s "Scope note" for why these were not retrofitted.
