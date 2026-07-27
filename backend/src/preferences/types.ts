export const PREFERENCE_CATEGORIES = [
  'writing_style',
  'response_preferences',
  'workflow_preferences',
  'project_rules',
] as const;

export type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];

/**
 * The Preference Memory Layer's model (Phase 1.8): a structured, keyed
 * setting that shapes assistant behavior — distinct from a freeform
 * `memory_records` fact. Workspace-scoped, unique per (workspace, category,
 * key) — setting the same key again updates it rather than creating a
 * duplicate.
 */
export interface Preference {
  id: string;
  workspaceId: string;
  category: PreferenceCategory;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface SetPreferenceInput {
  workspaceId: string;
  category: PreferenceCategory;
  key: string;
  value: string;
}
