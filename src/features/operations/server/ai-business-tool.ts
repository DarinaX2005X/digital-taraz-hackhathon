import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RunResultRefSchema } from '@/contracts/runs';
import type { BusinessToolDefinition, BusinessToolExtension, BusinessToolServices } from '@/features/agent-tools/server/business';
import { principalFor } from '@/features/agent-tools/server/context';
import {
  OperationsCheckInputSchema,
  OperationsDecisionSchema,
  type OperationsCheckInput,
} from '@/features/commercial/domain/decision';
import { withWorkspaceAccessInTransaction } from '@/features/identity/server/access';
import { RunError } from '@/features/runs/domain/errors';
import { CreateAiPlanSchema, buildAiPlan } from '../ai-plan';
import { assessDeliveryDate, latestActiveCompletionDate } from '../domain/decision';
import { validateOperationalPlan, type OperationalPlanContent, type OperationalPlanEntry } from '../domain/model';
import { loadPlanCapacityContextInTransaction } from './service';

const ResultSchema = z.strictObject({ results: z.array(RunResultRefSchema).length(1) });

export const operationsBusinessToolExtension: BusinessToolExtension = (services) => operationsBusinessTools(services);

/** Typed local tools used by the visible J1 assistant procedure. */
export function operationsBusinessTools(services: BusinessToolServices): readonly BusinessToolDefinition[] {
  return [
    {
      name: 'assess_delivery_date',
      description: 'Check whether a selected or drafted work plan can meet the requested date using only exact dependencies, saved assignments, and immutable availability versions. Expose blocking reasons and explicit alternatives. Never assume a 40-hour week, optimize missing schedules, reserve an external calendar, or invent availability. Use a saved plan when the decision depends on existing assignments.',
      schema: OperationsCheckInputSchema,
      action: 'calculate',
      output: OperationsDecisionSchema,
      costClass: 'local',
      effect: async (tx, raw, context, state) => {
        const request = OperationsCheckInputSchema.parse(raw);
        assertDecisionEvidence(request, state);
        let title: string, plan: OperationalPlanContent;
        if (request.planArtifact) {
          const loaded = await services.readArtifact(tx, context, { artifactId: request.planArtifact.artifactId, revision: request.planArtifact.revision });
          if (loaded.content.kind !== 'plan') throw new RunError('invalid_result');
          title = loaded.artifact.title; plan = validateOperationalPlan(loaded.content);
        } else {
          title = state.locale === 'ru' ? 'План выполнения' : state.locale === 'kk' ? 'Орындау жоспары' : 'Delivery plan';
          plan = decisionDraftPlan(request);
        }
        const output = await withWorkspaceAccessInTransaction(tx, principalFor(context), { workspaceId: context.workspaceId, projectId: context.projectId ?? undefined, scope: 'read' }, async (transaction, access) => {
          let capacity = await loadPlanCapacityContextInTransaction(transaction, access, plan);
          if (!request.planArtifact) {
            plan = pinCurrentAvailability(plan, capacity.resources);
            capacity = await loadPlanCapacityContextInTransaction(transaction, access, plan);
          }
          const core = assessDeliveryDate({ title, plan, requestedDate: request.requestedDate, openingDate: request.openingDate, locale: state.locale, ...capacity });
          return OperationsDecisionSchema.parse({
            assessmentId: request.assessmentId,
            optionId: request.optionId,
            request,
            verdict: core.verdict,
            requestedDate: core.requestedDate,
            openingDate: core.openingDate,
            earliestCompletionDate: latestActiveCompletionDate(plan),
            reasons: core.reasons.map((reason) => ({ ...reason, sourceRefs: reason.sourceRefs.slice(0, 100), question: reason.code === 'availability-unknown' ? questionFor(state.locale) : null })),
            conditions: core.conditions.map((condition) => ({ ...condition, sourceRefs: condition.sourceRefs.slice(0, 100), question: null })),
            capacity: core.capacity.map((item) => ({ ...item, requiredMinutes: item.requiredMinutes === null ? null : Math.ceil(item.requiredMinutes), availableMinutes: item.availableMinutes === null ? null : Math.floor(item.availableMinutes) })),
            alternatives: core.alternatives.map((alternative) => ({ ...alternative, sourceRefs: alternative.sourceRefs.slice(0, 100), suggestedDate: alternative.suggestedDate ?? null })),
            planDraft: core.planDraft,
          });
        });
        return { output, context: { ...state, operations: [...state.operations.filter((item) => item.assessmentId !== output.assessmentId), output] } };
      },
    },
    {
      name: 'create_plan',
      description: 'Save an editable work plan after reading the selected materials. Dates, duration, effort, quantity, status, and source evidence must be explicit. Missing assignees or availability stay unknown. This tool sends no invitations and makes no booking or purchase.',
      schema: CreateAiPlanSchema,
      action: 'save',
      output: ResultSchema,
      costClass: 'local',
      effect: async (tx, raw, context, state) => {
        if (!context.projectId) throw new RunError('invalid_result');
        let built: ReturnType<typeof buildAiPlan>;
        try { built = buildAiPlan(raw, aiContext(state)); }
        catch { throw new RunError('invalid_result'); }
        const saved = await services.saveArtifact(tx, context, { title: built.title, content: built.content, sourceRefs: built.sourceRefs });
        const ref = { kind: 'artifact' as const, id: saved.artifact.id, revision: saved.artifact.currentRevision };
        return { output: { results: [ref] }, resultRefs: [ref], context: { ...state, results: [...state.results, { ...ref, title: saved.artifact.title }] } };
      },
    },
  ];
}

