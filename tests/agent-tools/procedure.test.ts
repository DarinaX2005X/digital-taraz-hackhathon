import { describe, expect, it } from 'vitest';
import { J1_PROCEDURE_EVAL_CASES } from '../../evals/agent-tools/j1-procedure';
import { normalizeBusinessToolArguments } from '../../src/features/agent-tools/server/business';
import { BUSINESS_PROCEDURE_VERSION, businessProcedurePrompt } from '../../src/features/agent-tools/server/procedure';

describe('versioned business assistant procedure', () => {
  it('contains the substantive evidence, branching, decision, recovery and completion contracts', () => {
    const prompt = businessProcedurePrompt({ locale: 'en', plan: ['Read evidence', 'Compare options'], currentArtifact: null, selectedOptionId: null, acceptedConditionIds: [] });
    expect(BUSINESS_PROCEDURE_VERSION).toBe('business-assistant-v1');
    for (const section of ['Evidence precedence and scope', 'Adaptive branches', 'Ordered request-to-decision procedure', 'Invariants', 'Unknowns, conflicts and recovery', 'Completion shape']) expect(prompt).toContain(section);
    for (const property of ['Partial/truncated', 'exact commercial evaluation', 'operations assessment', 'selectedOptionId', 'acceptedConditionIds', 'same key', 'estimate, offer and operational plan']) expect(prompt).toContain(property);
    expect(prompt).toContain('use only when the goal needs them');
    expect(prompt).not.toContain('always run every');
  });

  it('keeps eval cases focused on different necessary work rather than a fixed cast of roles', () => {
    expect(J1_PROCEDURE_EVAL_CASES.map((item) => item.id)).toEqual(['full-request-decision', 'missing-capacity', 'changed-noncommercial-goal']);
    expect(J1_PROCEDURE_EVAL_CASES[2].requiredProperties).toContain('different-tool-path');
    expect(J1_PROCEDURE_EVAL_CASES[2].forbiddenProperties).toContain('fixed-role-chain');
  });

  it('canonicalizes integer strings at the provider read-artifact boundary only', () => {
    expect(normalizeBusinessToolArguments('read_artifact', { artifactId: 'a', revision: '1', offset: '0' })).toEqual({ artifactId: 'a', revision: 1, offset: 0 });
    expect(normalizeBusinessToolArguments('read_artifact', { artifactId: 'a', revision: '01', offset: '-1' })).toEqual({ artifactId: 'a', revision: '01', offset: '-1' });
    expect(normalizeBusinessToolArguments('compare_decision_options', { revision: '1', offset: '0' })).toEqual({ revision: '1', offset: '0' });
  });
});
