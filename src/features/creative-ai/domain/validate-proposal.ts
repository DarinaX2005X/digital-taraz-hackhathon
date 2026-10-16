import {
  CreativeEvidenceSchema,
  CreativeProposalSetSchema,
  type CreativeEvidence,
  type CreativeProposalSet,
} from '../contracts';

export type CreativeProposalFinding = {
  code: 'claim-without-evidence' | 'locale-missing' | 'locale-unexpected' | 'image-unavailable' | 'duplicate-copy';
  variantId: string;
  targetIds: string[];
};

/**
 * The model may propose language and composition, but it cannot create a
 * business fact. Every factual claim is therefore closed over exact condition
 * IDs that were authorized by the caller.
 */
export function validateCreativeProposal(raw: unknown, rawEvidence: CreativeEvidence): {
  proposal: CreativeProposalSet;
  findings: CreativeProposalFinding[];
  readyVariantIds: string[];
} {
  const proposal = CreativeProposalSetSchema.parse(raw);
  const evidence = CreativeEvidenceSchema.parse(rawEvidence);
  const allowedConditions = new Set(evidence.conditionIds);
  const expectedLocales = new Set(evidence.locales);
  const findings: CreativeProposalFinding[] = [];

  for (const variant of proposal.variants) {
    for (const claim of variant.claims) {
      const unknown = claim.conditionIds.filter((id) => !allowedConditions.has(id));
      if (unknown.length) findings.push({ code: 'claim-without-evidence', variantId: variant.id, targetIds: [claim.id, ...unknown] });
    }
    const present = new Set(variant.copy.map((item) => item.locale));
    const missing = [...expectedLocales].filter((locale) => !present.has(locale));
    const unexpected = [...present].filter((locale) => !expectedLocales.has(locale));
    if (missing.length) findings.push({ code: 'locale-missing', variantId: variant.id, targetIds: missing });
    if (unexpected.length) findings.push({ code: 'locale-unexpected', variantId: variant.id, targetIds: unexpected });
    if (variant.imageRole !== 'none' && !evidence.hasUsableImage) findings.push({ code: 'image-unavailable', variantId: variant.id, targetIds: [] });
    const normalized = variant.copy.map((item) => `${item.headline.normalize('NFKC').toLocaleLowerCase('und')}:${item.body.normalize('NFKC').toLocaleLowerCase('und')}`);
    if (new Set(normalized).size !== normalized.length) findings.push({ code: 'duplicate-copy', variantId: variant.id, targetIds: [] });
  }

  const blocked = new Set(findings.filter((item) => item.code !== 'image-unavailable').map((item) => item.variantId));
  return { proposal, findings, readyVariantIds: proposal.variants.map((item) => item.id).filter((id) => !blocked.has(id)) };
}

