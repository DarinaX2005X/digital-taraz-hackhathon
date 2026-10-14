import { describe, expect, it } from "vitest";
import { historyActionEligible, prepareHistoryOperation } from "@/features/artifacts/client/checked-history";
import { ids, snapshot } from "./fixtures";

function history() { const value = snapshot(); return { viewer: value.viewer, artifactId: ids.artifact, groups: value.history.map((group) => ({ ...group, expectedSourceRevisions: {} })), cursor: value.cursor }; }

describe("checked history operation", () => {
  it("captures every affected current revision and authoritative source version in one new ID", () => {
    const value = history();
    value.groups[0]!.artifacts.push({ artifactId: ids.otherArtifact, title: "Related table", kind: "table", committedRevision: 4, currentRevision: 7 });
    value.groups[0]!.committedRevisionVector[ids.otherArtifact] = 4;
    value.groups[0]!.expectedSourceRevisions = { [ids.otherWorkspace]: 9 };
    const result = prepareHistoryOperation(value, ids.group, "undo", { createId: () => ids.command, now: () => "2026-10-14T00:00:00.000Z" });
    expect(result).toMatchObject({ kind: "undo", operationId: ids.command, body: { commandGroupId: ids.command, targetCommandGroupId: ids.group, expectedArtifactRevisions: { [ids.artifact]: 1, [ids.otherArtifact]: 7 }, expectedSourceRevisions: { [ids.otherWorkspace]: 9 } } });
  });
  it("never infers permission for hidden artifacts or old history without a source vector", () => {
    const value = history();
    const legacy = snapshot().history[0]!;
    expect(historyActionEligible(legacy, "undo")).toBe(false);
    expect(() => prepareHistoryOperation({ ...value, groups: [legacy] }, ids.group, "undo")).toThrow("locked");
    value.groups[0]!.hasUnavailableArtifacts = true;
    value.groups[0]!.canUndo = false;
    expect(() => prepareHistoryOperation(value, ids.group, "undo")).toThrow("locked");
  });
  it("requires the server's eligibility for redo, not just an undone label", () => {
    const value = history();
    value.groups[0]!.state = "undone";
    value.groups[0]!.canUndo = false;
    value.groups[0]!.canRedo = false;
    expect(() => prepareHistoryOperation(value, ids.group, "redo")).toThrow("locked");
    value.groups[0]!.canRedo = true;
    expect(prepareHistoryOperation(value, ids.group, "redo").kind).toBe("redo");
  });
});
