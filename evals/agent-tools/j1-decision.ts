export type J1DecisionTrace = {
  initialGoal: string;
  revisedGoal?: string;
  initialTools: string[];
  revisedTools?: string[];
  sourceRoles: string[];
  completeCoverage: boolean;
  optionVerdicts: ('can' | 'can-with-conditions' | 'cannot-confirm')[];
  differenceDimensions: string[];
  questionCount: number;
  questionChangesDecision: boolean;
  terminalState: 'waiting_input' | 'review_ready' | 'completed' | 'failed' | 'cancelled';
  artifactKinds: ('table' | 'document' | 'plan' | 'design')[];
  malformedInputAccepted: boolean;
  duplicateEffects: number;
};

export type J1EvalFinding =
  | 'missing-context-role'
  | 'coverage-hidden'
  | 'canned-tool-path'
  | 'options-not-distinct'
  | 'question-not-material'
  | 'question-count'
  | 'missing-decision'
  | 'incomplete-success'
  | 'malformed-accepted'
  | 'duplicate-effect';

const requiredRoles = ['request', 'catalog', 'conditions', 'availability'];

/**
 * Property rubric for the real J1 trace. It intentionally does not score prose,
 * agent count, latency or a generic confidence number.
 */
export function evaluateJ1DecisionTrace(trace: J1DecisionTrace) {
  const findings: J1EvalFinding[] = [];
  if (requiredRoles.some((role) => !trace.sourceRoles.includes(role))) findings.push('missing-context-role');
  if (!trace.completeCoverage) findings.push('coverage-hidden');
  if (trace.revisedGoal && trace.revisedGoal !== trace.initialGoal && trace.revisedTools && JSON.stringify(trace.revisedTools) === JSON.stringify(trace.initialTools)) findings.push('canned-tool-path');
  if (trace.optionVerdicts.length < 2 || !trace.differenceDimensions.length) findings.push('options-not-distinct');
  if (trace.questionCount > 1) findings.push('question-count');
  if (trace.questionCount === 1 && !trace.questionChangesDecision) findings.push('question-not-material');
  if (!trace.optionVerdicts.length) findings.push('missing-decision');
  if (trace.terminalState === 'completed' && !['table', 'document', 'plan'].every((kind) => trace.artifactKinds.includes(kind as 'table' | 'document' | 'plan'))) findings.push('incomplete-success');
  if (trace.malformedInputAccepted) findings.push('malformed-accepted');
  if (trace.duplicateEffects > 0) findings.push('duplicate-effect');
  return { pass: findings.length === 0, findings };
}

