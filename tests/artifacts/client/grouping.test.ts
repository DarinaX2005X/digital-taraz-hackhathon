import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandGroupInput } from "@/contracts/commands";
import { createCommandGrouping, type CommandGroupDraft } from "@/features/artifacts/client/grouping";
import { group, ids } from "./fixtures";

function input(text: string, revision = 0): CommandGroupDraft {
  const result = group();
  const command = result.commands[0]!;
  return { expectedArtifactRevisions: { [ids.artifact]: revision }, expectedSourceRevisions: {}, commands: [{ ...command, baseRevision: revision, operations: [{ ...command.operations[0]!, value: { text } }] }] };
}
afterEach(() => { vi.useRealTimers(); });

describe("single editor command grouping", () => {
  it("groups typing for 700 ms and keeps the last complete change from its base", () => {
    vi.useFakeTimers();
    const ready: CommandGroupInput[] = [];
    const adapter = createCommandGrouping({ onReady: (value) => { ready.push(value); } });
    adapter.stage(input("one"), "typing", "paragraph-1");
    vi.advanceTimersByTime(699);
    adapter.stage(input("one two"), "typing", "paragraph-1");
    vi.advanceTimersByTime(699);
    expect(ready).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.commands[0]?.operations[0]?.value).toEqual({ text: "one two" });
    expect(ready[0]?.commands[0]?.operations[0]?.beforeHash).toBe("a".repeat(64));
    expect(adapter.pending).toBe(false);
  });

  it("ends a typing group at a selection change or new authoritative base revision", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const adapter = createCommandGrouping({ onReady: ready });
    adapter.stage(input("one"), "typing", "paragraph-1");
    adapter.selectionChanged("paragraph-2");
    expect(ready).toHaveBeenCalledTimes(1);
    adapter.stage(input("two"), "typing", "paragraph-2");
    adapter.stage(input("three", 1), "typing", "paragraph-2");
    expect(ready).toHaveBeenCalledTimes(2);
    adapter.flush();
    expect(ready).toHaveBeenCalledTimes(3);
    expect(new Set(ready.mock.calls.map(([value]) => value.commandGroupId)).size).toBe(3);
  });

  it.each(["drag-end", "paste", "format", "ai-package"] as const)("commits %s as one immediate coherent group", (boundary) => {
    const ready = vi.fn();
    const adapter = createCommandGrouping({ onReady: ready });
    const action = input("final");
    action.commands.push({ ...action.commands[0]!, artifactId: ids.otherArtifact });
    action.expectedArtifactRevisions[ids.otherArtifact] = 0;
    adapter.stage(action, boundary);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0]?.[0].commands).toHaveLength(2);
    expect(adapter.pending).toBe(false);
  });

  it("does not mutate the accepted group if an engine reuses its input objects", () => {
    const ready = vi.fn();
    const adapter = createCommandGrouping({ onReady: ready });
    const action = input("first");
    adapter.stage(action, "paste");
    action.commands[0]!.operations[0]!.value = "changed";
    expect(ready.mock.calls[0]?.[0].commands[0].operations[0].value).toEqual({ text: "first" });
  });

  it("discards the timer only when the caller explicitly disposes the adapter", () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    const adapter = createCommandGrouping({ onReady: ready });
    adapter.stage(input("draft"), "typing");
    adapter.dispose();
    vi.runAllTimers();
    expect(ready).not.toHaveBeenCalled();
    expect(() => adapter.stage(input("late"), "paste")).toThrow("closed");
  });
});
