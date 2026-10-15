import type { SourceRef } from '@/contracts/artifacts';
import type { DependencyEdge } from '@/contracts/dependency-edges';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { ArtifactContent, JsonValue } from '@/features/artifacts/domain/content-models';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { createArtifactState } from '@/features/artifacts/domain/content-state';
import { tableCellTargetId } from '@/features/artifacts/domain/targets';
import type { Locale } from '@/i18n/locales';
import { transformValue } from '@/features/dependencies/domain/transforms';

const sampleCopy = {
  ru: { table: 'Смета мастерской', document: 'Предложение для кофейни', title: 'Вывеска и меню для кофейни', service: 'Работа', price: 'Цена, ₸', quantity: 'Количество', total: 'Сумма, ₸', first: 'Печать меню', second: 'Подготовка макета', phrase: 'Привезём готовые материалы в удобный для вас день.', intro: 'Подготовим меню и материалы для вашей кофейни.', amount: 'Стоимость работ: ', closing: 'Согласуем макет перед печатью.', line: 'Стоимость позиции', grand: 'Итого по смете' },
  kk: { table: 'Шеберхана сметасы', document: 'Кофеханаға ұсыныс', title: 'Кофеханаға арналған маңдайша мен мәзір', service: 'Жұмыс', price: 'Бағасы, ₸', quantity: 'Саны', total: 'Сома, ₸', first: 'Мәзірді басып шығару', second: 'Макетті дайындау', phrase: 'Дайын материалдарды сізге ыңғайлы күні жеткіземіз.', intro: 'Кофеханаңызға мәзір мен материалдар дайындаймыз.', amount: 'Жұмыстың құны: ', closing: 'Басып шығармас бұрын макетті келісеміз.', line: 'Жұмыстың құны', grand: 'Сметаның жалпы сомасы' },
  en: { table: 'Workshop estimate', document: 'Offer for a café', title: 'Signs and menus for a café', service: 'Work', price: 'Price, ₸', quantity: 'Quantity', total: 'Amount, ₸', first: 'Menu printing', second: 'Layout preparation', phrase: 'We will deliver the finished materials on a day that suits you.', intro: 'We will prepare menus and materials for your café.', amount: 'Total cost: ', closing: 'We will agree the layout before printing.', line: 'Line amount', grand: 'Estimate total' },
};
export interface DemoSeed { locale: Locale; snapshots: ArtifactSnapshot[]; edges: DependencyEdge[]; tableId: string; documentId: string; priceTargetId: string; sourceRef: SourceRef }
export function createDemoSeed(locale: Locale, makeId: () => string = () => crypto.randomUUID()): DemoSeed {
  const t = sampleCopy[locale], userId = makeId(), workspaceId = makeId(), projectId = makeId(), tableId = makeId(), documentId = makeId(), at = new Date().toISOString();
  const sourceRef: SourceRef = { sourceId: makeId(), sourceVersionId: makeId(), revision: 1 };
  const cell = (row: string, column: string) => tableCellTargetId('estimate', row, column);
  const money = (value: string) => String(transformValue({ kind: 'money-format', input: 'amount', currency: 'KZT', locale, scale: 2, basis: 'major' }, new Map([['amount', value]])));
  const table: ArtifactContent = { kind: 'table', schemaVersion: 1, workbook: { id: 'demo-workbook', name: t.table, appVersion: '1', locale: locale === 'en' ? 'enUS' : 'ruRU', sheetOrder: ['estimate'], sheets: { estimate: { id: 'estimate', name: t.table, rowCount: 4, columnCount: 4, columnData: { '0': { w: 260 }, '1': { w: 140 }, '2': { w: 120 }, '3': { w: 150 } }, cellData: {
    '0': { '0': { v: t.service, t: 1 }, '1': { v: t.price, t: 1 }, '2': { v: t.quantity, t: 1 }, '3': { v: t.total, t: 1 } },
    '1': { '0': { v: t.first, t: 1 }, '1': { v: 2500, t: 2 }, '2': { v: 2, t: 2 }, '3': { v: 5000, t: 2, f: '=B2*C2' } },
    '2': { '0': { v: t.second, t: 1 }, '1': { v: 4000, t: 2 }, '2': { v: 1, t: 2 }, '3': { v: 4000, t: 2, f: '=B3*C3' } },
    '3': { '0': { v: t.grand, t: 1 }, '3': { v: 9000, t: 2, f: '=SUM(D2:D3)' } },
  } } } }, stableIds: { estimate: { rows: ['heading', 'printing', 'layout', 'grand'], columns: ['service', 'price', 'quantity', 'amount'] } } };
  const document: ArtifactContent = { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [
    { type: 'heading', attrs: { id: 'title', level: 1 }, content: [{ type: 'text', text: t.title }] },
    { type: 'paragraph', attrs: { id: 'intro' }, content: [{ type: 'text', text: t.intro }] },
    { type: 'paragraph', attrs: { id: 'price-line' }, content: [{ type: 'text', text: t.amount }, { type: 'dataField', attrs: { id: 'total-amount', value: money('9000') }, marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', attrs: { id: 'personal-phrase' }, content: [{ type: 'text', text: t.phrase }] },
    { type: 'paragraph', attrs: { id: 'closing' }, content: [{ type: 'text', text: t.closing }] },
  ] } };
  const snapshots = [table, document].map((content, index): ArtifactSnapshot => {
    const id = index === 0 ? tableId : documentId, title = index === 0 ? t.table : t.document;
    const bindings = index === 1 ? [{ targetElementId: 'total-amount', sourceRef, transformId: 'estimate-total', updateMode: 'propose' as const }] : [];
    const state = createArtifactState(content, [sourceRef], bindings), contentRef = { id: makeId(), hash: hashJson(state as unknown as JsonValue) };
    return { viewer: { userId, workspaceId, authzVersion: 1 }, artifact: { id, workspaceId, projectId, kind: content.kind, schemaVersion: 1, currentRevision: 0, title, status: 'draft', contentRef, sourceRefs: [sourceRef], bindings, createdBy: userId, updatedAt: at }, content,
      version: { id: makeId(), artifactId: id, revision: 0, parentRevision: null, contentRef, snapshotHash: contentRef.hash, title, reason: 'Prepared workshop example', authorId: userId, createdAt: at, inputRevisions: { [sourceRef.sourceId]: 1 } },
      permissions: { edit: true, rename: false, duplicate: false, move: false, archive: false, trash: false, restore: false, purge: false }, sourceFreshness: [{ sourceRef, status: 'current', sourceStatus: 'current', currentRevision: 1, currentVersionId: sourceRef.sourceVersionId }], history: [], cursor: '0', locks: {}, missingTargets: [] };
  });
  const edges: DependencyEdge[] = ['printing', 'layout'].map((row) => ({ id: makeId(), inputs: [{ key: 'price', ref: { kind: 'artifact', artifactId: tableId, targetElementId: cell(row, 'price') } }, { key: 'quantity', ref: { kind: 'artifact', artifactId: tableId, targetElementId: cell(row, 'quantity') } }], target: { artifactId: tableId, targetElementId: cell(row, 'amount') }, transform: { kind: 'decimal', operation: 'product', inputs: ['price', 'quantity'], scale: 2 }, updateMode: 'deterministic', label: `${t.line}: ${row === 'printing' ? t.first : t.second}` }));
  edges.push({ id: makeId(), inputs: ['printing', 'layout'].map((row) => ({ key: row, ref: { kind: 'artifact' as const, artifactId: tableId, targetElementId: cell(row, 'amount') } })), target: { artifactId: tableId, targetElementId: cell('grand', 'amount') }, transform: { kind: 'decimal', operation: 'sum', inputs: ['printing', 'layout'], scale: 2 }, updateMode: 'deterministic', label: t.grand },
    { id: makeId(), inputs: [{ key: 'total', ref: { kind: 'artifact', artifactId: tableId, targetElementId: cell('grand', 'amount') } }], target: { artifactId: documentId, targetElementId: 'total-amount' }, transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale, scale: 2, basis: 'major' }, updateMode: 'propose', label: t.grand });
  return { locale, snapshots, edges, tableId, documentId, priceTargetId: cell('printing', 'price'), sourceRef };
}
