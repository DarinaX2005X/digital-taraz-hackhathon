import { z } from 'zod';

import { RunInputRefSchema, RunResultRefSchema } from './runs';
import { IdSchema, InstantSchema, LocaleSchema, RevisionSchema } from './primitives';

export const DemoCapabilityTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const DemoExecutionScopeSchema = z.strictObject({
  sessionId: IdSchema,
  expiresAt: InstantSchema,
  revision: RevisionSchema,
  locale: LocaleSchema,
  actorId: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  inputRefs: z.array(RunInputRefSchema).min(1).max(100),
  results: z.array(RunResultRefSchema).max(40),
  runIds: z.array(IdSchema).max(20),
});

export const DemoExecutionCreatedSchema = z.strictObject({
  scope: DemoExecutionScopeSchema,
  capabilityToken: DemoCapabilityTokenSchema,
});

export const DemoExecutionCopySchema = z.strictObject({
  projectId: IdSchema,
  artifacts: z.array(z.strictObject({ id: IdSchema, revision: RevisionSchema })).min(1).max(40),
});

export type DemoExecutionScope = z.infer<typeof DemoExecutionScopeSchema>;
export type DemoExecutionCreated = z.infer<typeof DemoExecutionCreatedSchema>;
export type DemoExecutionCopy = z.infer<typeof DemoExecutionCopySchema>;
