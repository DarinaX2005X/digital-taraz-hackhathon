import type { ImportMapping, MaterialField } from '@/contracts/materials';

/** A missing or ambiguous source column remains unresolved until a person selects it. */
export function reconcileColumns(mapping: ImportMapping, headers: readonly string[] | null): { fields: MaterialField[]; unresolved: string[] } {
  const unresolved: string[] = [];
  const fields = mapping.fields.map((field) => {
    const candidates = headers && field.header !== null ? headers.flatMap((header,column) => header === field.header ? [column] : []) : [];
    if (candidates.length !== 1) { unresolved.push(field.id); return { ...field, column: -1 }; }
    return { ...field, column: candidates[0]! };
  });
  return { fields, unresolved };
}
