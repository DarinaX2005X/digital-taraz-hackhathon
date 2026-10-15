import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DependencyEdge } from '../../src/contracts/dependencies';
import type { SourceRef } from '../../src/contracts/artifacts';
import type { JsonValue } from '../../src/features/artifacts/domain/content-models';
import { inverseInputs } from '../../src/features/artifacts/domain/operations';
import { tableCellTargetId } from '../../src/features/artifacts/domain/targets';
import { compileDependencies, affectedDependencies, dependencyKey } from '../../src/features/dependencies/domain/graph';
import { artifactDraft, buildDependencyProposal, commandsForProposal, selectableGroups, type DependencyArtifact } from '../../src/features/dependencies/domain/proposal';
import { formatMaterialValue, materialScalar, transformValue } from '../../src/features/dependencies/domain/transforms';

const actor = randomUUID(), at = '2026-10-15T10:00:00.000Z';
function fixture() {
  const tableId = randomUUID(), documentId = randomUUID();
  const sourceRef: SourceRef = { sourceId: randomUUID(), sourceVersionId: randomUUID(), revision: 1, collectionId: randomUUID(), recordId: randomUUID(), fieldId: 'price', factRevision: 1 };
  const price = tableCellTargetId('estimate', 'service', 'price'), quantity = tableCellTargetId('estimate', 'service', 'quantity'), total = tableCellTargetId('estimate', 'service', 'total');
  const table: DependencyArtifact = { id: tableId, title: 'Estimate', revision: 0, sourceRefs: [sourceRef], bindings: [], content: { kind: 'table', schemaVersion: 1, workbook: { id: 'workbook', name: 'Estimate', appVersion: '1', locale: 'ruRU', sheetOrder: ['estimate'], sheets: { estimate: { id: 'estimate', name: 'Estimate', rowCount: 1, columnCount: 3, cellData: { '0': { '0': { v: 1250.55, t: 2 }, '1': { v: 3, t: 2 }, '2': { v: 3000, t: 2, f: '=A1*B1' } } } } } }, stableIds: { estimate: { rows: ['service'], columns: ['price', 'quantity', 'total'] } } } };
  const document: DependencyArtifact = { id: documentId, title: 'Offer', revision: 0, sourceRefs: [sourceRef], bindings: [{ targetElementId: 'amount', sourceRef, transformId: 'total', updateMode: 'propose' }], content: { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'words' }, content: [{ type: 'text', text: 'My personal delivery promise.' }] }, { type: 'paragraph', attrs: { id: 'price-line' }, content: [{ type: 'dataField', attrs: { id: 'amount', value: '3 000 ₸' } }] }] } } };
  const edges: DependencyEdge[] = [
    { id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'artifact', artifactId: tableId, targetElementId: price } }, { key: 'qty', ref: { kind: 'artifact', artifactId: tableId, targetElementId: quantity } }], target: { artifactId: tableId, targetElementId: total }, transform: { kind: 'decimal', operation: 'product', inputs: ['price', 'qty'], scale: 2 }, updateMode: 'deterministic', label: 'Line total' },
    { id: randomUUID(), inputs: [{ key: 'total', ref: { kind: 'artifact', artifactId: tableId, targetElementId: total } }], target: { artifactId: documentId, targetElementId: 'amount' }, transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'ru', scale: 2, basis: 'major' }, updateMode: 'propose', label: 'Offer total' },
  ];
  const input = { edges, artifacts: [table, document], facts: [], graphRevision: 1, expectedSourceRevisions: { [sourceRef.sourceId]: 1 }, actorId: actor, at };
  return { input, table, document, sourceRef, price, quantity, total };
}

