import type { ResumeRun } from '@/contracts/runs';

type DemoCommercialDecision = { options: readonly { id: string; outcome: 'feasible' | 'conditional' | 'not_confirmed' }[] };
type DemoWorkDecision = { options: readonly { id: string }[] };
type DemoDecisionQuestion = { id: string; required: boolean };

export function demoDecisionResumeInput(input: {
  expectedEpoch: number;
  selectedOptionId: string;
  acceptedConditionIds: readonly string[];
  questions: readonly DemoDecisionQuestion[];
  decision?: DemoCommercialDecision | null;
  workDecision?: DemoWorkDecision | null;
}): ResumeRun | null {
  if (!input.selectedOptionId) return null;
  if (input.workDecision) {
    if (!input.workDecision.options.some((option) => option.id === input.selectedOptionId)) return null;
    return { expectedEpoch: input.expectedEpoch, selectedOptionId: input.selectedOptionId };
  }
  if (!input.decision) return null;
  const selected = input.decision.options.find((option) => option.id === input.selectedOptionId);
  if (!selected || selected.outcome === 'not_confirmed') return null;
  const requiredConditionIds = input.questions
    .filter((question) => question.required && question.id === `accept_conditions_${selected.id}`)
    .map((question) => question.id);
  if (requiredConditionIds.some((id) => !input.acceptedConditionIds.includes(id))) return null;
  return { expectedEpoch: input.expectedEpoch, selectedOptionId: selected.id, acceptedConditionIds: requiredConditionIds };
}
