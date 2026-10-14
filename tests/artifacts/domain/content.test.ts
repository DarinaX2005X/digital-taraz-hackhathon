import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertBoundedJson, canonicalJson, hashJson } from '../../../src/features/artifacts/domain/canonical';
import { blankArtifactContent, createArtifactState } from '../../../src/features/artifacts/domain/content-state';
import type { ArtifactContent, JsonValue } from '../../../src/features/artifacts/domain/content-models';
import { validateArtifactContent, validateTableCell } from '../../../src/features/artifacts/domain/semantic-validation';
import { createArtifactTargetResolver, tableCellTargetId } from '../../../src/features/artifacts/domain/targets';

function idFactory() { let id = 0; return () => `element_${++id}`; }
function table(): Extract<ArtifactContent, { kind: 'table' }> {
  return { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Price list', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Prices', rowCount: 2, columnCount: 2, cellData: { 0: { 0: { v: '000081', t: 1 }, 1: { v: 1450, t: 2 } }, 1: { 0: { v: '000082', t: 4 } } } } } }, stableIds: { sheet: { rows: ['rowA', 'rowB'], columns: ['sku', 'price'] } } };
}

describe('bounded canonical artifact models', () => {
  it('uses the same canonical SHA256 in browser-capable and Node implementations', () => {
    const value = { z: ['Қазақша', { b: true, a: null }], a: 'Ручная формулировка', number: 0.1 };
    const reordered = { number: 0.1, a: 'Ручная формулировка', z: ['Қазақша', { a: null, b: true }] };
    expect(hashJson(value)).toBe(hashJson(reordered));
    expect(hashJson(value)).toBe(createHash('sha256').update(canonicalJson(value)).digest('hex'));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });
  it('rejects cycles, unsafe keys, non-finite numbers, unsupported objects and excessive depth before recursive schemas', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const value of [cyclic, { amount: Infinity }, new Date(), JSON.parse('{"__proto__":{"admin":true}}'), { value: undefined }]) expect(() => assertBoundedJson(value)).toThrow();
    let nested: unknown = 'value'; for (let i = 0; i < 70; i++) nested = [nested];
    expect(() => validateArtifactContent(nested)).toThrow('content-too-complex');
    expect(() => assertBoundedJson('a'.repeat(100), { bytes: 20 })).toThrow('content-too-large');
  });
  it.each(['document', 'table', 'design', 'plan'] as const)('creates a semantically valid blank %s', (kind) => {
    const content = blankArtifactContent(kind, idFactory());
    expect(validateArtifactContent(content)).toEqual(content);
    expect(createArtifactState(content).content).toEqual(content);
  });
  it('validates document tree grammar, stable IDs, table spans and safe links', () => {
    const valid = { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'heading', attrs: { id: 'heading', level: 2 }, content: [{ type: 'text', text: 'Баға', marks: [{ type: 'link', attrs: { href: 'https://example.test/price' } }] }] }] } };
    expect(validateArtifactContent(valid)).toEqual(valid);
    const duplicate = structuredClone(valid); duplicate.document.content.push(structuredClone(duplicate.document.content[0]!));
    expect(() => validateArtifactContent(duplicate)).toThrow('duplicate-element-id');
    const unsafe = structuredClone(valid); unsafe.document.content[0]!.content[0]!.marks[0]!.attrs.href = 'javascript:alert(1)';
    expect(() => validateArtifactContent(unsafe)).toThrow('invalid-link');
    expect(() => validateArtifactContent({ ...valid, document: { type: 'paragraph', attrs: { id: 'p' }, content: [] } })).toThrow('document-requires-doc-root');
    expect(() => validateArtifactContent({ ...valid, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'text', text: 'orphan' }] } })).toThrow('invalid-document-child');
    expect(() => validateArtifactContent({ ...valid, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'image', attrs: { id: 'image', src: 'https://example.test/private' } }] } })).toThrow('image-requires-asset-id');
  });
  it('rejects mismatched sheet orders, stable IDs, out-of-range cells and overlapping merges', () => {
    const cases = [table(), table(), table(), table(), table()];
    cases[0]!.workbook.sheetOrder.push('missing');
    cases[1]!.stableIds.sheet!.rows = ['rowA', 'rowA'];
    cases[2]!.workbook.sheets.sheet!.cellData['2'] = { 0: { v: 2 } };
    cases[3]!.workbook.sheets.sheet!.mergeData = [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, { startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 }];
    cases[4]!.workbook.sheets.sheet!.cellData['0']!['1']!.s = 'missing';
    for (const content of cases) expect(() => validateArtifactContent(content)).toThrow();
    expect(validateArtifactContent(table())).toEqual(table());
  });
  it('uses installed Univer cell type numbers and rejects external/network formulas', () => {
    expect(validateTableCell({ t: 1, v: '00042' }).v).toBe('00042');
    expect(validateTableCell({ t: 2, v: 42 }).v).toBe(42);
    expect(validateTableCell({ t: 3, v: false }).v).toBe(false);
    expect(validateTableCell({ t: 4, v: '=literal' }).v).toBe('=literal');
    for (const value of [{ t: 2, v: '42' }, { f: '=WEBSERVICE("https://example.test")' }, { f: "='[private.xlsx]Sheet'!A1" }, { f: '=cmd|data' }]) expect(() => validateTableCell(value)).toThrow();
    expect(validateTableCell({ f: '=SUM(A1:A2)', v: 42 })).toEqual({ f: '=SUM(A1:A2)', v: 42 });
  });
  it('requires design subtype data and globally unique layer/page identities', () => {
    const transform = { x: 0, y: 0, width: 100, height: 20, rotation: 0 };
    const valid = { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 100, height: 100, unit: 'px', background: '#ffffff', layers: [{ id: 'text', type: 'text', transform, text: 'Өнім', style: { fill: '#222222', fontSize: 16 } }] }] };
    expect(validateArtifactContent(valid)).toEqual(valid);
    const duplicate = structuredClone(valid); duplicate.pages[0]!.layers[0]!.id = 'page';
    expect(() => validateArtifactContent(duplicate)).toThrow('duplicate-element-id');
    const bad = structuredClone(valid); bad.pages[0]!.layers[0]!.type = 'image';
    expect(() => validateArtifactContent(bad)).toThrow('image-layer-requires-asset');
    const external = structuredClone(valid); external.pages[0]!.layers[0]!.style.fill = 'url(https://example.test/asset)';
    expect(() => validateArtifactContent(external)).toThrow('invalid-color');
  });
  it('rejects invalid plan dates, missing/cyclic dependencies and duplicate checklist IDs', () => {
    const entry = { id: 'prepare', title: 'Prepare', status: 'todo', resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [] };
    const value = { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [entry] };
    expect(validateArtifactContent(value)).toEqual(value);
    expect(() => validateArtifactContent({ ...value, timezone: 'Invalid/Zone' })).toThrow('invalid-timezone');
    expect(() => validateArtifactContent({ ...value, entries: [{ ...entry, startDate: '2026-10-14', endDate: '2026-10-13' }] })).toThrow('reversed-plan-time');
    expect(() => validateArtifactContent({ ...value, entries: [{ ...entry, dependencies: ['missing'] }] })).toThrow('missing-plan-dependency');
    expect(() => validateArtifactContent({ ...value, entries: [{ ...entry, dependencies: ['ship'] }, { ...entry, id: 'ship', dependencies: ['prepare'] }] })).toThrow('cyclic-plan-dependency');
    expect(() => validateArtifactContent({ ...value, entries: [{ ...entry, checklist: [{ id: 'check', text: 'One', done: false }, { id: 'check', text: 'Two', done: false }] }] })).toThrow('duplicate-element-id');
  });
  it('keeps stable cell identity/hash after row insertion and distinguishes an empty cell from a missing row', () => {
    const content = table();
    const id = tableCellTargetId('sheet', 'rowA', 'price');
    const before = createArtifactTargetResolver(content)(id)!;
    const inserted = structuredClone(content);
    inserted.stableIds.sheet!.rows.unshift('newRow'); inserted.workbook.sheets.sheet!.rowCount++;
    inserted.workbook.sheets.sheet!.cellData = { 1: content.workbook.sheets.sheet!.cellData['0']!, 2: content.workbook.sheets.sheet!.cellData['1']! };
    const after = createArtifactTargetResolver(inserted)(id)!;
    expect(after.hash).toBe(before.hash); expect(after.value).toEqual({ v: 1450, t: 2 });
    expect(createArtifactTargetResolver(content)(tableCellTargetId('sheet', 'rowB', 'price'))?.value).toBeNull();
    expect(createArtifactTargetResolver(content)(tableCellTargetId('sheet', 'missing', 'price'))).toBeNull();
  });
  it('keeps hashes sensitive to local text, lock and binding changes, without hashing object insertion order', () => {
    const content = blankArtifactContent('document', idFactory());
    const resolver = createArtifactTargetResolver(content);
    const locked = createArtifactTargetResolver(content, [], { element_2: { reason: 'Manual wording', actorId: '68eb98a7-71ba-4ec3-b4c1-ed8ec3d4df88', at: '2026-10-14T12:00:00Z' } });
    expect(resolver('element_2')!.hash).not.toBe(locked('element_2')!.hash);
    expect(() => createArtifactState(content, [], [], { missing: { reason: 'Lock', actorId: '68eb98a7-71ba-4ec3-b4c1-ed8ec3d4df88', at: '2026-10-14T12:00:00Z' } })).toThrow('missing-lock-target');
    expect(canonicalJson({ content } as JsonValue)).toContain('document');
  });
});
