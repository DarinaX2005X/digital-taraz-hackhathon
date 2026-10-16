import { z } from 'zod';

import {
  BusinessWorkResultSchema,
  WorkExecutionContextSchema,
  type BusinessWorkResult,
  type BusinessWorkToolDescriptor,
} from '@/contracts/business-work';
import { RunError } from '@/features/runs/domain/errors';
import type { BusinessToolDefinition, BusinessToolExtension } from './business';

function businessToolName(name: string) {
  const normalized = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized || normalized.length > 120) throw new Error('INVALID_BUSINESS_WORK_TOOL_NAME');
  return normalized;
}

function appendResults(state: Parameters<BusinessToolDefinition['effect']>[3], result: BusinessWorkResult) {
  const prior = new Map(state.results.map((item) => [item.id, item]));
  const refs = result.artifacts.map((item) => ({
    kind: 'artifact' as const,
    id: item.artifact.id,
    revision: item.artifact.currentRevision,
    title: item.artifact.title,
  }));
  for (const ref of refs) prior.set(ref.id, ref);
  return {
    refs,
    context: {
      ...state,
      results: [...prior.values()],
      summary: result.summary,
      decision: null,
      workDecision: result.decision ?? null,
      workPreview: result.workPreview ?? null,
      selectedOptionId: result.decision ? null : state.selectedOptionId,
      acceptedConditionIds: result.decision ? [] : state.acceptedConditionIds,
      bundle: result.decision ? null : state.bundle,
    },
  };
}

/**
 * Adapts a dependency-bound K7 producer to the durable business run.
 *
 * The producer executes during RunTool.prepare with the run step UUID as its
 * operation id. It owns an idempotent transaction and can reconcile a retry
 * after committing artifacts but before the run receipt commits. The effect
 * transaction only records the validated result references in run state.
 */
export function businessWorkToolExtension(
  descriptors: readonly BusinessWorkToolDescriptor<unknown>[],
): BusinessToolExtension {
  const names = descriptors.map((descriptor) => businessToolName(descriptor.name));
  if (new Set(names).size !== names.length) throw new Error('DUPLICATE_BUSINESS_WORK_TOOL_NAME');
  return () => descriptors.map((descriptor, index): BusinessToolDefinition => ({
    name: names[index]!,
    description: descriptor.purpose,
    schema: descriptor.inputSchema,
    action: descriptor.policy === 'edit' ? 'save' : 'read_sources',
    output: descriptor.outputSchema,
    costClass: descriptor.costClass,
    prepare: async (raw, context) => {
      if (!context.projectId) throw new RunError('invalid_result');
      const state = context.context;
      const parsedState = z.strictObject({
        locale: z.enum(['ru', 'kk', 'en']),
        inputRefs: z.array(z.strictObject({ kind: z.enum(['source', 'artifact']), id: z.uuid(), revision: z.number().int().nonnegative() })).max(100),
      }).passthrough().parse(state);
      const inputRevisionVector = Object.fromEntries(parsedState.inputRefs.map((ref) => [ref.id, ref.revision]));
      const execution = WorkExecutionContextSchema.parse({
        authority: state.executionAuthority ?? { kind: 'user', userId: context.userId },
        operationId: context.fence.stepId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        expectedAuthzVersion: context.authzVersion,
        allowedInputRefs: parsedState.inputRefs,
        inputRevisionVector,
        cancelEpoch: context.fence.epoch,
        locale: parsedState.locale,
      });
      if (execution.authority.kind === 'demo' && Date.parse(execution.authority.expiresAt) <= Date.now()) throw new RunError('access_changed');
      return descriptor.outputSchema.parse(await descriptor.execute(descriptor.inputSchema.parse(raw), execution));
    },
    effect: async (_tx, _raw, _context, state, prepared) => {
      const result = BusinessWorkResultSchema.parse(prepared);
      const { refs, context } = appendResults(state, result);
      return { output: result, resultRefs: refs.map((ref) => ({ kind: ref.kind, id: ref.id, revision: ref.revision })), context, ...(result.decision?.requiresConsent ? { state: 'waiting_input' as const } : {}) };
    },
  }));
}

