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
import { readPinnedSource } from '@/features/sources/server/pinned-source';
import { CreateAiPlanSchema, buildAiPlan } from '../ai-plan';
import { assessDeliveryDate, latestActiveCompletionDate } from '../domain/decision';
import { validateOperationalPlan, type OperationalPlanContent, type OperationalPlanEntry } from '../domain/model';
import {
  ProposeWorkPlanInputSchema,
  ProposeWorkPlanResultSchema,
  proposeWorkPlan,
  type ProposeWorkPlanResult,
} from '../domain/propose-work-plan';
import { loadPlanCapacityContextInTransaction, readPlanResourceSnapshotsInTransaction } from './service';

const ResultSchema = z.strictObject({ results: z.array(RunResultRefSchema).length(1) });
const ProposeBusinessPlanSchema = z.strictObject({
  proposalId: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(240),
  input: ProposeWorkPlanInputSchema,
});
const PlanProposalReceiptSchema = ProposeWorkPlanResultSchema.omit({ candidate: true }).extend({
  proposalId: ProposeBusinessPlanSchema.shape.proposalId,
  title: ProposeBusinessPlanSchema.shape.title,
});

export const operationsBusinessToolExtension: BusinessToolExtension = (services) => operationsBusinessTools(services);

/** Typed local tools used by the visible J1 assistant procedure. */
export function operationsBusinessTools(services: BusinessToolServices): readonly BusinessToolDefinition[] {
  return [
    {
      name: 'propose_work_plan',
      description: 'Construct a checked candidate schedule from a typed plan, immutable resource and availability revisions, locks, dependencies, material-ready facts, and one explicit objective. This deterministic tool may reassign unlocked work when constraints change, preserves locked work, and reports unknown supply dates without inventing them. The candidate is stored under proposalId for assessment; it does not book resources or mutate an artifact.',
      schema: ProposeBusinessPlanSchema,
      action: 'calculate',
      output: PlanProposalReceiptSchema,
      costClass: 'local',
      effect: async (tx, raw, context, state) => {
        const request = ProposeBusinessPlanSchema.parse(raw);
        if (request.input.plan.entries.length > 200) throw new RunError('invalid_result');
        const result = await withWorkspaceAccessInTransaction(tx, principalFor(context), { workspaceId: context.workspaceId, projectId: context.projectId ?? undefined, scope: 'read' }, async (transaction, access) => {
          if (access.workspace.authz_version !== context.authzVersion) throw new RunError('access_changed', 'FORBIDDEN');
          const refs = new Map<string, (typeof request.input.materialConstraints)[number]['sourceRef']>();
          for (const item of request.input.materialConstraints) refs.set(JSON.stringify(item.sourceRef), item.sourceRef);
          for (const entry of request.input.plan.entries) for (const ref of entry.sourceRefs ?? []) refs.set(JSON.stringify(ref), ref);
          for (const ref of refs.values()) {
            const pinned = await readPinnedSource(transaction, access, { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId });
            if (pinned.sourceRef.revision !== ref.revision || pinned.projectId !== context.projectId) throw new RunError('access_changed', 'NOT_FOUND');
          }
          return proposeWorkPlan(request.input, {
            authorization: { workspaceId: access.workspace.id, actorId: access.userId, authzVersion: access.workspace.authz_version },
            searchLimit: 50_000,
            readResources: async (resourceRefs, authorization) => {
              if (authorization.workspaceId !== access.workspace.id || authorization.actorId !== access.userId || authorization.authzVersion !== access.workspace.authz_version) throw new RunError('access_changed', 'FORBIDDEN');
              return readPlanResourceSnapshotsInTransaction(transaction, access, resourceRefs);
            },
          });
        });
        const proposals = [...state.planProposals.filter((item) => item.id !== request.proposalId), { id: request.proposalId, title: request.title, result }].slice(-5);
        const next = { ...state, planProposals: proposals, operations: state.operations.filter((item) => item.request.planProposalId !== request.proposalId), decision: null, workDecision: null, selectedOptionId: null, acceptedConditionIds: [], bundle: null };
        if (Buffer.byteLength(JSON.stringify(next)) > 180_000) throw new RunError('invalid_result');
        const receipt = {
          status: result.status,
          changedEntryIds: result.changedEntryIds,
          unresolved: result.unresolved,
          conflicts: result.conflicts,
          checkReceipt: result.checkReceipt,
        };
        return { output: { proposalId: request.proposalId, title: request.title, ...receipt }, context: next };
      },
    },
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
        let title: string, plan: OperationalPlanContent, proposal: ProposeWorkPlanResult | null = null;
        if (request.planArtifact) {
          const loaded = await services.readArtifact(tx, context, { artifactId: request.planArtifact.artifactId, revision: request.planArtifact.revision });
          if (loaded.content.kind !== 'plan') throw new RunError('invalid_result');
          title = loaded.artifact.title; plan = validateOperationalPlan(loaded.content);
        } else if (request.planProposalId) {
          const stored = state.planProposals.find((item) => item.id === request.planProposalId);
          if (!stored) throw new RunError('invalid_result');
          title = stored.title; proposal = stored.result; plan = validateOperationalPlan(stored.result.candidate);
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
          const proposalReasons = proposal ? proposalIssues(proposal, state.locale) : [];
          const proposalUnknown = proposal !== null && proposal.status !== 'feasible';
          const verdict = proposalUnknown ? (proposal!.status === 'infeasible' && proposal!.unresolved.length === 0 ? 'cannot-meet' as const : 'cannot-confirm' as const) : core.verdict;
          return OperationsDecisionSchema.parse({
            assessmentId: request.assessmentId,
            optionId: request.optionId,
            request,
            verdict,
            requestedDate: core.requestedDate,
            openingDate: core.openingDate,
            earliestCompletionDate: latestActiveCompletionDate(plan),
            reasons: [...proposalReasons, ...core.reasons.map((reason) => ({ ...reason, sourceRefs: reason.sourceRefs.slice(0, 100), question: reason.code === 'availability-unknown' ? questionFor(state.locale) : null }))].slice(0, 40),
            conditions: proposalUnknown ? [] : core.conditions.map((condition) => ({ ...condition, sourceRefs: condition.sourceRefs.slice(0, 100), question: null })),
            capacity: core.capacity.map((item) => ({ ...item, requiredMinutes: item.requiredMinutes === null ? null : Math.ceil(item.requiredMinutes), availableMinutes: item.availableMinutes === null ? null : Math.floor(item.availableMinutes) })),
            alternatives: core.alternatives.map((alternative) => ({ ...alternative, sourceRefs: alternative.sourceRefs.slice(0, 100), suggestedDate: alternative.suggestedDate ?? null })),
            planDraft: proposalUnknown ? null : core.planDraft,
          });
        });
        return { output, context: { ...state, operations: [...state.operations.filter((item) => item.assessmentId !== output.assessmentId), output] } };
      },
    },
    {
      name: 'create_plan',
      description: 'Save an editable work plan after reading the selected materials. Dates, duration, effort, quantity, status, and source evidence must be explicit. Use responsibleLabel and acceptanceCriteria for requested human-readable public responsibility and acceptance text. A responsible label is descriptive and never creates a resource assignment; missing assignees or availability stay unknown. This tool sends no invitations and makes no booking or purchase.',
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

function proposalIssues(result: ProposeWorkPlanResult, locale: 'ru' | 'kk' | 'en') {
  const text = (code: string) => locale === 'ru' ? `План не подтверждён: ${code}.` : locale === 'kk' ? `Жоспар расталмады: ${code}.` : `The plan is not confirmed: ${code}.`;
  const question = (code: string) => {
    if (code === 'material-date-unknown') return locale === 'ru' ? 'Когда материал будет доступен?' : locale === 'kk' ? 'Материал қашан қолжетімді болады?' : 'When will the material be available?';
    if (['assignment-missing', 'availability-missing', 'resource-missing', 'resource-revision-changed', 'resource-capability-missing', 'locked-assignment-invalid'].includes(code)) return questionFor(locale);
    return null;
  };
  return [
    ...result.unresolved.map((item) => ({ code: item.code, message: text(item.code), sourceRefs: item.sourceRefs.slice(0, 100), question: question(item.code) })),
    ...result.conflicts.map((item) => ({ code: item.code, message: text(item.code), sourceRefs: item.sourceRefs.slice(0, 100), question: null })),
  ];
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
    locale: state.locale,
    sources: state.sources.map((source) => ({
      sourceRef: source.sourceRef,
      fragments: source.fragments.map((fragment) => ({ id: fragment.id, evidenceText: [fragment.text, fragment.values ? JSON.stringify(fragment.values) : undefined, fragment.formulas ? JSON.stringify(fragment.formulas) : undefined].filter(Boolean).join('\n') })),
    })),
    linkedArtifactIds: [...state.artifacts.map((artifact) => artifact.artifactId), ...state.results.flatMap((result) => result.kind === 'artifact' ? [result.id] : [])],
    makeId: randomUUID,
  };
}