function decisionDraftPlan(request: OperationsCheckInput): OperationalPlanContent {
  if (!request.planDraft) throw new RunError('invalid_result');
  const rawTasks = request.planDraft.tasks;
  const entries: OperationalPlanEntry[] = rawTasks.map((task) => {
    const schedule = task.startDate ? { startDate: task.startDate, endDate: task.endDate! } : { startAt: task.startAt!, endAt: task.endAt! };
    const effortMinutes = task.effortMinutes;
    const assignments = task.resourceIds.map((resourceId) => ({ resourceId, ...(task.resourceIds.length === 1 && effortMinutes !== null ? { effort: { decimal: String(effortMinutes), unit: 'person-minutes' } } : {}) }));
    return {
      id: task.id, title: task.title, status: 'todo', ...schedule,
      resourceIds: [...task.resourceIds], assignments, availabilityVersionIds: [],
      dependencies: [...task.dependencies], checklist: [], durationMinutes: task.durationMinutes ?? undefined,
      ...(effortMinutes === null ? {} : { effort: { decimal: String(effortMinutes), unit: 'person-minutes' } }),
      sourceRefs: [...task.sourceRefs],
    };
  });
  return validateOperationalPlan({ kind: 'plan', schemaVersion: 1, timezone: request.planDraft.timezone, entries });
}

function pinCurrentAvailability(plan: OperationalPlanContent, resources: Awaited<ReturnType<typeof loadPlanCapacityContextInTransaction>>['resources']) {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  return validateOperationalPlan({
    ...plan,
    entries: plan.entries.map((entry) => {
      const assignments = (entry.assignments ?? []).map((assignment) => {
        const resource = byId.get(assignment.resourceId);
        return { ...assignment, ...(resource ? { resourceRevision: resource.revision } : {}), ...(resource?.currentAvailabilityVersionId ? { availabilityVersionId: resource.currentAvailabilityVersionId } : {}) };
      });
      return { ...entry, assignments, availabilityVersionIds: assignments.flatMap((assignment) => assignment.availabilityVersionId ? [assignment.availabilityVersionId] : []) };
    }),
  });
}

function questionFor(locale: 'ru' | 'kk' | 'en') {
  return locale === 'ru' ? 'Кого назначить и какую подтверждённую доступность использовать?' : locale === 'kk' ? 'Кімді тағайындап, қандай расталған қолжетімділікті пайдалану керек?' : 'Who should be assigned, and which confirmed availability should be used?';
}

function assertDecisionEvidence(request: OperationsCheckInput, state: Parameters<BusinessToolDefinition['effect']>[3]) {
  const sourceIds = new Set(state.sources.map((source) => source.sourceRef.sourceId));
  if (request.availabilitySourceIds.some((id) => !sourceIds.has(id))) throw new RunError('invalid_result');
  if ((request.openingDate === null) !== (request.openingDateEvidence === null)) throw new RunError('invalid_result');
  for (const evidence of [request.requestedDateEvidence, request.openingDateEvidence].filter((item) => item !== null)) {
    const raw = normalizeEvidence(evidence.raw);
    if (!raw) throw new RunError('invalid_result');
    if (evidence.origin === 'goal') {
      if (evidence.sourceId || evidence.artifactId || evidence.fragmentId || !containsEvidence([state.goal, ...state.answers.map((answer) => answer.answer)].join('\n'), raw)) throw new RunError('invalid_result');
      continue;
    }
    if (evidence.origin === 'source') {
      if (!evidence.sourceId || evidence.artifactId || !evidence.fragmentId) throw new RunError('invalid_result');
      const source = state.sources.find((item) => item.sourceRef.sourceId === evidence.sourceId);
      const fragment = source?.fragments.find((item) => item.id === evidence.fragmentId);
      const text = fragment ? [fragment.text, fragment.values ? JSON.stringify(fragment.values) : undefined, fragment.formulas ? JSON.stringify(fragment.formulas) : undefined].filter(Boolean).join('\n') : '';
      if (!source || !fragment || !containsEvidence(text, raw)) throw new RunError('invalid_result');
      continue;
    }
    if (!evidence.artifactId || evidence.sourceId || !evidence.fragmentId) throw new RunError('invalid_result');
    const artifact = state.artifacts.find((item) => item.artifactId === evidence.artifactId), target = artifact?.targets.find((item) => item.targetId === evidence.fragmentId);
    if (!artifact || !target || !containsEvidence([target.text, target.formula ?? ''].join('\n'), raw)) throw new RunError('invalid_result');
  }
}

function normalizeEvidence(value: string) { return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('und'); }
function containsEvidence(value: string, normalizedNeedle: string) { return normalizeEvidence(value).includes(normalizedNeedle); }

function aiContext(state: Parameters<BusinessToolDefinition['effect']>[3]) {
  return {
    goal: [state.goal, ...state.answers.map((answer) => answer.answer)].join('\n'),
    defaultTimezone: 'Asia/Qyzylorda',
    sources: state.sources.map((source) => ({
      sourceRef: source.sourceRef,
      fragments: source.fragments.map((fragment) => ({ id: fragment.id, evidenceText: [fragment.text, fragment.values ? JSON.stringify(fragment.values) : undefined, fragment.formulas ? JSON.stringify(fragment.formulas) : undefined].filter(Boolean).join('\n') })),
    })),
    linkedArtifactIds: [...state.artifacts.map((artifact) => artifact.artifactId), ...state.results.flatMap((result) => result.kind === 'artifact' ? [result.id] : [])],
    makeId: randomUUID,
  };
}
