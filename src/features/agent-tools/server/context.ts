import type { PoolClient } from 'pg';
import { z } from 'zod';
import { SourceRefSchema } from '../../../contracts/artifacts';
import { SourceFragmentSchema } from '../../../contracts/sources';
import { RunCurrentArtifactSchema, RunInputRefSchema, RunQuestionSchema, RunResultRefSchema, type CreateRun } from '../../../contracts/runs';
import { IdSchema, LocaleSchema } from '../../../contracts/primitives';
import { MaterialDecisionContextSchema } from '../../../contracts/materials';
import { BusinessContextSelectionSchema, BusinessWorkDecisionSchema, WorkExecutionAuthoritySchema } from '../../../contracts/business-work';
import { BusinessWorkPreviewSchema } from '../../../contracts/work-preview';
import { ProposeWorkPlanResultSchema } from '../../operations/domain/propose-work-plan';
import { withWorkspaceAccessInTransaction } from '../../identity/server/access';
import { ArtifactExcerptSchema } from './artifact-context';
import { readPinnedSource, readPinnedSourceChunk } from '../../sources/server/pinned-source';
import type { ToolContext } from '../../runs/server/registry';
import type { ModelMessage } from '../../runs/server/gateway';
import { RunError } from '../../runs/domain/errors';
import {
  BusinessSourceRoleAssignmentSchema,
  DecisionPortfolioSchema,
  OperationsDecisionSchema,
} from '../../commercial/domain/decision';
import { BUSINESS_PROCEDURE_VERSION, businessProcedurePrompt } from './procedure';

