import { z } from 'zod';
import { ChangeSetSchema } from '../../contracts/dependencies';
import { IdSchema } from '../../contracts/primitives';

export const ChangeSetListInputSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema,
  after: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const ChangeSetListResultSchema = z.strictObject({
  changesets: z.array(ChangeSetSchema).max(50),
  nextAfter: z.string().nullable(),
  authzVersion: z.number().int().positive(),
});

export type ChangeSetListInput = z.infer<typeof ChangeSetListInputSchema>;
export type ChangeSetListResult = z.infer<typeof ChangeSetListResultSchema>;
