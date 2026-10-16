import { describe, expect, it } from 'vitest';

import { validateCreativeProposal } from '@/features/creative-ai/domain/validate-proposal';
import { creativeProposalCases, evaluateCreativeCase } from '../../evals/creative-ai/proposal-cases';

const copy = [
  { locale: 'ru' as const, headline: 'Условия для вашего проекта', body: 'Цена и дата указаны в макете.', callToAction: 'Узнать подробнее' },
  { locale: 'kk' as const, headline: 'Жобаңызға арналған шарттар', body: 'Баға мен күн макетте көрсетілген.', callToAction: 'Толығырақ білу' },
  { locale: 'en' as const, headline: 'Terms for your project', body: 'The price and date are shown in the design.', callToAction: 'Learn more' },
];

describe('creative proposal evidence gate', () => {
  it('accepts multilingual composition choices only when every claim closes over authorized facts', () => {
    const result = validateCreativeProposal({ schemaVersion: 1, variants: [
      { id: 'editorial', name: 'Editorial', composition: 'editorial-focus', rationale: 'Lead with the offer.', copy, claims: [{ id: 'price-claim', text: '12 000 ₸', conditionIds: ['price'] }], imageRole: 'hero', warnings: [] },
      { id: 'split', name: 'Split', composition: 'split-proof', rationale: 'Separate message and terms.', copy, claims: [{ id: 'date-claim', text: '2026-11-01', conditionIds: ['date'] }], imageRole: 'supporting', warnings: [] },
    ] }, { conditionIds: ['price', 'date'], locales: ['ru', 'kk', 'en'], hasUsableImage: true });
    expect(result.findings).toEqual([]);
    expect(result.readyVariantIds).toEqual(['editorial', 'split']);
  });

  it('blocks invented facts and missing translations while retaining an image-free fallback', () => {
    const result = validateCreativeProposal({ schemaVersion: 1, variants: [
      { id: 'editorial', name: 'Editorial', composition: 'editorial-focus', rationale: 'Lead.', copy: copy.slice(0, 2), claims: [{ id: 'uplift', text: '+30% sales', conditionIds: ['invented'] }], imageRole: 'hero', warnings: [] },
      { id: 'split', name: 'Split', composition: 'split-proof', rationale: 'Split.', copy, claims: [], imageRole: 'none', warnings: ['No image supplied'] },
    ] }, { conditionIds: ['price'], locales: ['ru', 'kk', 'en'], hasUsableImage: false });
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining(['claim-without-evidence', 'locale-missing', 'image-unavailable']));
    expect(result.readyVariantIds).toEqual(['split']);
  });

  it('passes the grounded campaign evaluation cases and rejects copied translations', () => {
    for (const testCase of creativeProposalCases) expect(evaluateCreativeCase(testCase), testCase.name).toMatchObject({ passed: true, readyVariantIds: testCase.expectedReadyVariantIds });
  });
});