const MessageSchema = z.strictObject({ role: z.enum(['assistant', 'tool']), content: z.string().nullable(), toolCallId: z.string().optional(), toolCalls: z.array(z.strictObject({ id: z.string(), name: z.string(), arguments: z.string() })).optional() });
export const QuestionSchema = RunQuestionSchema;
export const DecisionBundleSchema = z.strictObject({
  optionId: z.string().min(1).max(50),
  estimate: RunResultRefSchema.extend({ title: z.string().max(240) }),
  offer: RunResultRefSchema.extend({ title: z.string().max(240) }),
  plan: RunResultRefSchema.extend({ title: z.string().max(240) }),
});
export const MaterialEvidenceContextSchema = MaterialDecisionContextSchema.omit({ viewer: true, sample: true });
export const BusinessPlanProposalSchema = z.strictObject({
  id: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(240),
  result: ProposeWorkPlanResultSchema,
});
const CurrentBusinessSourceSchema = z.strictObject({
  sourceRef: SourceRefSchema,
  title: z.string(),
  chunkCount: z.number().int(),
  manifest: z.strictObject({ fragmentCount: z.number().int().nonnegative(), rowCount: z.number().int().nonnegative(), pageCount: z.number().int().nonnegative(), complete: z.boolean() }),
  windows: z.array(z.strictObject({ ordinal: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), count: z.number().int().nonnegative() })).max(100),
  coverage: z.strictObject({ loadedFragments: z.number().int().nonnegative(), totalFragments: z.number().int().nonnegative(), complete: z.boolean(), truncated: z.boolean() }),
  fragments: z.array(SourceFragmentSchema).max(100),
});
const BusinessSourceSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || !('window' in raw) || 'coverage' in raw) return raw;
  const legacy = raw as { window?: { ordinal?: number; offset?: number; totalFragments?: number; truncatedText?: boolean }; fragments?: unknown[]; chunkCount?: number } & Record<string, unknown>;
  const count = Array.isArray(legacy.fragments) ? legacy.fragments.length : 0;
  const total = Math.max(count, legacy.window?.totalFragments ?? 0);
  const rest = { ...legacy };
  delete rest.window;
  return {
    ...rest,
    manifest: { fragmentCount: total, rowCount: 0, pageCount: 0, complete: false },
    windows: [{ ordinal: legacy.window?.ordinal ?? 0, offset: legacy.window?.offset ?? 0, count }],
    coverage: { loadedFragments: count, totalFragments: total, complete: (legacy.chunkCount ?? 0) <= 1 && count === total && !legacy.window?.truncatedText, truncated: Boolean(legacy.window?.truncatedText) },
  };
}, CurrentBusinessSourceSchema);
export const BusinessContextSchema = z.strictObject({
  schema: z.literal(1), procedureVersion: z.literal(BUSINESS_PROCEDURE_VERSION).default(BUSINESS_PROCEDURE_VERSION), goal: z.string().max(12000), locale: LocaleSchema, inputRefs: z.array(RunInputRefSchema).max(100),
  currentArtifact: RunCurrentArtifactSchema.nullable().default(null),
  executionAuthority: WorkExecutionAuthoritySchema.nullable().default(null),
  businessContextRefs: z.array(BusinessContextSelectionSchema).max(20).default([]),
  sources: z.array(BusinessSourceSchema).max(100),
  sourceRoles: z.array(BusinessSourceRoleAssignmentSchema).max(100).default([]),
  artifacts: z.array(ArtifactExcerptSchema).max(40),
  messages: z.array(MessageSchema).max(60), plan: z.array(z.string().min(1).max(500)).max(10),
  questions: z.array(QuestionSchema).max(10), answers: z.array(z.strictObject({ questionId: z.string().max(50), answer: z.string().min(1).max(4000) })).max(40),
  operations: z.array(OperationsDecisionSchema).max(20).default([]),
  planProposals: z.array(BusinessPlanProposalSchema).max(5).default([]),
  datasets: z.array(MaterialEvidenceContextSchema).max(3).default([]),
  decision: DecisionPortfolioSchema.nullable().default(null),
  workDecision: BusinessWorkDecisionSchema.nullable().default(null),
  workPreview: BusinessWorkPreviewSchema.nullable().default(null),
  selectedOptionId: z.string().min(1).max(50).nullable().default(null),
  acceptedConditionIds: z.array(z.string().min(1).max(50)).max(5).default([]),
  bundle: DecisionBundleSchema.nullable().default(null),
  results: z.array(RunResultRefSchema.extend({ title: z.string().max(240) })).max(40), summary: z.string().max(3000), round: z.number().int().nonnegative(),
});
export type BusinessContext = z.infer<typeof BusinessContextSchema>;
export function initialBusinessContext(input: CreateRun): BusinessContext {
  return { schema: 1, procedureVersion: BUSINESS_PROCEDURE_VERSION, goal: input.goal, locale: input.locale, inputRefs: input.inputRefs, currentArtifact: null, executionAuthority: null, businessContextRefs: [], sources: [], sourceRoles: [], artifacts: [], messages: [], plan: [], questions: [], answers: [], operations: [], planProposals: [], datasets: [], decision: null, workDecision: null, workPreview: null, selectedOptionId: null, acceptedConditionIds: [], bundle: null, results: [], summary: '', round: 0 };
}
export function businessContext(context: ToolContext) { return BusinessContextSchema.parse(context.context); }
export const principalFor = (context: ToolContext) => ({ kind: 'job' as const, userId: context.userId, authzVersion: context.authzVersion });
export function toolReply(state: BusinessContext, callId: string, output: unknown): BusinessContext {
  if (callId === 'initial') return state;
  return { ...state, messages: [...state.messages, { role: 'tool', content: JSON.stringify(output), toolCallId: callId }] };
}
export const ReadSourcesSchema = z.strictObject({ sourceId: IdSchema.nullable(), ordinal: z.number().int().min(0).max(3999), offset: z.number().int().min(0).max(499), limit: z.number().int().min(1).max(100) });
export async function readSources(tx: PoolClient, context: ToolContext, state: BusinessContext, input: z.infer<typeof ReadSourcesSchema>) {
  return withWorkspaceAccessInTransaction(tx, principalFor(context), { workspaceId: context.workspaceId, projectId: context.projectId ?? undefined, scope: 'read' }, async (transaction, access) => {
    const selected = state.inputRefs.filter((ref) => ref.kind === 'source' && (!input.sourceId || ref.id === input.sourceId));
    if (input.sourceId && !selected.length) throw new RunError('access_changed', 'NOT_FOUND');
    const sources = structuredClone(state.sources);
    for (const ref of selected) {
      const version = (await transaction.query<{ id: string }>('SELECT id FROM source_versions WHERE workspace_id=$1 AND source_id=$2 AND revision=$3', [context.workspaceId, ref.id, ref.revision])).rows[0];
      if (!version) throw new RunError('access_changed', 'NOT_FOUND');
      const pinned = await readPinnedSource(transaction, access, { sourceId: ref.id, sourceVersionId: version.id });
      if (pinned.projectId !== context.projectId) throw new RunError('access_changed', 'NOT_FOUND');
      let source = sources.find((item) => item.sourceRef.sourceId === ref.id);
      if (!source) {
        source = {
          sourceRef: pinned.sourceRef, title: pinned.title, chunkCount: pinned.chunkCount,
          manifest: { fragmentCount: pinned.manifest.fragmentCount, rowCount: pinned.manifest.rowCount, pageCount: pinned.manifest.pageCount, complete: pinned.manifest.complete },
          windows: [], coverage: { loadedFragments: 0, totalFragments: pinned.manifest.fragmentCount, complete: pinned.manifest.fragmentCount === 0, truncated: false }, fragments: [],
        };
        sources.push(source);
      }
      if (!pinned.chunkCount) continue;
      const chunk = await readPinnedSourceChunk(transaction, access, { sourceId: ref.id, sourceVersionId: version.id, ordinal: input.ordinal });
      // A bounded working context remains explicit: the model can request subsequent chunks.
      if (input.offset >= chunk.fragments.length && chunk.fragments.length) throw new RunError('invalid_result');
      const window = chunk.fragments.slice(input.offset, input.offset + input.limit);
      const fragments = window.map((fragment) => ({ ...fragment, ...(fragment.text ? { text: fragment.text.slice(0, 8000) } : {}) }));
      const byId = new Map(source.fragments.map((fragment) => [fragment.id, fragment]));
      for (const fragment of fragments) byId.set(fragment.id, fragment);
      source.fragments = [...byId.values()].slice(0, 100);
      const windowKey = `${input.ordinal}:${input.offset}`;
      if (!source.windows.some((item) => `${item.ordinal}:${item.offset}` === windowKey)) source.windows.push({ ordinal: input.ordinal, offset: input.offset, count: fragments.length });
      const truncated = source.coverage.truncated || window.some((fragment) => (fragment.text?.length ?? 0) > 8000) || byId.size > 100;
      source.coverage = { loadedFragments: source.fragments.length, totalFragments: pinned.manifest.fragmentCount, complete: source.fragments.length === pinned.manifest.fragmentCount && !truncated, truncated };
    }
    const next = { ...state, sources };
    if (Buffer.byteLength(JSON.stringify(next)) > 53_000) throw new RunError('invalid_result');
    return next;
  });
}
export function modelMessages(state: BusinessContext): ModelMessage[] {
  const evidence = state.sources.map((source) => ({ ...source, roles: state.sourceRoles.find((assignment) => assignment.sourceId === source.sourceRef.sourceId)?.roles ?? [], fragments: source.fragments }));
  const recentActions = state.messages.flatMap((message) => message.role === 'assistant' ? (message.toolCalls ?? []).map((call) => call.name) : []).slice(-20);
  return [
    { role: 'system', content: businessProcedurePrompt(state) },
    { role: 'user', content: JSON.stringify({ goal: state.goal, answers: state.answers, plan: state.plan, currentArtifact: state.currentArtifact, selectedOptionId: state.selectedOptionId, acceptedConditionIds: state.acceptedConditionIds, selectedInputs: state.inputRefs, sources: evidence, datasets: state.datasets, artifacts: state.artifacts, planProposals: state.planProposals, operations: state.operations, decision: state.decision, workDecision: state.workDecision, workPreview: state.workPreview, bundle: state.bundle, savedResults: state.results, recentActions }) },
  ];
}
