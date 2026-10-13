import { z } from 'zod';
import { ArtifactKindSchema } from './artifacts';

export const PermissionSchema = z.enum(['read', 'edit', 'approve', 'export', 'manage-members', 'read-confidential']);
export const CapabilityDescriptorSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  version: z.number().int().positive(),
  policyClass: z.enum(['read', 'mutate', 'export']),
  permissions: z.array(PermissionSchema).min(1),
  artifactKinds: z.array(ArtifactKindSchema),
});

export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

export function createCapabilityRegistry(descriptors: readonly CapabilityDescriptor[]) {
  const entries = new Map<string, Readonly<CapabilityDescriptor>>();
  for (const descriptor of descriptors) {
    const validated = CapabilityDescriptorSchema.parse(descriptor);
    const key = `${validated.id}@${validated.version}`;
    if (entries.has(key)) throw new Error(`Duplicate capability: ${key}`);
    Object.freeze(validated.permissions);
    Object.freeze(validated.artifactKinds);
    entries.set(key, Object.freeze(validated));
  }
  return Object.freeze({
    get: (id: string, version: number) => entries.get(`${id}@${version}`),
    list: () => Array.from(entries.values()),
  });
}
