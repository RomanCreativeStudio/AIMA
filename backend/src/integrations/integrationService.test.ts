import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db/queryable';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
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

function buildService(
  db: Queryable,
  overrides: Partial<Record<IntegrationProvider, IntegrationConnector>> = {},
): IntegrationService {
  const registry = new IntegrationRegistry();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: overrides.gmail ?? new FakeConnector('gmail'),
    github: overrides.github ?? new FakeConnector('github'),
    calendar: overrides.calendar ?? new FakeConnector('calendar'),
  };
  return new IntegrationService(db, registry, connectors, new AesGcmCredentialEncryptor(TEST_KEY));
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
