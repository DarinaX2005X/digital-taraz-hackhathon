import { z } from "zod";
import { CommandGroupInputSchema } from "@/contracts/commands";
import { IdSchema, InstantSchema, RevisionSchema } from "@/contracts/primitives";
import { ErrorEnvelopeSchema } from "@/contracts/errors";
import { ArtifactContentSchema } from "../contracts";

export const LocalDraftSchema = z.strictObject({
  artifactId: IdSchema,
  baseRevision: RevisionSchema,
  schemaVersion: z.number().int().positive(),
  generation: z.number().int().nonnegative(),
  content: ArtifactContentSchema,
  updatedAt: InstantSchema,
});

export const PendingCommandSchema = z.strictObject({
  group: CommandGroupInputSchema,
  state: z.enum(["ready", "uncertain", "authentication-required", "conflict"]),
  createdAt: InstantSchema,
  draftGenerations: z.record(IdSchema, z.number().int().nonnegative()),
  conflict: ErrorEnvelopeSchema.optional(),
}).superRefine((record, context) => {
  const ids = record.group.commands.map((command) => command.artifactId);
  if (Object.keys(record.draftGenerations).some((id) => !ids.includes(id))) {
    context.addIssue({ code: "custom", message: "Draft generations must belong to the command group." });
  }
  if ((record.state === "conflict") !== (record.conflict?.code === "CONFLICT")) {
    context.addIssue({ code: "custom", message: "A conflict requires its authoritative response." });
  }
});

export type LocalDraft = z.infer<typeof LocalDraftSchema>;
export type PendingCommand = z.infer<typeof PendingCommandSchema>;
