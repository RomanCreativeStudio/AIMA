import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db/queryable';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import type { OAuthProvider, OAuthTokenSet } from '../oauth/types';
import { WorkspaceNotFoundError } from '../types/errors';
import type { IntegrationConnector, ConnectionTestResult } from './connectors/types';
import { AesGcmCredentialEncryptor } from './encryption';
import { IntegrationConnectionFailedError, IntegrationNotFoundError, InvalidCredentialsError } from './errors';
import { IntegrationService } from './integrationService';
import { IntegrationRegistry } from './registry';
import type { IntegrationCredentials, IntegrationProvider } from './types';

const TEST_KEY = randomBytes(32).toString('base64');

class FakeConnector implements IntegrationConnector {
  constructor(
    public readonly provider: IntegrationProvider,
    private readonly result: ConnectionTestResult = { ok: true },
  ) {}

  async testConnection(_credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    return this.result;
  }
}

/** A test double `OAuthProvider` (Phase 2.7) — returns a fixed refreshed token set and records every `revokeToken` call, with no real network involved. */
class FakeOAuthProvider implements OAuthProvider {
  readonly revokedTokens: string[] = [];
  refreshCallCount = 0;

  constructor(
    readonly provider: IntegrationProvider,
    private readonly refreshedTokens: OAuthTokenSet,
  ) {}

  getAuthorizationUrl(): string {
    return 'https://example.test/authorize';
  }

  async exchangeCode(): Promise<OAuthTokenSet> {
    return this.refreshedTokens;
  }

  async refreshAccessToken(): Promise<OAuthTokenSet> {
    this.refreshCallCount += 1;
    return this.refreshedTokens;
  }

  async revokeToken(accessToken: string): Promise<void> {
    this.revokedTokens.push(accessToken);
  }
}

function buildService(
  db: Queryable,
  overrides: Partial<Record<IntegrationProvider, IntegrationConnector>> = {},
  oauthProviders: Partial<Record<IntegrationProvider, OAuthProvider>> = {},
): IntegrationService {
  const registry = new IntegrationRegistry();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: overrides.gmail ?? new FakeConnector('gmail'),
    github: overrides.github ?? new FakeConnector('github'),
    calendar: overrides.calendar ?? new FakeConnector('calendar'),
  };
  return new IntegrationService(db, registry, connectors, new AesGcmCredentialEncryptor(TEST_KEY), oauthProviders);
}

test('listForWorkspace returns all three fixed providers, defaulted to disconnected, before anything is connected', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    const integrations = await service.listForWorkspace(workspaceId);

    assert.equal(integrations.length, 3);
    assert.ok(integrations.every((integration) => integration.enabled === false && integration.status === 'disconnected'));
    assert.deepEqual(new Set(integrations.map((i) => i.provider)), new Set(['gmail', 'github', 'calendar']));
  });
});

test('connect validates credentials, tests the connection, and stores it encrypted', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    const integration = await service.connect({
      workspaceId,
      provider: 'github',
      credentials: { accessToken: 'gh-token' },
    });

    assert.equal(integration.enabled, true);
    assert.equal(integration.status, 'connected');
    assert.ok(integration.connectedAt);

    const credentials = await service.getDecryptedCredentials(workspaceId, 'github');
    assert.deepEqual(credentials, { accessToken: 'gh-token' });
  });
});

test('connect rejects missing required credential fields without calling the connector', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    await assert.rejects(
      () => service.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'only-one' } }),
      InvalidCredentialsError,
    );

    const integrations = await service.listForWorkspace(workspaceId);
    const gmail = integrations.find((i) => i.provider === 'gmail')!;
    assert.equal(gmail.enabled, false);
  });
});

test('connect rejects when the connector reports the credentials do not work', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client, {
      github: new FakeConnector('github', { ok: false, detail: 'token expired' }),
    });

    await assert.rejects(
      () => service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'expired' } }),
      IntegrationConnectionFailedError,
    );
  });
});

