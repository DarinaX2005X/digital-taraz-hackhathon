import { describe, expect, it } from 'vitest';
import { J1_PROCEDURE_EVAL_CASES } from '../../evals/agent-tools/j1-procedure';
import { normalizeBusinessToolArguments } from '../../src/features/agent-tools/server/business';
import { requiredArtifactKindsForGoal } from '../../src/features/agent-tools/server/context';
import { BUSINESS_PROCEDURE_VERSION, businessProcedurePrompt } from '../../src/features/agent-tools/server/procedure';

describe('versioned business assistant procedure', () => {
  it('contains the substantive evidence, branching, decision, recovery and completion contracts', () => {
    const prompt = businessProcedurePrompt({ locale: 'en', plan: ['Read evidence', 'Compare options'], currentArtifact: null, requiredArtifactKinds: ['document'], selectedOptionId: null, acceptedConditionIds: [] });
    expect(BUSINESS_PROCEDURE_VERSION).toBe('business-assistant-v1');
    for (const section of ['Evidence precedence and scope', 'Adaptive branches', 'General native authoring loop', 'Commercial decision branch', 'Invariants', 'Unknowns, conflicts and recovery', 'Completion shape']) expect(prompt).toContain(section);
    expect(prompt).toContain('does not enter this branch');
    for (const property of ['Partial/truncated', 'exact commercial evaluation', 'operations assessment', 'selectedOptionId', 'acceptedConditionIds', 'same key', 'estimate, offer and operational plan']) expect(prompt).toContain(property);
    expect(prompt).toContain('use only when the goal needs them');
    expect(prompt).not.toContain('always run every');
    expect(Buffer.byteLength(prompt)).toBeLessThan(8_500);
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

  it('uses an affirmative multilingual format floor without treating sources, negation or unknown visuals as document requests', () => {
    expect(requiredArtifactKindsForGoal('Сделай баннер для осенней акции')).toEqual(['design']);
    expect(requiredArtifactKindsForGoal('Деректер кестесін жаса')).toEqual(['table']);
    expect(requiredArtifactKindsForGoal('Prepare a task schedule for launch')).toEqual(['plan']);
    expect(requiredArtifactKindsForGoal('Write a report about the launch')).toEqual(['document']);
    expect(requiredArtifactKindsForGoal('Сделай баннер и таблицу с ценами')).toEqual(['design', 'table']);
    expect(requiredArtifactKindsForGoal('Сделай таблицу на основе письма клиента')).toEqual(['table']);
    expect(requiredArtifactKindsForGoal('Не нужен документ, сделай баннер')).toEqual(['design']);
    expect(requiredArtifactKindsForGoal('Нарисуй логотип для мастерской')).toEqual(['design']);
    expect(requiredArtifactKindsForGoal('Create a table; do not create a document')).toEqual(['table']);
    expect(requiredArtifactKindsForGoal('Напиши креативное письмо клиенту')).toEqual(['document']);
    expect(requiredArtifactKindsForGoal('Create a report from the attached table')).toEqual(['document']);
    expect(requiredArtifactKindsForGoal('Create a report based on data in a spreadsheet')).toEqual(['document']);
    expect(requiredArtifactKindsForGoal('Сделай баннер с текстом письма')).toEqual(['design']);
    expect(requiredArtifactKindsForGoal('Сделай баннер с заголовком «Список задач»')).toEqual(['design']);
    expect(requiredArtifactKindsForGoal('Change the selected material', true)).toEqual([]);
  });
});
