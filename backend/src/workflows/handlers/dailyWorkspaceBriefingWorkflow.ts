import type { AIProvider } from '@aima/ai-engine';
import type { ApprovalEngine } from '../../approval/approvalEngine';
import type { HealthService } from '../../health/healthService';
import type { TaskService } from '../../tasks/taskService';
import type { WorkflowDefinition } from '../types';
import type { WorkflowHandler, WorkflowStepContext } from './types';

/**
 * "Daily Workspace Briefing" (Phase 2.4, item 2): entirely internal — both
 * steps read AIMA's own data (tasks, pending approvals, system health) and
 * summarize it. No capability, no approval checkpoint; the closest thing
 * to a plain "generate a report" action.
 */
export class DailyWorkspaceBriefingWorkflowHandler implements WorkflowHandler {
  constructor(
    readonly definition: WorkflowDefinition,
    private readonly aiProvider: AIProvider,
    private readonly taskService: TaskService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly healthService: HealthService,
  ) {}

  async executeStep(stepIndex: number, context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const step = this.definition.steps[stepIndex];
    switch (step?.key) {
      case 'gather_snapshot':
        return this.gatherSnapshot(context);
      case 'compose_briefing':
        return this.composeBriefing(context);
      default:
        throw new Error(`Unknown step index ${stepIndex} for workflow "${this.definition.key}"`);
    }
  }

  private async gatherSnapshot(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const [tasks, pendingApprovals, health] = await Promise.all([
      this.taskService.listTasks(context.workspaceId),
      this.approvalEngine.list(context.workspaceId, 'pending'),
      this.healthService.check(),
    ]);

    const openTaskCount = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length;

    return {
      openTaskCount,
      pendingApprovalCount: pendingApprovals.length,
      systemHealthy: health.status === 'ok',
    };
  }

  private async composeBriefing(context: WorkflowStepContext): Promise<Record<string, unknown>> {
    const snapshot = context.priorOutputs.gather_snapshot ?? {};
    const prompt =
      `Write a short daily workspace briefing from this snapshot: ${snapshot.openTaskCount ?? 0} open tasks, ` +
      `${snapshot.pendingApprovalCount ?? 0} pending approvals, system health ` +
      `${snapshot.systemHealthy ? 'ok' : 'degraded'}.`;

    const completion = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'You write short, friendly daily briefings for a workspace owner.',
    });

    return { briefing: completion.content };
  }
}
