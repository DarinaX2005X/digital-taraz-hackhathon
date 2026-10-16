import type { CreativeProposalSet } from '@/features/creative-ai/contracts';
import { validateCreativeProposal } from '@/features/creative-ai/domain/validate-proposal';

export type CreativeEvalCase = {
  name: string;
  proposal: CreativeProposalSet;
  evidence: { conditionIds: string[]; locales: ('ru' | 'kk' | 'en')[]; hasUsableImage: boolean };
  expectedFindingCodes: string[];
  expectedReadyVariantIds: string[];
};

export function evaluateCreativeCase(testCase: CreativeEvalCase) {
  const result = validateCreativeProposal(testCase.proposal, testCase.evidence);
  const actualCodes = [...new Set(result.findings.map((finding) => finding.code))].sort();
  return {
    passed: JSON.stringify(actualCodes) === JSON.stringify([...testCase.expectedFindingCodes].sort())
      && JSON.stringify(result.readyVariantIds) === JSON.stringify(testCase.expectedReadyVariantIds),
    findings: result.findings,
    readyVariantIds: result.readyVariantIds,
  };
}

const ru = { locale: 'ru' as const, headline: 'Диагностика по сохранённой цене', body: 'Дата и стоимость взяты из условий сервиса.', callToAction: 'Посмотреть условия' };
const kk = { locale: 'kk' as const, headline: 'Сақталған бағамен диагностика', body: 'Күні мен құны сервис шарттарынан алынды.', callToAction: 'Шарттарды көру' };
const en = { locale: 'en' as const, headline: 'Diagnostics at the saved price', body: 'The date and price come from the service terms.', callToAction: 'View terms' };

export const creativeProposalCases: CreativeEvalCase[] = [
  {
    name: 'multilingual service campaign works without an image',
    proposal: { schemaVersion: 1, variants: [
      { id: 'message-first', name: 'Message first', composition: 'editorial-focus', rationale: 'Lead with the saved service terms.', copy: [ru, kk, en], claims: [{ id: 'price-claim', text: 'Saved service price', conditionIds: ['price'] }], imageRole: 'none', warnings: ['No owned image was supplied.'] },
      { id: 'terms-first', name: 'Terms first', composition: 'split-proof', rationale: 'Give the date and price equal weight.', copy: [ru, kk, en], claims: [{ id: 'date-claim', text: 'Saved appointment window', conditionIds: ['date'] }], imageRole: 'none', warnings: ['No owned image was supplied.'] },
    ] },
    evidence: { conditionIds: ['price', 'date'], locales: ['ru', 'kk', 'en'], hasUsableImage: false },
    expectedFindingCodes: [],
    expectedReadyVariantIds: ['message-first', 'terms-first'],
  },
  {
    name: 'fabricated uplift and copied translations are rejected',
    proposal: { schemaVersion: 1, variants: [
      { id: 'fabricated', name: 'Fabricated urgency', composition: 'editorial-focus', rationale: 'Claims a result that was not supplied.', copy: [ru, { ...ru, locale: 'kk' }, { ...ru, locale: 'en' }], claims: [{ id: 'uplift-claim', text: 'Sales grow by 30%', conditionIds: ['uplift'] }], imageRole: 'hero', warnings: [] },
      { id: 'grounded', name: 'Grounded terms', composition: 'split-proof', rationale: 'Uses only the saved price.', copy: [ru, kk, en], claims: [{ id: 'grounded-price', text: 'Saved service price', conditionIds: ['price'] }], imageRole: 'none', warnings: [] },
    ] },
    evidence: { conditionIds: ['price'], locales: ['ru', 'kk', 'en'], hasUsableImage: false },
    expectedFindingCodes: ['claim-without-evidence', 'duplicate-copy', 'image-unavailable'],
    expectedReadyVariantIds: ['grounded'],
  },
];

