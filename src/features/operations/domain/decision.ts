import { z } from 'zod';
import { SourceRefSchema, type SourceRef } from '@/contracts/artifacts';
import { ArtifactContentSchema } from '@/features/artifacts/domain/content-models';
import type { AvailabilityVersion, CapacityAssessment } from '../contracts';
import { assessPlanCapacity } from './capacity';
import { canonicalAssignments, validateOperationalPlan, type OperationalPlanContent } from './model';
import { zonedParts } from './time';

const EvidenceMessageSchema = z.strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(1000),
  sourceRefs: z.array(SourceRefSchema).max(1000),
});

const PlanContentSchema = z.custom<OperationalPlanContent>((value) => {
  const parsed = ArtifactContentSchema.safeParse(value);
  return parsed.success && parsed.data.kind === 'plan';
}, 'A canonical plan artifact is required.');

export const DeliveryDateDecisionSchema = z.strictObject({
  verdict: z.enum(['can-meet', 'can-meet-with-conditions', 'cannot-confirm', 'cannot-meet']),
  requestedDate: z.iso.date(),
  openingDate: z.iso.date().nullable(),
  reasons: z.array(EvidenceMessageSchema).max(1000),
  conditions: z.array(EvidenceMessageSchema).max(1000),
  alternatives: z.array(EvidenceMessageSchema.extend({
    entryIds: z.array(z.string().min(1).max(128)).max(1000),
    suggestedDate: z.iso.date().optional(),
  })).max(1000),
  capacity: z.array(z.strictObject({
    scope: z.string().min(1).max(80),
    requiredMinutes: z.number().finite().nonnegative().nullable(),
    availableMinutes: z.number().finite().nonnegative().nullable(),
    evidence: z.discriminatedUnion('origin', [
      z.strictObject({ origin: z.literal('manual'), resourceId: z.uuid(), availabilityVersionId: z.uuid(), verifiedAt: z.iso.datetime().nullable(), sourceRefs: z.tuple([]) }),
      z.strictObject({ origin: z.literal('source'), resourceId: z.uuid(), availabilityVersionId: z.uuid(), verifiedAt: z.iso.datetime(), sourceRefs: z.array(SourceRefSchema).min(1).max(100) }),
      z.strictObject({ origin: z.literal('missing'), resourceId: z.uuid(), availabilityVersionId: z.null(), verifiedAt: z.null(), sourceRefs: z.tuple([]) }),
    ]),
  })).max(20000),
  planDraft: z.strictObject({
    title: z.string().trim().min(1).max(240),
    content: PlanContentSchema,
    sourceRefs: z.array(SourceRefSchema).max(1000),
  }).nullable(),
});

export type DeliveryDateDecision = z.infer<typeof DeliveryDateDecisionSchema>;

export function latestActiveCompletionDate(plan: OperationalPlanContent) {
  const dates = plan.entries.filter((entry) => entry.status !== 'cancelled').flatMap((entry) => entry.endDate ? [entry.endDate] : entry.endAt ? [zonedParts(entry.endAt, plan.timezone).date] : []);
  return dates.length ? dates.sort().at(-1)! : null;
}

const copy = {
  ru: {
    empty: 'В рабочем плане нет задач, поэтому срок подтвердить нельзя.', afterOpening: 'Запрошенная дата раньше даты открытия.', afterDeadline: 'Одна или несколько задач заканчиваются после запрошенной даты.', conflict: 'Известная доступность не покрывает назначенную работу.', unknown: 'Для части работы не хватает расписания, трудоёмкости, назначения или подтверждённой доступности.', scoped: 'Проверка охватывает только сохранённую в Tirlik доступность и не бронирует время во внешних системах.', openingUnknown: 'Дата открытия не указана, поэтому проверено только попадание в запрошенный срок.', provideAvailability: 'Добавьте или подтвердите доступность назначенного ресурса.', assignResource: 'Назначьте ресурс и укажите его трудоёмкость.', addSchedule: 'Укажите дату, длительность и трудоёмкость задачи.', moveEntry: 'Перенесите затронутую задачу или измените условие срока.', changeDeadline: 'Согласуйте дату не раньше открытия только как явное изменение условия.',
  },
  kk: {
    empty: 'Жұмыс жоспарында тапсырмалар жоқ, сондықтан мерзімді растау мүмкін емес.', afterOpening: 'Сұралған күн ашылу күнінен ерте.', afterDeadline: 'Бір немесе бірнеше тапсырма сұралған күннен кейін аяқталады.', conflict: 'Белгілі қолжетімділік тағайындалған жұмысты өтемейді.', unknown: 'Жұмыстың бір бөлігі үшін кесте, еңбек көлемі, орындаушы немесе расталған қолжетімділік жетіспейді.', scoped: 'Тексеру тек Tirlik ішінде сақталған қолжетімділікті қамтиды және сыртқы жүйелерде уақытты брондамайды.', openingUnknown: 'Ашылу күні көрсетілмеген, сондықтан тек сұралған мерзім тексерілді.', provideAvailability: 'Тағайындалған ресурстың қолжетімділігін қосыңыз немесе растаңыз.', assignResource: 'Ресурсты тағайындап, оның еңбек көлемін көрсетіңіз.', addSchedule: 'Тапсырманың күнін, ұзақтығын және еңбек көлемін көрсетіңіз.', moveEntry: 'Тапсырманы ауыстырыңыз немесе мерзім шартын өзгертіңіз.', changeDeadline: 'Ашылудан ерте емес күнді шарттың анық өзгерісі ретінде ғана келісіңіз.',
  },
  en: {
    empty: 'The work plan has no tasks, so the date cannot be confirmed.', afterOpening: 'The requested date is before the opening date.', afterDeadline: 'One or more tasks finish after the requested date.', conflict: 'Known availability does not cover the assigned work.', unknown: 'Some work is missing a schedule, effort, assignment, or confirmed availability.', scoped: 'The check covers only availability saved in Tirlik and does not reserve time in external systems.', openingUnknown: 'No opening date was supplied, so only the requested deadline was checked.', provideAvailability: 'Add or confirm availability for the assigned resource.', assignResource: 'Assign a resource and enter its effort.', addSchedule: 'Enter the task date, duration, and effort.', moveEntry: 'Move the affected task or change the deadline condition.', changeDeadline: 'Agree a date no earlier than opening only as an explicit change of terms.',
  },
} as const;

