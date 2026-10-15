import { z } from 'zod';
import { SourceRefSchema } from './artifacts';
import { ElementIdSchema, IdSchema } from './primitives';

export const DependencyRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('source'), sourceRef: SourceRefSchema }),
  z.strictObject({ kind: z.literal('artifact'), artifactId: IdSchema, targetElementId: ElementIdSchema }),
]);
export const DependencyTargetSchema = z.strictObject({ artifactId: IdSchema, targetElementId: ElementIdSchema });
export const DependencyTransformSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('copy'), input: ElementIdSchema }),
  z.strictObject({ kind: z.literal('material-format'), input: ElementIdSchema, locale: z.enum(['ru', 'kk', 'en']) }),
  z.strictObject({ kind: z.literal('money-format'), input: ElementIdSchema, currency: z.string().regex(/^[A-Z]{3}$/), locale: z.enum(['ru', 'kk', 'en']), scale: z.number().int().min(0).max(6), basis: z.enum(['major', 'minor']) }),
  z.strictObject({ kind: z.literal('decimal'), operation: z.enum(['sum', 'product']), inputs: z.array(ElementIdSchema).min(1).max(100), scale: z.number().int().min(0).max(6) }),
]);
export const DependencyEdgeSchema = z.strictObject({
  id: IdSchema,
  inputs: z.array(z.strictObject({ key: ElementIdSchema, ref: DependencyRefSchema })).min(1).max(100),
  target: DependencyTargetSchema,
  transform: DependencyTransformSchema,
  updateMode: z.enum(['deterministic', 'propose', 'manual']),
  label: z.string().trim().min(1).max(240),
}).superRefine((edge, ctx) => {
  const keys = new Set(edge.inputs.map((input) => input.key));
  const used = edge.transform.kind === 'decimal' ? edge.transform.inputs : [edge.transform.input];
  if (keys.size !== edge.inputs.length || used.some((key) => !keys.has(key)) || keys.size !== new Set(used).size) ctx.addIssue({ code: 'custom', message: 'Every input must have one unique key used by the transform.' });
});
export type DependencyRef = z.infer<typeof DependencyRefSchema>;
export type DependencyTarget = z.infer<typeof DependencyTargetSchema>;
export type DependencyTransform = z.infer<typeof DependencyTransformSchema>;
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;
