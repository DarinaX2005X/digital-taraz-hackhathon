import { CommandGroupInputSchema, type CommandGroupInput, type CommandInput } from "@/contracts/commands";

export const TYPING_GROUP_DELAY_MS = 700;
export type CommandGroupDraft = Omit<CommandGroupInput, "commandGroupId" | "commands"> & {
  commands: Omit<CommandInput, "commandId">[];
};
export type EditorActionBoundary = "typing" | "drag-end" | "paste" | "format" | "ai-package";
type GroupingOptions = {
  onReady(group: CommandGroupInput): void;
  createId?: () => string;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
};

/** Engine adapters supply the complete change from the group's base, not incremental keystrokes. */
export function createCommandGrouping(options: GroupingOptions) {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let staged: { draft: CommandGroupDraft; selection: string; basis: string } | undefined;
  let disposed = false;

  function build(input: CommandGroupDraft): CommandGroupInput {
    return CommandGroupInputSchema.parse({ ...input, commandGroupId: createId(), commands: input.commands.map((command) => ({ ...command, commandId: createId() })) });
  }

  function flush(): CommandGroupInput | undefined {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (!staged) return undefined;
    const value = build(staged.draft);
    staged = undefined;
    options.onReady(value);
    return value;
  }

  return {
    get pending() { return staged !== undefined; },
    stage(draft: CommandGroupDraft, boundary: EditorActionBoundary, selection = ""): void {
      if (disposed) throw new Error("The history adapter is closed.");
      // Validate through the canonical schema before the old pending group is changed.
      const validated = build(draft);
      const normalized: CommandGroupDraft = {
        expectedArtifactRevisions: validated.expectedArtifactRevisions,
        expectedSourceRevisions: validated.expectedSourceRevisions,
        ...(validated.changesetId ? { changesetId: validated.changesetId } : {}),
        ...(validated.metadataAt ? { metadataAt: validated.metadataAt } : {}),
        ...(validated.dependencyEdges ? { dependencyEdges: validated.dependencyEdges } : {}),
        commands: validated.commands.map((command) => ({ artifactId: command.artifactId, baseRevision: command.baseRevision, kind: command.kind, operations: command.operations, expectedSourceRevisions: command.expectedSourceRevisions, reason: command.reason })),
      };
      const basis = JSON.stringify({ artifacts: normalized.expectedArtifactRevisions, sources: normalized.expectedSourceRevisions, changeset: normalized.changesetId });
      if (boundary !== "typing") { flush(); options.onReady(validated); return; }
      if (staged && (staged.selection !== selection || staged.basis !== basis)) flush();
      staged = { draft: normalized, selection, basis };
      if (timer !== undefined) cancel(timer);
      timer = schedule(() => { flush(); }, TYPING_GROUP_DELAY_MS);
    },
    selectionChanged(selection: string) { if (staged && staged.selection !== selection) flush(); },
    flush,
    dispose() { disposed = true; if (timer !== undefined) cancel(timer); timer = undefined; staged = undefined; },
  };
}

export type CommandGrouping = ReturnType<typeof createCommandGrouping>;
