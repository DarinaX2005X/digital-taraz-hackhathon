import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { columnLabel, documentBlocks, documentCellSpans, documentFieldValue, previewCell, textValue } from "@/features/artifacts/ui/preview-model";
import { validateDocumentNode } from "@/features/artifacts/domain/semantic-validation";

describe("read-only version values", () => {
  it("labels every supported spreadsheet column without inventing IDs", () => {
    expect([0, 25, 26, 99].map(columnLabel)).toEqual(["A", "Z", "AA", "CV"]);
    expect(() => columnLabel(-1)).toThrow();
    expect(() => columnLabel(100)).toThrow();
  });
  it("distinguishes empty cells, false, zero and uncalculated formula results", () => {
    expect(previewCell(undefined)).toEqual({ value: "", missingResult: false });
    expect(previewCell({ v: 0, f: "=SUM(A1:A2)" })).toEqual({ value: "0", formula: "=SUM(A1:A2)", missingResult: false });
    expect(previewCell({ v: false }).value).toBe("false");
    expect(previewCell({ f: "=SUM(A1:A2)" }).missingResult).toBe(true);
    expect(previewCell({ v: "<script>" }).value).toBe("<script>");
  });
  it("extracts semantic value text without HTML parsing or running formulas", () => {
    expect(textValue({ type: "paragraph", content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] })).toBe("A B");
    expect(textValue({ v: 0, f: "=SUM(A1)" })).toBe("0");
    expect(textValue({ title: "My task", id: "internal-id" })).toBe("My task");
    expect(textValue({ text: "<script>alert(1)</script>" })).toBe("<script>alert(1)</script>");
    expect(textValue("abcdefgh", 4)).toBe("abcd…");
  });
  it("retains canonical document nodes for a version preview", () => {
    const node = { type: "paragraph" as const, attrs: { id: "stable-paragraph" }, content: [{ type: "text" as const, text: "Saved text" }] };
    expect(documentBlocks({ kind: "document", schemaVersion: 1, document: { type: "doc", content: [node] } })).toEqual([node]);
  });
  it("preserves canonical bound-field strings including intentional emptiness", () => {
    for (const value of ["", "0", "false", "Revenue 123"]) {
      const node = validateDocumentNode({ type: "dataField", attrs: { id: "field-1", value } });
      expect(documentFieldValue(node)).toBe(value);
    }
    expect(documentFieldValue({ type: "dataField", attrs: { value: false } })).toBeUndefined();
  });
  it("maps validated merged-cell spans to native table attributes", () => {
    expect(documentCellSpans({ type: "tableCell", attrs: { colspan: 2, rowspan: 3 } })).toEqual({ colSpan: 2, rowSpan: 3 });
    expect(documentCellSpans({ type: "tableHeader", attrs: { colspan: 100, rowspan: 1 } })).toEqual({ colSpan: 100, rowSpan: 1 });
    expect(documentCellSpans({ type: "tableCell", attrs: { colspan: 101, rowspan: -1 } })).toEqual({ colSpan: undefined, rowSpan: undefined });
    const source = readFileSync("src/features/artifacts/ui/content-preview.tsx", "utf8");
    expect(source).toContain("documentFieldValue(node) ??");
    expect(source).toContain("<th {...documentCellSpans(node)}>");
    expect(source).toContain("<td {...documentCellSpans(node)}>");
  });
  it("reads only the bounded Univer rich-text data stream when the plain cell value is absent", () => {
    expect(previewCell({ p: { body: { dataStream: "Revenue 123\r\n", textRuns: [{ st: 0, ed: 7 }] } } })).toEqual({ value: "Revenue 123", missingResult: false });
    expect(previewCell({ p: { body: { dataStream: "\r\n" } } }).value).toBe("");
    expect(previewCell({ v: 0, p: { body: { dataStream: "stale\r\n" } } }).value).toBe("0");
    expect(previewCell({ p: { metadata: "private metadata" } }).value).toBe("");
    expect(previewCell({ f: "=SUM(A1:A2)", p: { body: { dataStream: "unverified output\r\n" } } })).toEqual({ value: "", formula: "=SUM(A1:A2)", missingResult: true });
    expect(previewCell({ p: { body: { dataStream: "a".repeat(100001) } } }).value).toHaveLength(100001);
  });
});
