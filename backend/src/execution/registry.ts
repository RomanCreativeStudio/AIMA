import type { ActionExecutor } from './types';

/** Mirrors `WorkflowRegistry`/`IntegrationRegistry` — describes which executors exist, never performs anything itself. */
export class ExecutionRegistry {
  private readonly executors = new Map<string, ActionExecutor>();

  constructor(seed: ActionExecutor[] = []) {
    for (const executor of seed) {
      this.register(executor);
    }
  }

  register(executor: ActionExecutor): void {
    if (this.executors.has(executor.actionType)) {
      throw new Error(`Executor already registered for action type: "${executor.actionType}"`);
    }
    this.executors.set(executor.actionType, executor);
  }

  get(actionType: string): ActionExecutor | undefined {
    return this.executors.get(actionType);
  }

  list(): ActionExecutor[] {
    return Array.from(this.executors.values());
  }
}
