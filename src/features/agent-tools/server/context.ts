import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ArtifactKindSchema, SourceRefSchema, type ArtifactKind } from '../../../contracts/artifacts';
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
const AcceptedAnswerSchema = z.strictObject({ questionId: z.string().max(50), question: z.string().min(1).max(1000).optional(), answer: z.string().min(1).max(4000) });
export const QuestionSchema = RunQuestionSchema;
export const DecisionBundleSchema = z.strictObject({
  optionId: z.string().min(1).max(50),
  estimate: RunResultRefSchema.extend({ title: z.string().max(240) }),
  offer: RunResultRefSchema.extend({ title: z.string().max(240) }),
  plan: RunResultRefSchema.extend({ title: z.string().max(240) }),
});
export const MaterialEvidenceContextSchema = MaterialDecisionContextSchema.omit({ viewer: true, sample: true });

const artifactIntentTokens: Record<ArtifactKind, RegExp> = {
  design: /(?:баннер|постер|афиш\w*|макет|креатив(?![\p{L}\p{N}_])|визуал(?![\p{L}\p{N}_])|логотип\w*|открытк\w*|обложк\w*|сторис|banner|poster|flyer|logo|logotype|canvas|social\s+graphic|cover\s+design|postcard|жарнама|дизайн|плакат)/giu,
  table: /(?:таблиц\w*|электронн\w*\s+таблиц\w*|смет\w*|table|spreadsheet|worksheet|xlsx|csv|data\s+grid|деректер\s+кестесі|кесте\s+түрінде)/giu,
  plan: /(?:список\s+задач|задач\w*|план\s+работ|расписан\w*|график\s+работ|календар\w*|таймлайн|task\s+list|tasks?|schedule|work\s+plan|roadmap|timeline|calendar|тапсырм\w*|жоспар|күнтізбе)/giu,
  document: /(?:документ\w*|отч[её]т\w*|письм\w*|меморандум|протокол|стать[яю]|текстов\w*\s+документ\w*|document|report|letter|memo|article|written\s+brief|text\s+document|құжат|баяндама|хат|мәтіндік\s+құжат)/giu,
};
const requestVerb = /(?:сделай|создай|подготовь|составь|оформи|разработай|нарисуй|напиши|построй|сформируй|хочу|нуж(?:ен|на|но)|create|make|prepare|write|design|draw|build|want|need|жаса|құр|дайында|әзірле)/giu;
const requestTailBoundary = /(?:[;:]|["«“]|\s+(?:from|using|based\s+on|titled|called|containing|about|for|with|without|but\s+not|and\s+no|на\s+основе|по\s+данным|под\s+названием|из|для|о|с|без|но\s+не)\s+)/iu;

/** Extract only the direct object of affirmative authoring verbs; later source/copy nouns are evidence, not deliverables. */
function requestedClauses(goal: string) {
  const matches = [...goal.matchAll(requestVerb)], clauses: string[] = [];
  for (const [index, match] of matches.entries()) {
    const before = goal.slice(Math.max(0, match.index! - 20), match.index!).toLocaleLowerCase('und');
    if (/(?:не|dont|don't|do\s+not|not|емес)\s*$/.test(before)) continue;
    const end = match.index! + match[0].length, next = matches[index + 1]?.index ?? goal.length;
    let candidate = goal.slice(end, next).trim();
    if (!candidate) candidate = goal.slice(matches[index - 1]?.index === undefined ? 0 : matches[index - 1]!.index! + matches[index - 1]![0].length, match.index).trim();
    const boundary = candidate.search(requestTailBoundary);
    if (boundary >= 0) candidate = candidate.slice(0, boundary);
    if (candidate.trim()) clauses.push(candidate.trim());
  }
  return clauses;
}

/** Deterministic safety floor for explicit deliverables; the detailed procedure and typed tools remain the semantic router. */
export function requiredArtifactKindsForGoal(goal: string, hasCurrentArtifact = false): ArtifactKind[] {
  if (hasCurrentArtifact) return [];
  const clauses = requestedClauses(goal.normalize('NFKC').replace(/\s+/g, ' ').trim());
  return (['design', 'table', 'plan', 'document'] as const).filter((kind) => {
    const pattern = artifactIntentTokens[kind];
    return clauses.some((clause) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(clause));
  });
}
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
  requiredArtifactKinds: z.array(ArtifactKindSchema).max(4).default([]),
  executionAuthority: WorkExecutionAuthoritySchema.nullable().default(null),
  businessContextRefs: z.array(BusinessContextSelectionSchema).max(20).default([]),
  sources: z.array(BusinessSourceSchema).max(100),
  sourceRoles: z.array(BusinessSourceRoleAssignmentSchema).max(100).default([]),
  artifacts: z.array(ArtifactExcerptSchema).max(40),
  messages: z.array(MessageSchema).max(60), plan: z.array(z.string().min(1).max(500)).max(10),
  questions: z.array(QuestionSchema).max(10), answers: z.array(AcceptedAnswerSchema).max(40),
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
  return { schema: 1, procedureVersion: BUSINESS_PROCEDURE_VERSION, goal: input.goal, locale: input.locale, inputRefs: input.inputRefs, currentArtifact: null, requiredArtifactKinds: requiredArtifactKindsForGoal(input.goal), executionAuthority: null, businessContextRefs: [], sources: [], sourceRoles: [], artifacts: [], messages: [], plan: [], questions: [], answers: [], operations: [], planProposals: [], datasets: [], decision: null, workDecision: null, workPreview: null, selectedOptionId: null, acceptedConditionIds: [], bundle: null, results: [], summary: '', round: 0 };
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
    { role: 'user', content: JSON.stringify({ goal: state.goal, requiredArtifactKinds: state.requiredArtifactKinds, answers: state.answers, plan: state.plan, currentArtifact: state.currentArtifact, selectedOptionId: state.selectedOptionId, acceptedConditionIds: state.acceptedConditionIds, selectedInputs: state.inputRefs, sources: evidence, datasets: state.datasets, artifacts: state.artifacts, planProposals: state.planProposals, operations: state.operations, decision: state.decision, workDecision: state.workDecision, workPreview: state.workPreview, bundle: state.bundle, savedResults: state.results, recentActions }) },
  ];
}
