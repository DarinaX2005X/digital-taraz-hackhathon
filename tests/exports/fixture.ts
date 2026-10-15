import type { DocumentNode } from '../../src/features/artifacts/domain/content-models';
import { ExportOptionsSchema } from '../../src/features/exports/contracts';
import type { RenderInput } from '../../src/features/exports/server/types';
export const paragraph = (id: string, text: string): DocumentNode => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
export function documentInput(nodes: DocumentNode[] = [paragraph('p1', 'Коммерческое предложение — Қазақстан Ә Ғ Қ Ң Ө Ұ Ү Һ І')]): RenderInput {
  return { artifactId: '6d9e09bc-aafb-4bc6-8397-d078c0f95bd1', content: { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: nodes } }, title: 'Предложение для клиента', format: 'docx', locale: 'ru', options: ExportOptionsSchema.parse({}), privateFieldsPolicy: 'exclude-internal', historicalDraft: false, revision: 3, createdAt: '2026-10-15T10:00:00.000Z', assets: { async image() { throw new Error('Unexpected image'); } } };
}
