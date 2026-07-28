import type { AIProvider } from '@aima/ai-engine';
import type { Queryable } from '../db/queryable';

export type CheckStatus = 'ok' | 'error';

export interface HealthCheckResult {
  status: CheckStatus;
  detail?: string;
}

export interface SystemHealth {
  status: CheckStatus;
  checks: {
    database: HealthCheckResult;
    aiProvider: HealthCheckResult;
    memory: HealthCheckResult;
    knowledge: HealthCheckResult;
    integrations: HealthCheckResult;
  };
}

/** Which OAuth-backed providers are registered and ready to use (Phase 3.1) — mirrors the `oauthProviders` map actually wired into `IntegrationService`/`OAuthService`, not a raw re-check of environment variables. */
export interface IntegrationReadiness {
  gmail: boolean;
  github: boolean;
  calendar: boolean;
}

const FULLY_READY: IntegrationReadiness = { gmail: true, github: true, calendar: true };

/**
 * The System Health Layer (Phase 1.6), extended in Phase 3.1 with an
 * integration-readiness check. Database/memory/knowledge checks run a
 * cheap real query; the AI provider and integrations checks report
 * configuration only — no live external call — the same reasoning
 * for both: a network round-trip to a third party on every health poll is
 * a bad tradeoff for a check that might run every few seconds
 * (docs/decisions/0006-assistant-core-orchestration.md,
 * docs/decisions/0016-production-deployment-foundation.md).
 */
export class HealthService {
  constructor(
    private readonly db: Queryable,
    private readonly aiProvider: AIProvider,
    private readonly integrationReadiness: IntegrationReadiness = FULLY_READY,
  ) {}

  async check(): Promise<SystemHealth> {
    const [database, memory, knowledge] = await Promise.all([
      this.checkQuery('SELECT 1'),
      this.checkQuery('SELECT 1 FROM memory_records LIMIT 1'),
      this.checkQuery('SELECT 1 FROM document_chunks LIMIT 1'),
    ]);

    const aiProvider = this.checkAIProvider();
    const integrations = this.checkIntegrations();

    const checks = { database, aiProvider, memory, knowledge, integrations };
    const status: CheckStatus = Object.values(checks).every((check) => check.status === 'ok') ? 'ok' : 'error';

    return { status, checks };
  }

  private async checkQuery(sql: string): Promise<HealthCheckResult> {
    try {
      await this.db.query(sql);
      return { status: 'ok' };
    } catch (error) {
      return { status: 'error', detail: (error as Error).message };
    }
  }

  private checkAIProvider(): HealthCheckResult {
    if (!this.aiProvider?.name) {
      return { status: 'error', detail: 'No AI provider configured' };
    }
    return { status: 'ok', detail: this.aiProvider.name };
  }

  private checkIntegrations(): HealthCheckResult {
    const missing = Object.entries(this.integrationReadiness)
      .filter(([, ready]) => !ready)
      .map(([provider]) => provider);
    if (missing.length > 0) {
      return { status: 'error', detail: `Not configured: ${missing.join(', ')}` };
    }
    return { status: 'ok', detail: 'gmail, github, calendar' };
  }
}
