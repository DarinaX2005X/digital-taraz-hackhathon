import type { ArtifactContent, DocumentNode, JsonValue, TableCell } from "../domain/content-models";

export function columnLabel(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 99) throw new RangeError("Invalid table column.");
  let value = index + 1;
  let label = "";
  while (value > 0) { value -= 1; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
}

export function previewCell(cell: TableCell | undefined): { value: string; formula?: string; missingResult: boolean } {
  if (!cell) return { value: "", missingResult: false };
  const hasValue = cell.v !== undefined && cell.v !== null;
  let richText = "";
  const document = cell.p;
  if (!hasValue && !cell.f && document && typeof document === "object" && !Array.isArray(document)) {
    const body = document.body;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof body.dataStream === "string") {
      const text = body.dataStream.endsWith("\r\n") ? body.dataStream.slice(0, -2) : body.dataStream;
      richText = text.length > 100000 ? `${text.slice(0, 100000)}…` : text;
    }
  }
  return { value: hasValue ? String(cell.v) : richText, ...(cell.f ? { formula: cell.f } : {}), missingResult: Boolean(cell.f) && !hasValue };
}

export function documentFieldValue(node: DocumentNode): string | undefined {
  return node.type === "dataField" && typeof node.attrs?.value === "string" ? node.attrs.value : undefined;
}

export function documentCellSpans(node: DocumentNode): { colSpan?: number; rowSpan?: number } {
  const valid = (value: JsonValue | undefined) => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : undefined;
  return { colSpan: valid(node.attrs?.colspan), rowSpan: valid(node.attrs?.rowspan) };
}

export function textValue(value: JsonValue, maximum = 600): string {
  const pieces: string[] = [];
  let length = 0;
  const stack: JsonValue[] = [value];
  while (stack.length && length < maximum) {
    const current = stack.pop();
    if (current === null || current === undefined) continue;
    if (typeof current !== "object") { const piece = String(current); pieces.push(piece); length += piece.length + 1; }
    else if (Array.isArray(current)) stack.push(...[...current].reverse());
    else if (typeof current.text === "string") stack.push(current.text);
    else if (typeof current.title === "string") stack.push(current.title);
    else if (Object.hasOwn(current, "v")) stack.push(current.v!);
    else if (Array.isArray(current.content)) stack.push(current.content);
    else stack.push(...Object.values(current).reverse());
  }
  const text = pieces.join(" ");
  return text.length > maximum || stack.length ? `${text.slice(0, maximum)}…` : text;
}

export function documentBlocks(content: Extract<ArtifactContent, { kind: "document" }>): DocumentNode[] {
  return content.document.type === "doc" ? content.document.content ?? [] : [content.document];
}
