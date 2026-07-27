/**
 * The User Profile System's model (Phase 1.8). `preferences` here is a
 * simple account-level settings blob — distinct from the structured,
 * workspace-scoped Preference Memory Layer (backend/src/preferences/) that
 * actually shapes AI behavior.
 */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  preferences: Record<string, unknown>;
  communicationStyle: string | null;
  defaultWorkspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  displayName?: string;
}

export interface UpdateUserProfileInput {
  displayName?: string;
  preferences?: Record<string, unknown>;
  communicationStyle?: string;
  defaultWorkspaceId?: string | null;
}