test('connect rejects an unknown workspaceId', async () => {
  await withTestTransaction(async (client) => {
    const service = buildService(client);
    await assert.rejects(
      () =>
        service.connect({
          workspaceId: '00000000-0000-0000-0000-000000000000',
          provider: 'github',
          credentials: { accessToken: 'x' },
        }),
      WorkspaceNotFoundError,
    );
  });
});

test('connect is idempotent — reconnecting the same provider updates the existing row instead of duplicating it', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    await service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'first' } });
    await service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'second' } });

    const integrations = await service.listForWorkspace(workspaceId);
    assert.equal(integrations.filter((i) => i.provider === 'github').length, 1);

    const credentials = await service.getDecryptedCredentials(workspaceId, 'github');
    assert.deepEqual(credentials, { accessToken: 'second' });
  });
});

test('disconnect disables the integration and deletes its stored credentials', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);
    await service.connect({ workspaceId, provider: 'calendar', credentials: { accessToken: 'a', refreshToken: 'b' } });

    const integration = await service.disconnect(workspaceId, 'calendar');

    assert.equal(integration.enabled, false);
    assert.equal(integration.status, 'disconnected');
    await assert.rejects(() => service.getDecryptedCredentials(workspaceId, 'calendar'), IntegrationNotFoundError);
  });
});

test('disconnect throws IntegrationNotFoundError for a provider that was never connected', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    await assert.rejects(() => service.disconnect(workspaceId, 'gmail'), IntegrationNotFoundError);
  });
});

test('rotate replaces the stored credentials and marks the integration re-validated', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);
    await service.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'old', refreshToken: 'old-r' } });

    const rotated = await service.rotate({
      workspaceId,
      provider: 'gmail',
      credentials: { accessToken: 'new', refreshToken: 'new-r' },
    });

    assert.equal(rotated.status, 'connected');
    const credentials = await service.getDecryptedCredentials(workspaceId, 'gmail');
    assert.deepEqual(credentials, { accessToken: 'new', refreshToken: 'new-r' });
  });
});

test('rotate throws IntegrationNotFoundError when the integration is not currently connected', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    await assert.rejects(
      () => service.rotate({ workspaceId, provider: 'gmail', credentials: { accessToken: 'a', refreshToken: 'b' } }),
      IntegrationNotFoundError,
    );
  });
});

test('rotate rejects invalid credentials and rejects a failed connection test, leaving the old credentials intact', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client, {
      github: new FakeConnector('github'),
    });
    await service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'original' } });

    await assert.rejects(
      () => service.rotate({ workspaceId, provider: 'github', credentials: {} }),
      InvalidCredentialsError,
    );

    const stillOriginal = await service.getDecryptedCredentials(workspaceId, 'github');
    assert.deepEqual(stillOriginal, { accessToken: 'original' });
  });
});

test('integrations are isolated per workspace', async () => {
  await withTestTransaction(async (client) => {
    const a = await seedWorkspace(client, 'rcs');
    const b = await seedWorkspace(client, 'mfs');
    const service = buildService(client);

    await service.connect({ workspaceId: a.workspaceId, provider: 'github', credentials: { accessToken: 'a-token' } });

    const bIntegrations = await service.listForWorkspace(b.workspaceId);
    const bGithub = bIntegrations.find((i) => i.provider === 'github')!;
    assert.equal(bGithub.enabled, false);

    await assert.rejects(() => service.getDecryptedCredentials(b.workspaceId, 'github'), IntegrationNotFoundError);
  });
});

// Phase 2.7: OAuth token expiry, auto-refresh, and disconnect revocation —————————————————————————————————————————————

test('connect persists tokenExpiresAt from credentials.expiresAt, surfaced on WorkspaceIntegration', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    const integration = await service.connect({
      workspaceId,
      provider: 'gmail',
      credentials: { accessToken: 'a', refreshToken: 'b', expiresAt },
    });

    assert.equal(integration.tokenExpiresAt, expiresAt);
  });
});

test('connect leaves tokenExpiresAt null when credentials carry no expiresAt (e.g. a non-expiring GitHub token)', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);

    const integration = await service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'gho_abc' } });

    assert.equal(integration.tokenExpiresAt, null);
  });
});

