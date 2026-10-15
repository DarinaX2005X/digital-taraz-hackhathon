import { describe, expect, it } from 'vitest';
import type { BusinessContext } from '../../src/features/agent-tools/server/context';
import { resolveDecisionControls } from '../../src/features/agent-tools/server/business';

const decision = {
  options: [
    { id: 'standard', verdict: 'can-with-conditions' },
    { id: 'accelerated', verdict: 'cannot-confirm' },
  ],
  blockers: [
    { id: 'select_option', optionIds: ['standard'], userResolvable: true },
    { id: 'accept_conditions_standard', optionIds: ['standard'], userResolvable: true },
  ],
} as unknown as NonNullable<BusinessContext['decision']>;

describe('canonical decision controls', () => {
  it('turns a conditional selection into a separate consent step instead of a failed bundle', () => {
    const selected = resolveDecisionControls({ decision, currentSelectedOptionId: null, currentAcceptedConditionIds: [], selectedOptionId: 'standard' });
    expect(selected).toMatchObject({ canonicalSelectedOptionId: 'standard', acceptedConditionIds: [], pendingConsent: 'accept_conditions_standard' });
    const accepted = resolveDecisionControls({ decision, currentSelectedOptionId: 'standard', currentAcceptedConditionIds: [], acceptedConditionIds: ['accept_conditions_standard'] });
    expect(accepted).toMatchObject({ canonicalSelectedOptionId: 'standard', acceptedConditionIds: ['accept_conditions_standard'], pendingConsent: undefined });
  });

  it('rejects unknown option IDs and condition consent for another option', () => {
    expect(() => resolveDecisionControls({ decision, currentSelectedOptionId: null, currentAcceptedConditionIds: [], selectedOptionId: 'missing' })).toThrow();
    expect(() => resolveDecisionControls({ decision, currentSelectedOptionId: 'standard', currentAcceptedConditionIds: [], acceptedConditionIds: ['accept_conditions_accelerated'] })).toThrow();
  });
});