/**
 * Deterministic J1/J4 decision boundary. It reports only what can be proven
 * from the pinned plan and immutable availability versions.
 */
export function assessDeliveryDate(input: {
  title: string;
  plan: OperationalPlanContent;
  requestedDate: string;
  openingDate: string | null;
  locale: keyof typeof copy;
  resources: Parameters<typeof assessPlanCapacity>[0]['resources'];
  availabilityVersions: readonly AvailabilityVersion[];
}): DeliveryDateDecision {
  const t = copy[input.locale], plan = validateOperationalPlan(input.plan);
  const assessments = assessPlanCapacity({ plan, resources: input.resources, availabilityVersions: input.availabilityVersions });
  const versions = new Map(input.availabilityVersions.map((version) => [version.id, version]));
  const reasons: DeliveryDateDecision['reasons'] = [], conditions: DeliveryDateDecision['conditions'] = [], alternatives: DeliveryDateDecision['alternatives'] = [];
  if (!plan.entries.length) reasons.push(message('plan-empty', t.empty));
  if (input.openingDate && input.requestedDate < input.openingDate) {
    reasons.push(message('requested-before-opening', t.afterOpening));
    alternatives.push({ ...message('change-requested-date', t.changeDeadline), entryIds: [], suggestedDate: input.openingDate });
  }
  const afterDeadline = plan.entries.filter((entry) => {
    if (entry.status === 'cancelled') return false;
    if (entry.endDate) return entry.endDate > input.requestedDate;
    if (entry.endAt) return zonedParts(entry.endAt, plan.timezone).date > input.requestedDate;
    return false;
  });
  if (afterDeadline.length) {
    reasons.push(message('scheduled-after-requested-date', t.afterDeadline, refsForEntries(plan, afterDeadline.map((entry) => entry.id))));
    alternatives.push({ ...message('move-entry', t.moveEntry, refsForEntries(plan, afterDeadline.map((entry) => entry.id))), entryIds: afterDeadline.map((entry) => entry.id) });
  }
  const conflicts = assessments.filter((assessment) => assessment.status === 'conflict');
  const unknowns = assessments.filter((assessment) => assessment.status === 'availability-unknown');
  const evidenceUnknowns = assessments.filter((assessment) => capacityEvidence(assessment, versions).origin === 'missing');
  if (conflicts.length) {
    reasons.push(message('capacity-conflict', t.conflict, refsForAssessments(plan, conflicts, versions)));
    alternatives.push({ ...message('move-entry', t.moveEntry, refsForAssessments(plan, conflicts, versions)), entryIds: [...new Set(conflicts.flatMap((assessment) => assessment.affectedEntryIds))] });
  }
  if (unknowns.length || evidenceUnknowns.length || plan.entries.some((entry) => entry.status !== 'cancelled' && canonicalAssignments(entry).length === 0)) {
    const unknownEntryIds = [...new Set([
      ...unknowns.flatMap((assessment) => assessment.affectedEntryIds),
      ...evidenceUnknowns.flatMap((assessment) => assessment.affectedEntryIds),
      ...plan.entries.filter((entry) => entry.status !== 'cancelled' && canonicalAssignments(entry).length === 0).map((entry) => entry.id),
    ])];
    reasons.push(message('availability-unknown', t.unknown, refsForEntries(plan, unknownEntryIds)));
    const missingAssignment = unknownEntryIds.filter((id) => canonicalAssignments(plan.entries.find((entry) => entry.id === id)!).length === 0);
    if (missingAssignment.length) alternatives.push({ ...message('assign-resource', t.assignResource, refsForEntries(plan, missingAssignment)), entryIds: missingAssignment });
    const missingAvailability = unknowns.flatMap((assessment) => assessment.reasons.includes('availability-version-missing') ? assessment.affectedEntryIds : []);
    if (missingAvailability.length) alternatives.push({ ...message('provide-availability', t.provideAvailability, refsForEntries(plan, missingAvailability)), entryIds: [...new Set(missingAvailability)] });
    const missingSchedule = unknowns.flatMap((assessment) => assessment.reasons.some((reason) => ['schedule-missing', 'duration-missing', 'effort-missing'].includes(reason)) ? assessment.affectedEntryIds : []);
    if (missingSchedule.length) alternatives.push({ ...message('add-schedule', t.addSchedule, refsForEntries(plan, missingSchedule)), entryIds: [...new Set(missingSchedule)] });
  }
  if (!input.openingDate) conditions.push(message('opening-date-unknown', t.openingUnknown));
  if (assessments.some((assessment) => assessment.status === 'within-known-capacity')) conditions.push(message('known-scope-only', t.scoped, refsForAssessments(plan, assessments, versions)));
  const explicitFailure = reasons.some((reason) => ['requested-before-opening', 'scheduled-after-requested-date', 'capacity-conflict'].includes(reason.code));
  const incomplete = reasons.some((reason) => ['plan-empty', 'availability-unknown'].includes(reason.code));
  const verdict: DeliveryDateDecision['verdict'] = explicitFailure ? 'cannot-meet' : incomplete ? 'cannot-confirm' : conditions.length ? 'can-meet-with-conditions' : 'can-meet';
  const sourceRefs = uniqueRefs(plan.entries.flatMap((entry) => entry.sourceRefs ?? []));
  return DeliveryDateDecisionSchema.parse({
    verdict, requestedDate: input.requestedDate, openingDate: input.openingDate,
    reasons: uniqueMessages(reasons), conditions: uniqueMessages(conditions), alternatives: uniqueAlternatives(alternatives),
    capacity: assessments.map((assessment) => ({
      scope: assessment.scope,
      requiredMinutes: assessment.demandedMinutes ?? null,
      availableMinutes: assessment.availableMinutes ?? null,
      evidence: capacityEvidence(assessment, versions),
    })),
    planDraft: { title: input.title, content: plan, sourceRefs },
  });
}

