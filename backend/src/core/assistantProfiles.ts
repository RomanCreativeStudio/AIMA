import type { Workspace } from '../workspaces/types';
import type { WorkspaceSlug } from '../types/workspace';

/**
 * The Assistant Behavior Layer (Phase 1.6): per-workspace configuration for
 * how AIMA should behave, beyond the fixed identity every response shares.
 * A plain lookup, not a class — mirrors intentCapabilityMap.ts's pattern —
 * because this is static configuration, not a runtime-selected provider.
 * Promoting this to a DB-backed, user-editable registry is a reasonable
 * future step once a UI exists to edit it (docs/decisions/0006-assistant-
 * core-orchestration.md).
 */
export interface AssistantProfile {
  workspaceSlug: WorkspaceSlug;
  /** Short label for logs/UI, e.g. "Roman Creative Studio Mode". */
  name: string;
  /** One-line description of the workspace's purpose, folded into the system prompt. */
  description: string;
  /** Workspace-specific behavioral guidance, folded into the system prompt after the shared identity. */
  responseInstructions: string;
}

const ASSISTANT_PROFILES: Record<WorkspaceSlug, AssistantProfile> = {
  personal: {
    workspaceSlug: 'personal',
    name: 'Personal Mode',
    description: 'the Personal workspace — daily planning, notes, and personal organization.',
    responseInstructions:
      'Be supportive and practical. Help prioritize and organize the day; never make significant personal decisions on the user\'s behalf, only prepare options.',
  },
  rcs: {
    workspaceSlug: 'rcs',
    name: 'Roman Creative Studio Mode',
    description: 'the Roman Creative Studio workspace — client management, outreach, website projects, and proposals.',
    responseInstructions:
      'Be precise and professional, as if representing a client-facing business. Treat anything resembling client communication as a draft that needs approval before it is ever sent.',
  },
  mfs: {
    workspaceSlug: 'mfs',
    name: 'Mythic Forge Studios Mode',
    description:
      'the Mythic Forge Studios workspace — The Fracture Protocol, character development, and production tracking.',
    responseInstructions:
      'Be a creative collaborator. Prioritize narrative and character consistency with established lore, and flag anything that contradicts prior worldbuilding rather than silently overriding it.',
  },
  development: {
    workspaceSlug: 'development',
    name: 'Development Mode',
    description: 'the Development workspace — coding, GitHub, and software projects.',
    responseInstructions:
      'Be concise and technical. Assume a developer audience, prioritize correctness, and reference relevant retrieved code or documentation when it is available.',
  },
};

export function getAssistantProfile(workspaceSlug: WorkspaceSlug): AssistantProfile {
  return ASSISTANT_PROFILES[workspaceSlug];
}

/**
 * The Assistant Profile Integration point (Phase 1.8): composes the static
 * per-slug default above with a workspace's own DB-backed configuration
 * (`instructions`, `assistantBehavior` — backend/src/workspaces/), rather
 * than replacing it. The static profile stays the baseline every workspace
 * of that slug gets out of the box; a workspace's own instructions/behavior
 * only ever add to it (docs/decisions/0008-user-identity-and-workspace-
 * intelligence.md).
 */
export function buildEffectiveProfile(workspace: Workspace): AssistantProfile {
  const base = getAssistantProfile(workspace.slug);
  const instructions = [base.responseInstructions];

  if (workspace.instructions) {
    instructions.push(workspace.instructions);
  }

  const behaviorEntries = Object.entries(workspace.assistantBehavior);
  if (behaviorEntries.length > 0) {
    instructions.push(
      `Additional behavior preferences for this workspace: ${behaviorEntries
        .map(([key, value]) => `${key}: ${value}`)
        .join('; ')}.`,
    );
  }

  return {
    workspaceSlug: base.workspaceSlug,
    name: base.name,
    description: base.description,
    responseInstructions: instructions.join(' '),
  };
}
