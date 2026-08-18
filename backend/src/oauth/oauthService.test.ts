import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seedWorkspace, withTestTransaction } from '../testUtils/db';
import type { Queryable } from '../db/queryable';
import { AesGcmCredentialEncryptor } from '../integrations/encryption';
import { IntegrationService } from '../integrations/integrationService';
import { IntegrationRegistry } from '../integrations/registry';
import type { IntegrationConnector, ConnectionTestResult } from '../integrations/connectors/types';
import type { IntegrationCredentials, IntegrationProvider } from '../integrations/types';
import { WorkspaceNotFoundError } from '../types/errors';
import { OAuthStateInvalidError } from './errors';
import { OAuthService } from './oauthService';
import type { OAuthProvider, OAuthTokenSet } from './types';

const TEST_KEY = randomBytes(32).toString('base64');

class FakeConnector implements IntegrationConnector {
  constructor(public readonly provider: IntegrationProvider) {}
  async testConnection(_credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    return { ok: true };
  }
}

class FakeOAuthProvider implements OAuthProvider {
  exchangedCodes: string[] = [];

  constructor(
    readonly provider: IntegrationProvider,
    private readonly tokens: OAuthTokenSet,
  ) {}

  getAuthorizationUrl(state: string): string {
    return `https://example.test/${this.provider}/authorize?state=${state}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokenSet> {
    this.exchangedCodes.push(code);
    return this.tokens;
  }

  async refreshAccessToken(): Promise<OAuthTokenSet> {
    return this.tokens;
  }

  async revokeToken(): Promise<void> {}
}

function buildServices(db: Queryable) {
  const registry = new IntegrationRegistry();
  const connectors: Record<IntegrationProvider, IntegrationConnector> = {
    gmail: new FakeConnector('gmail'),
    github: new FakeConnector('github'),
    calendar: new FakeConnector('calendar'),
  };
  const gmailOAuth = new FakeOAuthProvider('gmail', { accessToken: 'gmail-access', refreshToken: 'gmail-refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  const oauthProviders: Partial<Record<IntegrationProvider, OAuthProvider>> = { gmail: gmailOAuth };
  const integrationService = new IntegrationService(db, registry, connectors, new AesGcmCredentialEncryptor(TEST_KEY), oauthProviders);
  const oauthService = new OAuthService(db, oauthProviders, integrationService);
  return { oauthService, integrationService, gmailOAuth };
}

test('startAuthorization returns the provider-built authorization URL', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { oauthService } = buildServices(client);

    const { authorizationUrl } = await oauthService.startAuthorization(workspaceId, 'gmail');

    assert.match(authorizationUrl, /^https:\/\/example\.test\/gmail\/authorize\?state=/);
  });
});

test('startAuthorization rejects an unknown workspace', async () => {
  await withTestTransaction(async (client) => {
    const { oauthService } = buildServices(client);

    await assert.rejects(
      () => oauthService.startAuthorization('00000000-0000-0000-0000-000000000000', 'gmail'),
      WorkspaceNotFoundError,
    );
  });
});

test('completeAuthorization exchanges the code and connects through the existing IntegrationService', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { oauthService, integrationService, gmailOAuth } = buildServices(client);
    const { authorizationUrl } = await oauthService.startAuthorization(workspaceId, 'gmail');
    const state = new URL(authorizationUrl).searchParams.get('state')!;

    const integration = await oauthService.completeAuthorization('gmail', 'the-code', state);

    assert.equal(integration.enabled, true);
    assert.equal(integration.status, 'connected');
    assert.deepEqual(gmailOAuth.exchangedCodes, ['the-code']);
    const credentials = await integrationService.getDecryptedCredentials(workspaceId, 'gmail');
    assert.equal(credentials.accessToken, 'gmail-access');
  });
});

test('completeAuthorization rejects a state it never issued', async () => {
  await withTestTransaction(async (client) => {
    const { oauthService } = buildServices(client);

    await assert.rejects(() => oauthService.completeAuthorization('gmail', 'code', 'forged-state'), OAuthStateInvalidError);
  });
});

test('completeAuthorization rejects reusing an already-consumed state', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { oauthService } = buildServices(client);
    const { authorizationUrl } = await oauthService.startAuthorization(workspaceId, 'gmail');
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    await oauthService.completeAuthorization('gmail', 'first-code', state);

    await assert.rejects(() => oauthService.completeAuthorization('gmail', 'second-code', state), OAuthStateInvalidError);
  });
});

test('completeAuthorization rejects a state issued for a different provider', async () => {
  await withTestTransaction(async (client) => {
    const { workspaceId } = await seedWorkspace(client, 'rcs');
    const { oauthService } = buildServices(client);
    const { authorizationUrl } = await oauthService.startAuthorization(workspaceId, 'gmail');
    const state = new URL(authorizationUrl).searchParams.get('state')!;

    await assert.rejects(() => oauthService.completeAuthorization('calendar', 'code', state), OAuthStateInvalidError);
  });
});
