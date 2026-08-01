import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import { SessionRevokedError } from './errors';
import { MockAuthProvider, issueMockTokens } from './mockAuthProvider';
import { hashRefreshToken, SessionService } from './sessionService';

test('createSession stores only the hashed refresh token, never the raw value', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const service = new SessionService(client, new MockAuthProvider());
    const tokens = issueMockTokens(userId);

    const session = await service.createSession(userId, tokens.refreshToken, 'MacBook Pro');

    assert.equal(session.userId, userId);
    assert.equal(session.deviceLabel, 'MacBook Pro');
    assert.equal(session.revokedAt, null);

    const row = await client.query('SELECT refresh_token_hash FROM auth_sessions WHERE id = $1', [session.id]);
    assert.equal(row.rows[0].refresh_token_hash, hashRefreshToken(tokens.refreshToken));
    assert.notEqual(row.rows[0].refresh_token_hash, tokens.refreshToken);
  });
});

test('refresh rotates the refresh token and returns a fresh pair', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const service = new SessionService(client, new MockAuthProvider());
    const tokens = issueMockTokens(userId);
    const session = await service.createSession(userId, tokens.refreshToken);

    const result = await service.refresh(tokens.refreshToken);

    assert.equal(result.session.id, session.id);
    assert.notEqual(result.tokens.refreshToken, tokens.refreshToken);

    await assert.rejects(() => service.refresh(tokens.refreshToken), SessionRevokedError);
  });
});

test('refresh throws SessionRevokedError for an unknown refresh token', async () => {
  await withTestTransaction(async (client) => {
    const service = new SessionService(client, new MockAuthProvider());
    await assert.rejects(() => service.refresh('mock-refresh:never-issued'), SessionRevokedError);
  });
});

test('refresh throws SessionRevokedError for a revoked session', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const service = new SessionService(client, new MockAuthProvider());
    const tokens = issueMockTokens(userId);
    const session = await service.createSession(userId, tokens.refreshToken);

    await service.revokeSession(session.id);

    await assert.rejects(() => service.refresh(tokens.refreshToken), SessionRevokedError);
  });
});

test('revokeSession is idempotent', async () => {
  await withTestTransaction(async (client) => {
    const { userId } = await seedWorkspace(client);
    const service = new SessionService(client, new MockAuthProvider());
    const tokens = issueMockTokens(userId);
    const session = await service.createSession(userId, tokens.refreshToken);

    await service.revokeSession(session.id);
    await assert.doesNotReject(() => service.revokeSession(session.id));

    const sessions = await service.listSessions(userId);
    assert.equal(sessions[0].revokedAt !== null, true);
  });
});

test('listSessions only returns sessions for the given user', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = new SessionService(client, new MockAuthProvider());

    await service.createSession(a.userId, issueMockTokens(a.userId).refreshToken);
    await service.createSession(b.userId, issueMockTokens(b.userId).refreshToken);

    const sessions = await service.listSessions(a.userId);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].userId, a.userId);
  });
});
