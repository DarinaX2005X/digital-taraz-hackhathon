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
});