function message(code: string, text: string, sourceRefs: SourceRef[] = []) { return { code, message: text, sourceRefs }; }
function refsForEntries(plan: OperationalPlanContent, entryIds: readonly string[]) {
  const ids = new Set(entryIds);
  return uniqueRefs(plan.entries.filter((entry) => ids.has(entry.id)).flatMap((entry) => entry.sourceRefs ?? []));
}
function refsForAssessments(plan: OperationalPlanContent, assessments: readonly CapacityAssessment[], versions: ReadonlyMap<string, AvailabilityVersion>) {
  return uniqueRefs([
    ...refsForEntries(plan, assessments.flatMap((assessment) => assessment.affectedEntryIds)),
    ...assessments.flatMap((assessment) => assessment.availabilityVersionId ? versions.get(assessment.availabilityVersionId)?.sourceRefs ?? [] : []),
  ]);
}
function capacityEvidence(assessment: CapacityAssessment, versions: ReadonlyMap<string, AvailabilityVersion>) {
  const version = assessment.availabilityVersionId ? versions.get(assessment.availabilityVersionId) : undefined;
  if (!version || version.resourceId !== assessment.resourceId) return { origin: 'missing' as const, resourceId: assessment.resourceId, availabilityVersionId: null, verifiedAt: null, sourceRefs: [] as [] };
  if (version.sourceRefs.length) {
    if (!version.verifiedAt) return { origin: 'missing' as const, resourceId: assessment.resourceId, availabilityVersionId: null, verifiedAt: null, sourceRefs: [] as [] };
    return { origin: 'source' as const, resourceId: assessment.resourceId, availabilityVersionId: version.id, verifiedAt: version.verifiedAt, sourceRefs: version.sourceRefs.slice(0, 100) };
  }
  return { origin: 'manual' as const, resourceId: assessment.resourceId, availabilityVersionId: version.id, verifiedAt: version.verifiedAt, sourceRefs: [] as [] };
}
function uniqueRefs(refs: readonly SourceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => { const key = JSON.stringify(ref); if (seen.has(key)) return false; seen.add(key); return true; }).map((ref) => structuredClone(ref));
}
function uniqueMessages<T extends { code: string; sourceRefs: SourceRef[] }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const key = `${item.code}:${JSON.stringify(item.sourceRefs)}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function uniqueAlternatives(items: readonly DeliveryDateDecision['alternatives'][number][]) {
  const seen = new Set<string>();
  return items.filter((item) => { const key = `${item.code}:${[...item.entryIds].sort().join(',')}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
