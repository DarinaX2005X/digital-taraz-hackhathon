import { z } from 'zod';
import { DemoExecutionCopySchema } from '@/contracts/demo-execution';
import { IdSchema, InstantSchema, LocaleSchema, RevisionSchema } from '@/contracts/primitives';
import { RunInputRefSchema, RunResultRefSchema, RunSchema } from '@/contracts/runs';

export const DEMO_TTL_HOURS = 24;
export const StartDemoSchema = z.strictObject({ locale: LocaleSchema });
export const DemoStartedSchema = z.strictObject({
  sessionId: IdSchema,
  expiresAt: InstantSchema,
  revision: RevisionSchema,
  locale: LocaleSchema,
  actorId: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  inputRefs: z.array(RunInputRefSchema).min(1).max(100),
});
export const DemoSessionSchema = z.strictObject({
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
export const StartDemoRunSchema = z.strictObject({
  goal: z.string().trim().min(1).max(12000),
  inputRefs: z.array(RunInputRefSchema).min(1).max(100),
  expectedRevision: RevisionSchema,
});
export const DemoRunStartedSchema = z.strictObject({ runId: IdSchema, cursor: z.number().int().nonnegative() });
export const CopyDemoSchema = z.strictObject({
  expectedRevision: RevisionSchema,
  artifactIds: z.array(IdSchema).min(1).max(40).refine((ids) => new Set(ids).size === ids.length),
  destinationWorkspaceId: IdSchema,
});
export const DemoCopiedSchema = DemoExecutionCopySchema;
export const DemoErrorSchema = z.object({
  code: z.string().max(100).optional(),
  message: z.string().max(1000).optional(),
  retryAfterSeconds: z.number().int().positive().max(86400).optional(),
}).passthrough();

export type DemoStarted = z.infer<typeof DemoStartedSchema>;
export type DemoSession = z.infer<typeof DemoSessionSchema>;
export type DemoRun = z.infer<typeof RunSchema>;
export type DemoCopied = z.infer<typeof DemoCopiedSchema>;

