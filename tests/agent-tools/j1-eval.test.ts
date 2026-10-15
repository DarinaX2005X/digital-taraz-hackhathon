import { describe, expect, it } from 'vitest';
import { evaluateJ1DecisionTrace } from '../../evals/agent-tools/j1-decision';

describe('J1 property rubric', () => {
  it('accepts a source-grounded adaptive decision trace with one consequential choice and three editable results', () => {
    expect(evaluateJ1DecisionTrace({
      initialGoal: 'Check the custom request and prepare a reply.', revisedGoal: 'Prepare a meeting memo.',
      initialTools: ['read_sources', 'assess_delivery_date', 'compare_decision_options', 'prepare_decision_bundle'],
      revisedTools: ['read_sources', 'create_document'], sourceRoles: ['request', 'catalog', 'conditions', 'availability'], completeCoverage: true,
      optionVerdicts: ['can', 'can-with-conditions'], differenceDimensions: ['price', 'capacity'], questionCount: 1, questionChangesDecision: true,
      terminalState: 'completed', artifactKinds: ['table', 'document', 'plan'], malformedInputAccepted: false, duplicateEffects: 0,
    })).toEqual({ pass: true, findings: [] });
  });

  it('rejects canned paths, hidden coverage and a false completed offer', () => {
    const result = evaluateJ1DecisionTrace({
      initialGoal: 'A', revisedGoal: 'B', initialTools: ['create_document'], revisedTools: ['create_document'], sourceRoles: ['request'], completeCoverage: false,
      optionVerdicts: ['cannot-confirm'], differenceDimensions: [], questionCount: 2, questionChangesDecision: false,
      terminalState: 'completed', artifactKinds: ['document'], malformedInputAccepted: true, duplicateEffects: 1,
    });
    expect(result.pass).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining(['missing-context-role', 'coverage-hidden', 'canned-tool-path', 'options-not-distinct', 'question-count', 'incomplete-success', 'malformed-accepted', 'duplicate-effect']));
  });
});
