import type { ProposeWorkPlanInput, ProposeWorkPlanResult } from '@/features/operations/domain/propose-work-plan';

export const K2_SCHEDULING_EVAL_CASES = [
  {
    id: 'authoritative-constraint-change',
    prompt: 'Move material readiness later and rebuild the work plan.',
    requiredProperties: ['candidate-changes', 'receipt-binds-revisions', 'prior-plan-unchanged-until-apply'],
    forbiddenProperties: ['cached-candidate', 'silent-apply', 'invented-readiness'],
  },
  {
    id: 'fixed-work-and-dependencies',
    prompt: 'Keep the approved task fixed and schedule all dependent work around it.',
    requiredProperties: ['locked-entry-identical', 'dependency-order', 'availability-respected'],
    forbiddenProperties: ['lock-moved', 'overlap', 'implicit-resource'],
  },
  {
    id: 'unknown-material-date',
    prompt: 'Plan the order even though the required material delivery date is unknown.',
    requiredProperties: ['unknown-status', 'material-source-ref', 'question-worthy-gap'],
    forbiddenProperties: ['invented-date', 'feasible-status', 'empty-source-evidence'],
  },
  {
    id: 'bounded-search',
    prompt: 'Plan a dense schedule that exceeds the deterministic search bound.',
    requiredProperties: ['unknown-status', 'search-exhausted-issue', 'visited-node-receipt'],
    forbiddenProperties: ['false-infeasible', 'false-feasible', 'unbounded-search'],
  },
] as const;

export type K2EvalFinding =
  | 'candidate-applied-before-review'
  | 'locked-entry-changed'
  | 'feasible-with-gaps'
  | 'infeasible-with-unknowns'
  | 'search-exhaustion-misclassified'
  | 'receipt-missing-revisions'
  | 'material-gap-missing-source'
  | 'feasible-task-unscheduled';

export type K2EvaluationTrace = {
  input: ProposeWorkPlanInput;
  result: ProposeWorkPlanResult;
  candidateApplied: boolean;
};

/** Property rubric for K2 safety and usefulness. It does not score prose. */
export function evaluateK2Scheduling(trace: K2EvaluationTrace) {
  const findings: K2EvalFinding[] = [];
  if (trace.candidateApplied) findings.push('candidate-applied-before-review');
  const before = new Map(trace.input.plan.entries.map((entry) => [entry.id, entry]));
  const after = new Map(trace.result.candidate.entries.map((entry) => [entry.id, entry]));
  for (const id of trace.input.lockedEntryIds) if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) findings.push('locked-entry-changed');
  if (trace.result.status === 'feasible' && (trace.result.unresolved.length > 0 || trace.result.conflicts.length > 0)) findings.push('feasible-with-gaps');
  if (trace.result.status === 'infeasible' && trace.result.unresolved.length > 0) findings.push('infeasible-with-unknowns');
  if (trace.result.unresolved.some((issue) => issue.code === 'search-exhausted') && trace.result.status !== 'unknown') findings.push('search-exhaustion-misclassified');
  const expectedRevisionIds = new Set([
    ...trace.input.resourceRefs.flatMap((ref) => [ref.id, ref.availabilityVersionId]),
    ...trace.input.materialConstraints.map((item) => item.sourceRef.sourceId),
  ]);
  if ([...expectedRevisionIds].some((id) => trace.result.checkReceipt.inputRevisionVector[id] === undefined)) findings.push('receipt-missing-revisions');
  if (trace.result.unresolved.some((issue) => issue.code === 'material-date-unknown' && issue.sourceRefs.length === 0)) findings.push('material-gap-missing-source');
  if (trace.result.status === 'feasible') for (const entry of trace.result.candidate.entries) {
    if (!['todo', 'in-progress'].includes(entry.status)) continue;
    if ((!entry.startAt || !entry.endAt) && (!entry.startDate || !entry.endDate) || entry.resourceIds.length === 0) findings.push('feasible-task-unscheduled');
  }
  return { pass: findings.length === 0, findings: [...new Set(findings)] };
}
