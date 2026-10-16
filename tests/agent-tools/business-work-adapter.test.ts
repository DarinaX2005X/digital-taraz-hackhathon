import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { BusinessWorkResultSchema, type BusinessWorkToolDescriptor } from '../../src/contracts/business-work';
import { businessWorkToolExtension } from '../../src/features/agent-tools/server/business-work-adapter';
import { projectBusinessProgress } from '../../src/features/agent-tools/server/business';
import { BusinessContextSchema } from '../../src/features/agent-tools/server/context';
import type { ToolContext } from '../../src/features/runs/server/registry';

const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  workspace: '00000000-0000-4000-8000-000000000002',
  project: '00000000-0000-4000-8000-000000000003',
  run: '00000000-0000-4000-8000-000000000004',
  step: '00000000-0000-4000-8000-000000000005',
  source: '00000000-0000-4000-8000-000000000006',
};

describe('K7 business work adapter', () => {
  it('uses the durable step id as producer operation id and records only validated results in the effect', async () => {
    const execute = vi.fn(async (_input: { label: string }, execution: Parameters<BusinessWorkToolDescriptor<{ label: string }>['execute']>[1]) => BusinessWorkResultSchema.parse({
      artifacts: [], inputRevisionVector: execution.inputRevisionVector, checks: [], unresolved: [],
      decision: { id: 'creative_direction', options: [{ id: 'precise', label: 'Precise', artifactIds: [] }, { id: 'bold', label: 'Bold', artifactIds: [] }], requiresConsent: true },
      summary: 'Prepared from the pinned source.',
    }));
    const descriptor: BusinessWorkToolDescriptor<{ label: string }> = {
      name: 'campaign.build-work', version: 1, purpose: 'Build checked campaign materials.',
      inputSchema: z.strictObject({ label: z.string().min(1) }), outputSchema: BusinessWorkResultSchema,
      policy: 'edit', costClass: 'local', deadlineMs: 30_000, idempotency: 'operation-receipt', execute,
    };
    const definition = businessWorkToolExtension([descriptor])({} as never)[0]!;
    const state = BusinessContextSchema.parse({
      schema: 1, goal: 'Prepare a launch kit', locale: 'en',
      inputRefs: [{ kind: 'source', id: ids.source, revision: 3 }], sources: [], artifacts: [], messages: [],
      plan: [], questions: [], answers: [], results: [], summary: '', round: 0,
    });
    const context = {
      fence: { runId: ids.run, stepId: ids.step, epoch: 4, leaseOwner: 'worker-1' },
      workspaceId: ids.workspace, projectId: ids.project, userId: ids.user, authzVersion: 7,
      context: state, signal: new AbortController().signal,
      checkpoint: vi.fn(),
    } satisfies ToolContext;

    const prepared = await definition.prepare!({ label: 'Autumn launch' }, context);
    expect(execute).toHaveBeenCalledWith({ label: 'Autumn launch' }, expect.objectContaining({
      operationId: ids.step, workspaceId: ids.workspace, projectId: ids.project,
      expectedAuthzVersion: 7, cancelEpoch: 4, inputRevisionVector: { [ids.source]: 3 },
      authority: { kind: 'user', userId: ids.user },
    }));
    const outcome = await definition.effect({} as never, { label: 'Autumn launch' }, context, state, prepared);
    expect(definition.name).toBe('campaign_build_work');
    expect(outcome).toMatchObject({ state: 'waiting_input', resultRefs: [], context: { summary: 'Prepared from the pinned source.', selectedOptionId: null, workDecision: { id: 'creative_direction', requiresConsent: true } } });
    expect(projectBusinessProgress(outcome.context)).toMatchObject({
      workDecision: { id: 'creative_direction', selectedOptionId: null, options: [{ id: 'precise' }, { id: 'bold' }] },
      branches: [{ id: 'precise', state: 'waiting_input' }, { id: 'bold', state: 'waiting_input' }],
    });
  });

  it('preserves a trusted demo authority and rejects it after expiry before producer execution', async () => {
    const execute = vi.fn(async (_input: { label: string }, execution: Parameters<BusinessWorkToolDescriptor<{ label: string }>['execute']>[1]) => BusinessWorkResultSchema.parse({
      artifacts: [], inputRevisionVector: execution.inputRevisionVector, checks: [], unresolved: [], summary: 'Prepared inside the demo scope.',
    }));
    const descriptor: BusinessWorkToolDescriptor<{ label: string }> = {
      name: 'finance.demo-work', version: 1, purpose: 'Build demo-scoped work.',
      inputSchema: z.strictObject({ label: z.string().min(1) }), outputSchema: BusinessWorkResultSchema,
      policy: 'edit', costClass: 'local', deadlineMs: 30_000, idempotency: 'operation-receipt', execute,
    };
    const definition = businessWorkToolExtension([descriptor])({} as never)[0]!;
    const base = BusinessContextSchema.parse({
      schema: 1, goal: 'Prepare demo work', locale: 'en',
      inputRefs: [{ kind: 'source', id: ids.source, revision: 3 }], sources: [], artifacts: [], messages: [],
      plan: [], questions: [], answers: [], results: [], summary: '', round: 0,
      executionAuthority: { kind: 'demo', sessionId: ids.run, userId: ids.user, expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    const context = {
      fence: { runId: ids.run, stepId: ids.step, epoch: 4, leaseOwner: 'worker-1' },
      workspaceId: ids.workspace, projectId: ids.project, userId: ids.user, authzVersion: 7,
      context: base, signal: new AbortController().signal, checkpoint: vi.fn(),
    } satisfies ToolContext;

    await definition.prepare!({ label: 'Scoped' }, context);
    expect(execute).toHaveBeenCalledWith({ label: 'Scoped' }, expect.objectContaining({
      authority: { kind: 'demo', sessionId: ids.run, userId: ids.user, expiresAt: '2099-01-01T00:00:00.000Z' },
    }));

    execute.mockClear();
    await expect(definition.prepare!({ label: 'Expired' }, {
      ...context,
      context: { ...base, executionAuthority: { ...base.executionAuthority!, expiresAt: '2000-01-01T00:00:00.000Z' } },
    })).rejects.toMatchObject({ failure: 'access_changed' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('projects a bounded authoritative work preview through the durable business context', () => {
    const workPreview = {
      kind: 'forecast' as const,
      editable: { artifactId: ids.source, revision: 2 },
      target: 'weekly_sales', aggregation: 'weekly' as const,
      coverage: { start: '2026-01-01', end: '2026-06-30', observations: 26, regular: true },
      eligibility: { state: 'eligible' as const, reasons: [] }, modelFamily: 'seasonal-naive' as const,
      backtestMetrics: { mae: '12.5', wape: '0.18' }, baseline: { family: 'last-value' as const, metrics: { mae: '18', wape: '0.24' } },
      interval: { method: 'residual-quantile' as const, level: 0.8, empiricalCoverage: 0.81 },
      points: [{ date: '2026-07-07', value: '140', lower: '120', upper: '165' }], pointCount: 12,
      folds: [{ trainEnd: '2026-05-31', testStart: '2026-06-01', testEnd: '2026-06-30', metrics: { mae: '12.5', wape: '0.18' } }], foldCount: 3,
    };
    const state = BusinessContextSchema.parse({
      schema: 1, goal: 'Forecast reviewed sales', locale: 'en', inputRefs: [], sources: [], artifacts: [], messages: [],
      plan: [], questions: [], answers: [], results: [], summary: 'Forecast saved.', round: 1, workPreview,
    });
    expect(projectBusinessProgress(state).workPreview).toEqual(workPreview);
  });
});

