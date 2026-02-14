/**
 * @module @pocket/ai-agent/planner
 *
 * Execution planner for the AI agent. Decomposes complex user requests
 * into a sequence of steps with dependencies, enabling multi-step
 * autonomous task execution.
 *
 * @example
 * ```typescript
 * const planner = createExecutionPlanner();
 * const plan = planner.createPlan('Find all overdue todos and send a summary');
 * for (const step of planner.getNextSteps(plan)) {
 *   await executeStep(step);
 *   planner.markComplete(plan, step.id);
 * }
 * ```
 */

export interface ExecutionStep {
  readonly id: string;
  readonly description: string;
  readonly toolName?: string;
  readonly toolArgs?: Record<string, unknown>;
  readonly dependsOn: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface ExecutionPlan {
  readonly id: string;
  readonly goal: string;
  readonly steps: ExecutionStep[];
  readonly createdAt: number;
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

export interface ExecutionPlanner {
  createPlan(goal: string, steps?: Omit<ExecutionStep, 'status'>[]): ExecutionPlan;
  addStep(plan: ExecutionPlan, step: Omit<ExecutionStep, 'status'>): void;
  getNextSteps(plan: ExecutionPlan): ExecutionStep[];
  markComplete(plan: ExecutionPlan, stepId: string, result?: unknown): void;
  markFailed(plan: ExecutionPlan, stepId: string, error: string): void;
  isComplete(plan: ExecutionPlan): boolean;
  getPlanSummary(plan: ExecutionPlan): PlanSummary;
}

export interface PlanSummary {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
  progress: number;
}

let planCounter = 0;

export function createExecutionPlanner(): ExecutionPlanner {
  function createPlan(goal: string, steps?: Omit<ExecutionStep, 'status'>[]): ExecutionPlan {
    return {
      id: `plan_${++planCounter}`,
      goal,
      steps: (steps ?? []).map((s) => ({ ...s, status: 'pending' as const })),
      createdAt: Date.now(),
      status: 'planning',
    };
  }

  function addStep(plan: ExecutionPlan, step: Omit<ExecutionStep, 'status'>): void {
    plan.steps.push({ ...step, status: 'pending' });
  }

  function getNextSteps(plan: ExecutionPlan): ExecutionStep[] {
    return plan.steps.filter((step) => {
      if (step.status !== 'pending') return false;
      // All dependencies must be completed
      return step.dependsOn.every((depId) => {
        const dep = plan.steps.find((s) => s.id === depId);
        return dep?.status === 'completed';
      });
    });
  }

  function markComplete(plan: ExecutionPlan, stepId: string, result?: unknown): void {
    const step = plan.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.result = result;
    }

    if (isComplete(plan)) {
      plan.status = 'completed';
    }
  }

  function markFailed(plan: ExecutionPlan, stepId: string, error: string): void {
    const step = plan.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.error = error;
    }

    // Mark dependent steps as failed too
    const failDependents = (failedId: string) => {
      for (const s of plan.steps) {
        if (s.dependsOn.includes(failedId) && s.status === 'pending') {
          s.status = 'failed';
          s.error = `Dependency ${failedId} failed`;
          failDependents(s.id);
        }
      }
    };
    failDependents(stepId);

    const allDone = plan.steps.every((s) => s.status === 'completed' || s.status === 'failed');
    if (allDone) {
      plan.status = plan.steps.some((s) => s.status === 'failed') ? 'failed' : 'completed';
    }
  }

  function isComplete(plan: ExecutionPlan): boolean {
    return plan.steps.every((s) => s.status === 'completed' || s.status === 'failed');
  }

  function getPlanSummary(plan: ExecutionPlan): PlanSummary {
    const total = plan.steps.length;
    const completed = plan.steps.filter((s) => s.status === 'completed').length;
    const failed = plan.steps.filter((s) => s.status === 'failed').length;
    const pending = plan.steps.filter(
      (s) => s.status === 'pending' || s.status === 'running'
    ).length;

    return {
      totalSteps: total,
      completedSteps: completed,
      failedSteps: failed,
      pendingSteps: pending,
      progress: total > 0 ? completed / total : 0,
    };
  }

  return {
    createPlan,
    addStep,
    getNextSteps,
    markComplete,
    markFailed,
    isComplete,
    getPlanSummary,
  };
}
