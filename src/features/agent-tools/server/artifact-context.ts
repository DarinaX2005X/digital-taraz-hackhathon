import { z } from 'zod';
import type { ArtifactContent, DocumentNode } from '../../artifacts/domain/content-models';
import type { FieldBinding, SourceRef } from '../../../contracts/artifacts';
import { tableCellTargetId } from '../../artifacts/domain/targets';
import { IdSchema, RevisionSchema } from '../../../contracts/primitives';
import { SourceRefSchema } from '../../../contracts/artifacts';

export const ArtifactExcerptSchema = z.strictObject({
  artifactId: IdSchema, revision: RevisionSchema, title: z.string().max(240), kind: z.enum(['document', 'table', 'design', 'plan']),
  sourceRefs: z.array(SourceRefSchema).max(1000),
  targets: z.array(z.strictObject({ targetId: z.string().max(128), text: z.string().max(3000), formula: z.string().max(8000).nullable(), sourceRef: SourceRefSchema.nullable(), locked: z.boolean() })).max(80),
  included: z.number().int(), total: z.number().int(),
});
export type ArtifactExcerpt = z.infer<typeof ArtifactExcerptSchema>;
export function excerptArtifact(input: { artifactId: string; revision: number; title: string; content: ArtifactContent; bindings: FieldBinding[]; sourceRefs: SourceRef[]; lockedIds: string[]; offset?: number }): ArtifactExcerpt {
  const targets: ArtifactExcerpt['targets'] = [], locked = new Set(input.lockedIds);
  const add = (targetId: string, text: string, formula: string | null = null) => targets.push({ targetId, text: text.slice(0, 3000), formula, sourceRef: input.bindings.find((binding) => binding.targetElementId === targetId)?.sourceRef ?? null, locked: locked.has(targetId) });
  const content = input.content;
  if (content.kind === 'document') {
    const plain = (node: DocumentNode): string => node.text ?? (node.type === 'dataField' ? String(node.attrs?.value ?? '') : (node.content ?? []).map(plain).join(''));
    const visit = (node: DocumentNode) => { if (['paragraph', 'heading', 'dataField'].includes(node.type) && typeof node.attrs?.id === 'string') add(node.attrs.id, plain(node)); else node.content?.forEach(visit); };
    visit(content.document);
  } else if (content.kind === 'table') {
    for (const sheetId of content.workbook.sheetOrder) {
      const sheet = content.workbook.sheets[sheetId]!, ids = content.stableIds[sheetId]!;
      for (const [row, cells] of Object.entries(sheet.cellData)) for (const [column, cell] of Object.entries(cells)) {
        const rowId = ids.rows[Number(row)], columnId = ids.columns[Number(column)];
        if (rowId && columnId) add(tableCellTargetId(sheetId, rowId, columnId), String(cell.v ?? ''), cell.f ?? null);
      }
    }
  } else if (content.kind === 'plan') for (const entry of content.entries) add(entry.id, `${entry.title}\n${entry.notes ?? ''}`);
  else for (const page of content.pages) for (const layer of page.layers) add(layer.id, layer.text ?? layer.type);
  const selected = targets.slice(input.offset ?? 0, (input.offset ?? 0) + 80);
  return { artifactId: input.artifactId, revision: input.revision, title: input.title, kind: content.kind, sourceRefs: input.sourceRefs, targets: selected, included: selected.length, total: targets.length };
}
