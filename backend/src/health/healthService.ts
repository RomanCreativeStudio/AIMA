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
  };
}

/**
 * The System Health Layer (Phase 1.6): reports whether each major AIMA
 * subsystem is reachable. Database/memory/knowledge checks run a cheap
 * real query; the AI provider check reports configuration only (which
 * provider is selected) rather than making a real completion call — a
 * network ping would cost tokens/latency on every health poll, which is a
 * bad tradeoff for a check that might run every few seconds
 * (docs/decisions/0006-assistant-core-orchestration.md).
 */
export class HealthService {
  constructor(
    private readonly db: Queryable,
    private readonly aiProvider: AIProvider,
  ) {}

  async check(): Promise<SystemHealth> {
    const [database, memory, knowledge] = await Promise.all([
      this.checkQuery('SELECT 1'),
      this.checkQuery('SELECT 1 FROM memory_records LIMIT 1'),
      this.checkQuery('SELECT 1 FROM document_chunks LIMIT 1'),
    ]);

    const aiProvider = this.checkAIProvider();

    const checks = { database, aiProvider, memory, knowledge };
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
}
