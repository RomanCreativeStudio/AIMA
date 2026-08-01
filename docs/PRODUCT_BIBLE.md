# AIMA Product Bible

**Version:** 0.1 (Founding Draft)
**Status:** Source of Truth for Product, Engineering, and Business Decisions under the AIMA Constitution
**Owner:** Lead Product Architect
**Last Updated:** 2026-07-27

---

## 0. Constitutional Authority

The [AIMA Constitution](CONSTITUTION.md) is the highest-authority governance document for the project. This Product Bible must remain aligned with its mission, user-trust commitments, engineering philosophy, security principles, and evolution requirements.

---

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