describe('addressed connected changes', () => {
  it('recalculates an exact total and one document field while retaining manual words and formulas', async () => {
    const f = fixture(), proposal = await buildDependencyProposal(f.input);
    expect(proposal.changes.map((change) => change.state)).toEqual(['ready', 'ready']);
    expect(selectableGroups(proposal)).toHaveLength(1);
    expect((proposal.changes[0]!.after as { v: number; f: string }).v).toBe(3751.65);
    expect((proposal.changes[0]!.after as { f: string }).f).toBe('=A1*B1');
    const group = commandsForProposal(proposal, f.input.artifacts, selectableGroups(proposal), { groupId: randomUUID(), makeId: randomUUID }, 'Update price');
    const doc = artifactDraft(f.document), before = (await doc.target('words'))!.hash;
    const applied = await doc.apply(group.commands.find((item) => item.artifactId === f.document.id)!.operations, { actorId: actor, at, origin: 'import', reason: 'Update price' });
    expect((await doc.target('words'))!.hash).toBe(before);
    expect(JSON.stringify((await doc.target('amount'))!.value)).toContain('751,65');
    await doc.apply(inverseInputs(applied.inverse), { actorId: actor, at, origin: 'history', reason: 'Undo' }, applied.inverse);
    expect((await doc.target('amount'))!.value).toEqual((await artifactDraft(f.document).target('amount'))!.value);
  });
  it('preserves canonical manual overrides and continues to report their difference', async () => {
    const f = fixture();
    f.document.bindings[0]!.override = { actorId: actor, at, reason: 'Negotiated with customer' };
    const proposal = await buildDependencyProposal(f.input);
    expect(proposal.changes[1]!.state).toBe('overridden');
    expect(proposal.changes[1]!.operations).toEqual([]);
  });
  it('protects ancestor locks and blocks accepting only a dependent total', async () => {
    const f = fixture(); f.document.locks = { 'price-line': { actorId: actor, at, reason: 'Agreed' } };
    const proposal = await buildDependencyProposal(f.input);
    expect(proposal.changes[1]!.state).toBe('locked');
    expect(selectableGroups(proposal)).toEqual([]);
    expect(() => commandsForProposal(proposal, f.input.artifacts, [proposal.changes[0]!.groupId], { groupId: randomUUID(), makeId: randomUUID }, 'Change')).toThrow();
  });
  it('addresses rows by stable identity after reordering', async () => {
    const f = fixture();
    if (f.table.content.kind !== 'table') throw new Error('fixture');
    f.table.content.stableIds.estimate!.rows.unshift('unrelated');
    f.table.content.workbook.sheets.estimate!.rowCount = 2;
    f.table.content.workbook.sheets.estimate!.cellData = { '0': { '0': { v: 999, t: 2 } }, '1': f.table.content.workbook.sheets.estimate!.cellData['0']! };
    const proposal = await buildDependencyProposal(f.input);
    expect((proposal.changes[0]!.after as { v: number }).v).toBe(3751.65);
  });
  it('reports disappeared stable rows and never binds the old target to the next row', async () => {
    const f = fixture();
    if (f.table.content.kind !== 'table') throw new Error('fixture');
    f.table.content.stableIds.estimate!.rows = ['replacement'];
    const proposal = await buildDependencyProposal(f.input);
    expect(proposal.changes.map((change) => change.state)).toEqual(['missing-target', 'upstream-blocked']);
    expect(selectableGroups(proposal)).toEqual([]);
  });
  it('changes source metadata with the value and preserves the exact before/after vector', async () => {
    const f = fixture(), current = { ...f.sourceRef, sourceVersionId: randomUUID(), revision: 2, factRevision: 2 };
    f.table.bindings = [{ targetElementId: f.price, sourceRef: f.sourceRef, transformId: 'price', updateMode: 'deterministic' }];
    f.input.edges.unshift({ id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'source', sourceRef: f.sourceRef } }], target: { artifactId: f.table.id, targetElementId: f.price }, transform: { kind: 'copy', input: 'price' }, label: 'Price changed', updateMode: 'deterministic' });
    const proposal = await buildDependencyProposal({ ...f.input, expectedSourceRevisions: { [current.sourceId]: 2 }, facts: [{ key: dependencyKey({ kind: 'source', sourceRef: current }), state: 'current', sourceRef: current, value: '1500.00' }] });
    expect(proposal.changes[0]!.operations.map((item) => item.op)).toEqual(['set', 'bind']);
    expect((proposal.changes[1]!.after as { v: number }).v).toBe(4500);
    expect(proposal.expectedSourceRevisions[current.sourceId]).toBe(2);
  });
  it('denies stale target hashes without discarding another edit', async () => {
    const f = fixture(), proposal = await buildDependencyProposal(f.input), draft = artifactDraft(f.document);
    const target = (await draft.target('amount'))!;
    const next = { ...target.value as Record<string, JsonValue>, attrs: { id: 'amount', value: 'Custom price' } };
    await draft.apply([{ targetId: 'amount', op: 'set', beforeHash: target.hash, value: next }], { actorId: actor, at, origin: 'human', reason: 'Custom' });
    await expect(draft.apply(proposal.changes[1]!.operations, { actorId: actor, at, origin: 'import', reason: 'Stale' })).rejects.toMatchObject({ reason: 'before-hash' });
    expect((await draft.target('amount'))!.value).toEqual(next);
  });
  it('rejects graph cycles and follows only reachable targets', () => {
    const f = fixture();
    expect(affectedDependencies(f.input.edges, [{ kind: 'artifact', artifactId: f.table.id, targetElementId: f.price }])).toHaveLength(2);
    expect(affectedDependencies(f.input.edges, [{ kind: 'artifact', artifactId: f.table.id, targetElementId: 'unrelated' }])).toEqual([]);
    f.input.edges[0]!.inputs[0]!.ref = { kind: 'artifact', artifactId: f.document.id, targetElementId: 'amount' };
    expect(() => compileDependencies(f.input.edges)).toThrow('dependency-cycle');
  });
  it('formats exact large and negative fractional money without losing kopeks', () => {
    const money = { kind: 'money-format' as const, input: 'sum', currency: 'KZT', locale: 'en' as const, scale: 2, basis: 'major' as const };
    expect(transformValue(money, new Map([['sum', '9999999999999999.99']]))).toContain('9,999,999,999,999,999.99');
    expect(transformValue(money, new Map([['sum', '-0.50']]))).toContain('-');
    expect(() => transformValue({ kind: 'decimal', operation: 'sum', inputs: ['sum'], scale: 2 }, new Map([['sum', null]]))).toThrow();
  });
  it('keeps units and currency precision when rendering material values in every locale', () => {
    for (const locale of ['ru', 'kk', 'en'] as const) {
      expect(formatMaterialValue({ kind: 'quantity', decimal: '2.5', unit: 'м²' }, locale)).toBe('2.5 м²');
      expect(formatMaterialValue({ kind: 'date', date: '2026-10-15', precision: 'day' }, locale)).toContain('2026');
      expect(formatMaterialValue({ kind: 'money', minorUnits: '125055', currency: 'KZT' }, locale)).toMatch(/55/);
    }
    expect(materialScalar({ kind: 'money', minorUnits: '1250', currency: 'JPY' })).toBe('1250');
    expect(materialScalar({ kind: 'money', minorUnits: '1250', currency: 'KWD' })).toBe('1.250');
  });
  it('does not revive a detached field from an old source edge', async () => {
    const f = fixture();
    f.document.bindings = [];
    const edge: DependencyEdge = { id: randomUUID(), inputs: [{ key: 'value', ref: { kind: 'source', sourceRef: f.sourceRef } }], target: { artifactId: f.document.id, targetElementId: 'amount' }, transform: { kind: 'copy', input: 'value' }, updateMode: 'deterministic', label: 'Detached price' };
    const proposal = await buildDependencyProposal({ ...f.input, edges: [edge], facts: [{ key: dependencyKey({ kind: 'source', sourceRef: f.sourceRef }), state: 'current', value: '9999', sourceRef: f.sourceRef }] });
    expect(proposal.changes[0]!.state).toBe('manual');
    expect(proposal.changes[0]!.operations).toEqual([]);
  });
});
