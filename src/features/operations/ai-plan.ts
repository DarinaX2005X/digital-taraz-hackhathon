import { z } from 'zod';

import { SourceRefSchema, type SourceRef } from '@/contracts/artifacts';
import { CalendarDateSchema, DecimalStringSchema, IdSchema, InstantSchema } from '@/contracts/primitives';
import { validateOperationalPlan, type OperationalPlanContent, type OperationalPlanEntry } from './domain/model';

const AiPlanSourceEvidenceSchema = z.strictObject({ kind: z.literal('source'), sourceId: IdSchema, fragmentId: IdSchema, detail: z.string().trim().min(1).max(500) });
const AiPlanEvidenceBasisSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('goal'), detail: z.string().trim().min(1).max(500) }),
  AiPlanSourceEvidenceSchema,
  z.strictObject({ kind: z.literal('assumption'), note: z.string().trim().min(1).max(1000) }),
]);
type AiPlanEvidenceBasis = z.infer<typeof AiPlanEvidenceBasisSchema>;

const AiPlanScheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unscheduled') }),
  z.strictObject({ kind: z.literal('date'), startDate: CalendarDateSchema, endDate: CalendarDateSchema, basis: AiPlanEvidenceBasisSchema }),
  z.strictObject({ kind: z.literal('time'), startAt: InstantSchema, endAt: InstantSchema, basis: AiPlanEvidenceBasisSchema }),
]);

const AiPlanTaskSchema = z.strictObject({
  key: z.string().trim().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(1000),
  description: z.string().trim().min(1).max(12000).optional(),
  notes: z.string().trim().min(1).max(12000).optional(),
  status: z.strictObject({ value: z.enum(['todo', 'in-progress', 'done', 'cancelled']), basis: AiPlanEvidenceBasisSchema }).optional(),
  schedule: AiPlanScheduleSchema.default({ kind: 'unscheduled' }),
  duration: z.strictObject({ minutes: z.number().int().min(0).max(10_000_000), basis: AiPlanEvidenceBasisSchema }).optional(),
  effort: z.strictObject({ decimal: DecimalStringSchema, unit: z.enum(['person-minutes', 'person-hours']), basis: AiPlanEvidenceBasisSchema }).optional(),
  quantity: z.strictObject({ decimal: DecimalStringSchema, unit: z.string().trim().min(1).max(40), basis: AiPlanEvidenceBasisSchema }).optional(),
  dependencies: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/)).max(100).default([]),
  checklist: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  linkedArtifactIds: z.array(IdSchema).max(20).default([]),
  evidence: z.array(AiPlanEvidenceBasisSchema).max(20).default([]),
});

/** Strict model-tool input. IDs are logical keys; the application creates canonical stable IDs. */
export const CreateAiPlanSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  timezone: z.string().trim().min(1).max(80).optional(),
  tasks: z.array(AiPlanTaskSchema).min(1).max(200),
}).superRefine((plan, context) => {
  const keys = new Set<string>();
  for (const [index, task] of plan.tasks.entries()) {
    if (keys.has(task.key)) context.addIssue({ code: 'custom', path: ['tasks', index, 'key'], message: 'Task keys must be unique.' });
    keys.add(task.key);
    if (task.schedule.kind === 'date' && task.schedule.endDate < task.schedule.startDate) context.addIssue({ code: 'custom', path: ['tasks', index, 'schedule'], message: 'The date range is reversed.' });
    if (task.schedule.kind === 'time' && Date.parse(task.schedule.endAt) <= Date.parse(task.schedule.startAt)) context.addIssue({ code: 'custom', path: ['tasks', index, 'schedule'], message: 'The time range must have positive length.' });
    if (new Set(task.dependencies).size !== task.dependencies.length || task.dependencies.includes(task.key)) context.addIssue({ code: 'custom', path: ['tasks', index, 'dependencies'], message: 'Dependencies must be unique and may not refer to the task itself.' });
  }
  for (const [index, task] of plan.tasks.entries()) for (const dependency of task.dependencies) if (!keys.has(dependency)) context.addIssue({ code: 'custom', path: ['tasks', index, 'dependencies'], message: `Unknown dependency key: ${dependency}` });
});

export type CreateAiPlan = z.infer<typeof CreateAiPlanSchema>;
export interface AiPlanEvidenceSource { sourceRef: SourceRef; fragments: readonly { id: string; evidenceText: string }[] }
export interface AiPlanBuildContext {
  goal: string;
  defaultTimezone: string;
  sources: readonly AiPlanEvidenceSource[];
  linkedArtifactIds: readonly string[];
  makeId: () => string;
}
export interface BuiltAiPlan { title: string; content: OperationalPlanContent; sourceRefs: SourceRef[] }

