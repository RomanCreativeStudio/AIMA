# REQ 004: Permission Engine

**Document ID:** REQ-004
**Status:** Approved
**Priority:** Critical
**Category:** Security

**Owner:** Product owner

## Purpose

Guarantee that AIMA never takes an external or irreversible action without going through a deterministic backend gate — regardless of what the AI model outputs. This is the technical enforcement of the four-tier permission system (Suggest / Prepare / Execute with Approval / Automatic Safe).

## Description

Every action-producing capability is registered in a central `CapabilityRegistry` with a declared default tier before it can be used. The `PermissionEngine` resolves a capability's tier and returns a decision (`suggest` / `prepare` / `requires_approval` / `auto_execute`); it is a dedicated component every action-producing code path must pass through (`ARCH-001` §5, "Permission Architecture", decided in `ADR-0004`).

Tier 3 (Execute with Approval) actions create a pending approval record via the Approval Engine and block execution until the user explicitly confirms; only some capabilities have a real executor wired up to actually perform the action after approval (Gmail send/save-draft, GitHub create-issue/create-pull-request, Calendar create/update/delete — Action Execution Foundation, Phase 2.6, `ADR-0014`). Capabilities without a wired executor stop at "approved" without a further automated effect.

**Known, current limitation (confirmed by repository audit, `backend/src/permissions/engine.ts`):** per-workspace tier promotion/override is not wired in. `PermissionEngine.resolveTier` always returns the capability's registered default tier from the `CapabilityRegistry` — the workspace-aware permission defaults described in `ARCH-001` §6 ("the capability registry can carry different default tiers per workspace") are not implemented.

## Acceptance Criteria

1. Every capability is registered in the `CapabilityRegistry` with a declared default tier before it can be used; calling `resolveTier` on an unregistered `actionType` throws (`backend/src/permissions/engine.ts`).
2. `PermissionEngine.evaluate(actionType)` returns `{ kind: 'suggest' }`, `{ kind: 'prepare' }`, `{ kind: 'requires_approval' }`, or `{ kind: 'auto_execute' }` based on the capability's resolved tier.
3. Tier 3 (`execute_with_approval`) actions create a pending approval record and block execution until the user explicitly confirms that specific instance (`backend/src/approval/`).
4. Tier-locked capabilities (external communication, financial actions, deletions) cannot be promoted beyond Tier 3 — the `tierLocked` flag on a `CapabilityDefinition` structurally prevents it (`backend/src/permissions/types.ts`).
5. Approved Tier 3 actions with a wired `ActionExecutor` perform the real action exactly once per approved request, idempotent on a terminal record (`backend/src/execution/`, `ADR-0014`).
6. Per-workspace tier promotion/override is **not yet implemented** — this is a known gap, not an oversight in this requirement.

## Dependencies

None registered yet. `REQ-003` (Workspace Management) is related context (`ARCH-001` §6 anticipates workspace-aware tier defaults, per Acceptance Criterion 6 above) but the current implementation does not yet depend on workspace context for tier resolution.

## Related ADRs

`ADR-0004` — Intent & Approval Engine Design. `ADR-0007` — Intent & Approval Workflows. `ADR-0014` — Action Execution Foundation.

## Related Architecture

`ARCH-001` §5 "Permission Architecture", `ARCH-001` §6 "Workspace Architecture" (workspace-aware permission defaults, not yet implemented).

## Related Tests

`backend/src/permissions/engine.test.ts`.

## Related Implementation

`backend/src/permissions/engine.ts`, `backend/src/permissions/registry.ts`, `backend/src/permissions/types.ts`, `backend/src/permissions/syncCapabilities.ts`, `backend/src/approval/`, `backend/src/execution/`.

## Revision History

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-01 | Initial requirement, formalizing the existing Permission Engine implementation, including its documented per-workspace tier promotion gap. |
