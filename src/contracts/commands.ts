import { z } from 'zod';
import { ArtifactKindSchema } from './artifacts';
import { ElementIdSchema, HashSchema, IdSchema, RevisionSchema } from './primitives';

export const RevisionVectorSchema = z.record(IdSchema, RevisionSchema);
export const CommandOperationSchema = z.strictObject({
  targetId: ElementIdSchema,
  op: z.enum(['set', 'insert', 'remove', 'move', 'style', 'bind', 'unbind', 'lock']),
  value: z.json().optional(),
  beforeHash: HashSchema.nullable(),
}).refine((operation) => operation.op === 'remove' || operation.op === 'unbind' || operation.value !== undefined, {
  message: 'This operation requires a value.',
});

export const CommandInputSchema = z.strictObject({
  commandId: IdSchema,
  artifactId: IdSchema,
  baseRevision: RevisionSchema,
  kind: ArtifactKindSchema,
  operations: z.array(CommandOperationSchema).min(1).max(1000),
  expectedSourceRevisions: RevisionVectorSchema,
  reason: z.string().trim().min(1).max(1000),
});
// Actor and origin are attached by the authenticated application service, never the request body.
export const CommandSchema = CommandInputSchema.extend({
  actorId: IdSchema,
  origin: z.enum(['human', 'ai', 'import']),
});
export const CommandGroupInputSchema = z.strictObject({
  commandGroupId: IdSchema,
  changesetId: IdSchema.optional(),
  expectedArtifactRevisions: RevisionVectorSchema,
  expectedSourceRevisions: RevisionVectorSchema,
  commands: z.array(CommandInputSchema).min(1).max(100),
}).superRefine((group, context) => {
  const artifacts = new Set<string>();
  const commandIds = new Set<string>();
  for (const command of group.commands) {
    if (artifacts.has(command.artifactId) || commandIds.has(command.commandId)) {
      context.addIssue({ code: 'custom', message: 'Group commands and artifact IDs must be unique.' });
    }
    artifacts.add(command.artifactId);
    commandIds.add(command.commandId);
    if (group.expectedArtifactRevisions[command.artifactId] !== command.baseRevision) {
      context.addIssue({ code: 'custom', message: 'Every command must match the group revision vector.' });
    }
    for (const [sourceId, revision] of Object.entries(command.expectedSourceRevisions)) {
      if (group.expectedSourceRevisions[sourceId] !== revision) {
        context.addIssue({ code: 'custom', message: 'Source revisions must match the group vector.' });
      }
    }
  }
  if (Object.keys(group.expectedArtifactRevisions).length !== artifacts.size) {
    context.addIssue({ code: 'custom', message: 'The artifact revision vector must match the affected artifacts.' });
  }
});

export type CommandInput = z.infer<typeof CommandInputSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandGroupInput = z.infer<typeof CommandGroupInputSchema>;