/**
 * Converts one typed model call into the same canonical plan model used by the
 * manual editor. Every citation and material link must already be authorized
 * and present in the model's bounded context.
 */
export function buildAiPlan(raw: unknown, context: AiPlanBuildContext): BuiltAiPlan {
  const input = CreateAiPlanSchema.parse(raw);
  assertTimezone(input.timezone ?? context.defaultTimezone);
  const sourceById = new Map(context.sources.map((source) => [source.sourceRef.sourceId, source]));
  const allowedArtifacts = new Set(context.linkedArtifactIds);
  const ids = new Map(input.tasks.map((task) => [task.key, context.makeId()]));
  if (new Set(ids.values()).size !== ids.size) throw new Error('AI_PLAN_ID_COLLISION');
  const planSourceRefs = new Map<string, SourceRef>();

  const entries: OperationalPlanEntry[] = input.tasks.map((task) => {
    const bases = [
      ...task.evidence,
      ...(task.status ? [task.status.basis] : []),
      ...(task.schedule.kind === 'unscheduled' ? [] : [task.schedule.basis]),
      ...(task.duration ? [task.duration.basis] : []),
      ...(task.effort ? [task.effort.basis] : []),
      ...(task.quantity ? [task.quantity.basis] : []),
    ];
    const sourceRefs = evidenceSourceRefs(bases, context.goal, sourceById);
    for (const ref of sourceRefs) planSourceRefs.set(sourceRefKey(ref), ref);
    const assumptions = bases.flatMap((basis) => basis.kind === 'assumption' ? [basis.note] : []);
    if (task.linkedArtifactIds.some((id) => !allowedArtifacts.has(id))) throw new Error('AI_PLAN_ARTIFACT_NOT_IN_CONTEXT');
    const schedule = task.schedule.kind === 'date'
      ? { startDate: task.schedule.startDate, endDate: task.schedule.endDate }
      : task.schedule.kind === 'time'
        ? { startAt: task.schedule.startAt, endAt: task.schedule.endAt }
        : {};
    return {
      id: ids.get(task.key)!, title: task.title, status: task.status?.value ?? 'todo',
      ...(task.description ? { description: task.description } : {}),
      ...(task.notes || assumptions.length ? { notes: [task.notes, ...new Set(assumptions)].filter(Boolean).join('\n') } : {}),
      ...schedule,
      ...(task.duration === undefined ? {} : { durationMinutes: task.duration.minutes }),
      ...(task.effort ? { effort: { decimal: task.effort.decimal, unit: task.effort.unit } } : {}),
      ...(task.quantity ? { quantity: { decimal: task.quantity.decimal, unit: task.quantity.unit } } : {}),
      resourceIds: [], availabilityVersionIds: [], assignments: [],
      dependencies: task.dependencies.map((key) => ids.get(key)!),
      checklist: task.checklist.map((text) => ({ id: context.makeId(), text, done: false })),
      ...(task.linkedArtifactIds.length ? { linkedArtifactIds: [...task.linkedArtifactIds] } : {}),
      ...(sourceRefs.length ? { sourceRefs } : {}),
    };
  });
  const content = validateOperationalPlan({ kind: 'plan', schemaVersion: 1, timezone: input.timezone ?? context.defaultTimezone, entries });
  return { title: input.title, content, sourceRefs: [...planSourceRefs.values()] };
}

function evidenceSourceRefs(bases: readonly AiPlanEvidenceBasis[], goal: string, sources: ReadonlyMap<string, AiPlanEvidenceSource>): SourceRef[] {
  const refs = new Map<string, SourceRef>();
  for (const basis of bases) {
    if (basis.kind === 'assumption') continue;
    if (basis.kind === 'goal') {
      if (!normalized(goal).includes(normalized(basis.detail))) throw new Error('AI_PLAN_GOAL_EVIDENCE_MISMATCH');
      continue;
    }
    const source = sources.get(basis.sourceId), fragment = source?.fragments.find((item) => item.id === basis.fragmentId);
    if (!source || !fragment || !normalized(fragment.evidenceText).includes(normalized(basis.detail))) throw new Error('AI_PLAN_SOURCE_NOT_IN_CONTEXT');
    const ref = SourceRefSchema.parse({ ...source.sourceRef, fragmentId: basis.fragmentId });
    refs.set(sourceRefKey(ref), ref);
  }
  return [...refs.values()];
}

function normalized(value: string) { return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('und'); }

function sourceRefKey(ref: SourceRef) {
  return [ref.sourceId, ref.sourceVersionId, ref.revision, ref.fragmentId ?? '', ref.collectionId ?? '', ref.recordId ?? '', ref.fieldId ?? '', ref.factRevision ?? ''].join(':');
}

function assertTimezone(timezone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw new Error('AI_PLAN_TIMEZONE_INVALID'); }
}
