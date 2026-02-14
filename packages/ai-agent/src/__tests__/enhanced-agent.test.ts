import { describe, expect, it } from 'vitest';
import { createDataTransformationTools } from '../data-tools.js';
import { createExecutionPlanner } from '../planner.js';

describe('createDataTransformationTools', () => {
  const tools = createDataTransformationTools();

  it('should create 5 tools', () => {
    expect(tools).toHaveLength(5);
    const names = tools.map((t) => t.name);
    expect(names).toContain('summarize_collection');
    expect(names).toContain('transform_documents');
    expect(names).toContain('aggregate_data');
    expect(names).toContain('analyze_patterns');
    expect(names).toContain('format_results');
  });

  it('summarize_collection should return summary structure', async () => {
    const tool = tools.find((t) => t.name === 'summarize_collection')!;
    const result = await tool.execute(
      { collection: 'todos', sampleSize: 50 },
      { messages: [], iteration: 0, config: {} as never }
    );
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).collection).toBe('todos');
  });

  it('transform_documents should reject unknown operation types', async () => {
    const tool = tools.find((t) => t.name === 'transform_documents')!;
    const result = await tool.execute(
      { collection: 'todos', operations: [{ type: 'unknown' }] },
      { messages: [], iteration: 0, config: {} as never }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown operation type');
  });

  it('format_results should produce markdown table', async () => {
    const tool = tools.find((t) => t.name === 'format_results')!;
    const result = await tool.execute(
      {
        data: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
        format: 'markdown',
      },
      { messages: [], iteration: 0, config: {} as never }
    );
    expect(result.success).toBe(true);
    const formatted = (result.data as Record<string, unknown>).formatted as string;
    expect(formatted).toContain('| name | age |');
    expect(formatted).toContain('Alice');
  });

  it('format_results should produce CSV', async () => {
    const tool = tools.find((t) => t.name === 'format_results')!;
    const result = await tool.execute(
      { data: [{ x: 1, y: 2 }], format: 'csv' },
      { messages: [], iteration: 0, config: {} as never }
    );
    const formatted = (result.data as Record<string, unknown>).formatted as string;
    expect(formatted).toContain('x,y');
  });
});

describe('createExecutionPlanner', () => {
  it('should create a plan with steps', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Test goal', [
      { id: 'step-1', description: 'First step', dependsOn: [] },
      { id: 'step-2', description: 'Second step', dependsOn: ['step-1'] },
    ]);

    expect(plan.goal).toBe('Test goal');
    expect(plan.steps).toHaveLength(2);
  });

  it('should return steps whose dependencies are met', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Goal', [
      { id: 'a', description: 'A', dependsOn: [] },
      { id: 'b', description: 'B', dependsOn: ['a'] },
      { id: 'c', description: 'C', dependsOn: [] },
    ]);

    const nextSteps = planner.getNextSteps(plan);
    expect(nextSteps.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('should unlock dependent steps after completion', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Goal', [
      { id: 'a', description: 'A', dependsOn: [] },
      { id: 'b', description: 'B', dependsOn: ['a'] },
    ]);

    planner.markComplete(plan, 'a', 'result-a');
    const nextSteps = planner.getNextSteps(plan);
    expect(nextSteps.map((s) => s.id)).toContain('b');
  });

  it('should cascade failures to dependents', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Goal', [
      { id: 'a', description: 'A', dependsOn: [] },
      { id: 'b', description: 'B', dependsOn: ['a'] },
      { id: 'c', description: 'C', dependsOn: ['b'] },
    ]);

    planner.markFailed(plan, 'a', 'timeout');

    expect(plan.steps[1]!.status).toBe('failed');
    expect(plan.steps[2]!.status).toBe('failed');
  });

  it('should track progress in summary', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Goal', [
      { id: 'a', description: 'A', dependsOn: [] },
      { id: 'b', description: 'B', dependsOn: [] },
      { id: 'c', description: 'C', dependsOn: [] },
      { id: 'd', description: 'D', dependsOn: [] },
    ]);

    planner.markComplete(plan, 'a');
    planner.markComplete(plan, 'b');

    const summary = planner.getPlanSummary(plan);
    expect(summary.totalSteps).toBe(4);
    expect(summary.completedSteps).toBe(2);
    expect(summary.progress).toBe(0.5);
  });

  it('should detect plan completion', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Goal', [{ id: 'a', description: 'A', dependsOn: [] }]);

    expect(planner.isComplete(plan)).toBe(false);
    planner.markComplete(plan, 'a');
    expect(planner.isComplete(plan)).toBe(true);
  });

  it('should allow adding steps to existing plan', () => {
    const planner = createExecutionPlanner();
    const plan = planner.createPlan('Goal');
    expect(plan.steps).toHaveLength(0);

    planner.addStep(plan, { id: 'new', description: 'New step', dependsOn: [] });
    expect(plan.steps).toHaveLength(1);
  });
});
