import { describe, expect, it } from 'vitest';
import { businessDecisionCopy, businessDecisionMessageKeys, decisionFactorMessageKey } from '../../src/features/agent-tools/locales/decision';

describe('safe localized public decision messages', () => {
  it('has exact RU/KK/EN key parity', () => {
    for (const locale of ['ru', 'kk', 'en'] as const) expect(Object.keys(businessDecisionCopy[locale]).sort()).toEqual([...businessDecisionMessageKeys].sort());
  });

  it('maps unknown model codes to a finite fallback without rendering raw text', () => {
    const hostileCode = 'supplier_claim_from_untrusted_text';
    const key = decisionFactorMessageKey('reason', hostileCode);
    expect(key).toBe('business.decision.genericReason');
    for (const locale of ['ru', 'kk', 'en'] as const) expect(businessDecisionCopy[locale][key]).not.toContain(hostileCode);
  });
});
