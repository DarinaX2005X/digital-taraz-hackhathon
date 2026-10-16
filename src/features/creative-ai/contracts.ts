import { z } from 'zod';

import { ElementIdSchema, LocaleSchema } from '@/contracts/primitives';

export const CreativeCompositionSchema = z.enum(['editorial-focus', 'split-proof', 'product-window']);

const LocalizedCopySchema = z.strictObject({
  locale: LocaleSchema,
  headline: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(420),
  callToAction: z.string().trim().min(1).max(80),
});

export const CreativeClaimSchema = z.strictObject({
  id: ElementIdSchema,
  text: z.string().trim().min(1).max(500),
  conditionIds: z.array(ElementIdSchema).min(1).max(20),
});

export const CreativeVariantProposalSchema = z.strictObject({
  id: ElementIdSchema,
  name: z.string().trim().min(1).max(120),
  composition: CreativeCompositionSchema,
  rationale: z.string().trim().min(1).max(800),
  copy: z.array(LocalizedCopySchema).min(1).max(3),
  claims: z.array(CreativeClaimSchema).max(20),
  imageRole: z.enum(['hero', 'supporting', 'none']),
  warnings: z.array(z.string().trim().min(1).max(400)).max(20),
}).superRefine((value, context) => {
  if (new Set(value.copy.map((item) => item.locale)).size !== value.copy.length) context.addIssue({ code: 'custom', path: ['copy'], message: 'Creative locales must be unique.' });
  if (new Set(value.claims.map((item) => item.id)).size !== value.claims.length) context.addIssue({ code: 'custom', path: ['claims'], message: 'Creative claim IDs must be unique.' });
});

export const CreativeProposalSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  variants: z.array(CreativeVariantProposalSchema).min(2).max(3),
}).superRefine((value, context) => {
  if (new Set(value.variants.map((item) => item.id)).size !== value.variants.length) context.addIssue({ code: 'custom', path: ['variants'], message: 'Creative variant IDs must be unique.' });
});

export const CreativeEvidenceSchema = z.strictObject({
  conditionIds: z.array(ElementIdSchema).max(200),
  locales: z.array(LocaleSchema).min(1).max(3),
  hasUsableImage: z.boolean(),
});

export type CreativeVariantProposal = z.infer<typeof CreativeVariantProposalSchema>;
export type CreativeProposalSet = z.infer<typeof CreativeProposalSetSchema>;
export type CreativeEvidence = z.infer<typeof CreativeEvidenceSchema>;

