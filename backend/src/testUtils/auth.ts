import { issueMockTokens } from '../auth/mockAuthProvider';

/** A ready-to-send `Authorization` header for `userId`, via the same `MockAuthProvider` every `withTestServer` wires into `createApp` (EPIC-004 Sprint 4.5) — one place so every route test attaches a token the same way. */
export function authHeader(userId: string): { Authorization: string } {
  return { Authorization: `Bearer ${issueMockTokens(userId).accessToken}` };
}