test('getDecryptedCredentials transparently refreshes an expired token and persists the refreshed credentials', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const newExpiry = new Date(Date.now() + 3600_000).toISOString();
    const oauthProvider = new FakeOAuthProvider('gmail', {
      accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresAt: newExpiry,
    });
    const service = buildService(client, {}, { gmail: oauthProvider });
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await service.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'stale', refreshToken: 'old-refresh', expiresAt: expiredAt } });

    const credentials = await service.getDecryptedCredentials(workspaceId, 'gmail');

    assert.equal(credentials.accessToken, 'fresh-access');
    assert.equal(oauthProvider.refreshCallCount, 1);

    // The refresh must actually persist — a second read shouldn't refresh again, and the public record reflects the new expiry.
    const secondRead = await service.getDecryptedCredentials(workspaceId, 'gmail');
    assert.equal(secondRead.accessToken, 'fresh-access');
    assert.equal(oauthProvider.refreshCallCount, 1, 'a still-fresh token must not trigger a second refresh');

    const integrations = await service.listForWorkspace(workspaceId);
    const gmail = integrations.find((i) => i.provider === 'gmail')!;
    assert.equal(gmail.tokenExpiresAt, newExpiry);
  });
});

test('getDecryptedCredentials does not refresh a token that is not yet expired', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const oauthProvider = new FakeOAuthProvider('gmail', { accessToken: 'should-not-appear', refreshToken: 'x', expiresAt: null });
    const service = buildService(client, {}, { gmail: oauthProvider });
    const farFuture = new Date(Date.now() + 3600_000).toISOString();
    await service.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'still-good', refreshToken: 'r', expiresAt: farFuture } });

    const credentials = await service.getDecryptedCredentials(workspaceId, 'gmail');

    assert.equal(credentials.accessToken, 'still-good');
    assert.equal(oauthProvider.refreshCallCount, 0);
  });
});

test('getDecryptedCredentials does not attempt a refresh when no OAuthProvider is registered for that provider', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client); // no oauthProviders at all
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await service.connect({ workspaceId, provider: 'gmail', credentials: { accessToken: 'stale', refreshToken: 'r', expiresAt: expiredAt } });

    const credentials = await service.getDecryptedCredentials(workspaceId, 'gmail');

    assert.equal(credentials.accessToken, 'stale', 'without a registered OAuthProvider, the stored (possibly stale) token is returned as-is');
  });
});

test('disconnect attempts a best-effort token revocation before deleting credentials', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const oauthProvider = new FakeOAuthProvider('github', { accessToken: 'irrelevant', refreshToken: null, expiresAt: null });
    const service = buildService(client, {}, { github: oauthProvider });
    await service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'gho_abc' } });

    await service.disconnect(workspaceId, 'github');

    assert.deepEqual(oauthProvider.revokedTokens, ['gho_abc']);
  });
});

test('disconnect succeeds even when the OAuth provider fails to revoke the token', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const failingOAuthProvider: OAuthProvider = {
      provider: 'github',
      getAuthorizationUrl: () => 'https://example.test/authorize',
      exchangeCode: async () => ({ accessToken: 'x', refreshToken: null, expiresAt: null }),
      refreshAccessToken: async () => ({ accessToken: 'x', refreshToken: null, expiresAt: null }),
      revokeToken: async () => {
        throw new Error('provider is down');
      },
    };
    const service = buildService(client, {}, { github: failingOAuthProvider });
    await service.connect({ workspaceId, provider: 'github', credentials: { accessToken: 'gho_abc' } });

    const integration = await service.disconnect(workspaceId, 'github');

    assert.equal(integration.enabled, false, 'a revoke failure must never block the local disconnect');
  });
});

test('disconnect clears tokenExpiresAt', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const service = buildService(client);
    await service.connect({
      workspaceId, provider: 'calendar',
      credentials: { accessToken: 'a', refreshToken: 'b', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
    });

    const integration = await service.disconnect(workspaceId, 'calendar');

    assert.equal(integration.tokenExpiresAt, null);
  });
});
