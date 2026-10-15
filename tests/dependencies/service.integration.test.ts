import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DependencyEdge } from '../../src/contracts/dependencies';
import { createArtifactTargetResolver, tableCellTargetId } from '../../src/features/artifacts/domain/targets';
import { createDependencyService } from '../../src/features/dependencies/server/service';
import { createDependencyHandlers } from '../../src/features/dependencies/server/handlers';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
async function setup() {
  const base = await artifactFixture(pool), service = createDependencyService(pool);
  const table = await base.create({ kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Estimate', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Estimate', rowCount: 1, columnCount: 3, cellData: { '0': { '0': { v: 1500, t: 2 }, '1': { v: 3, t: 2 }, '2': { v: 3000, t: 2, f: '=A1*B1' } } } } } }, stableIds: { sheet: { rows: ['service'], columns: ['price', 'quantity', 'total'] } } }, 'Estimate');
  const document = await base.create({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'manual' }, content: [{ type: 'text', text: 'My personally agreed delivery date.' }] }, { type: 'paragraph', attrs: { id: 'amount-line' }, content: [{ type: 'dataField', attrs: { id: 'amount', value: '3000' } }] }] } }, 'Offer');
  const price = tableCellTargetId('sheet', 'service', 'price'), quantity = tableCellTargetId('sheet', 'service', 'quantity'), total = tableCellTargetId('sheet', 'service', 'total');
  const edges: DependencyEdge[] = [
    { id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: price } }, { key: 'qty', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: quantity } }], target: { artifactId: table.artifact.id, targetElementId: total }, transform: { kind: 'decimal', operation: 'product', inputs: ['price', 'qty'], scale: 2 }, updateMode: 'deterministic', label: 'Line total' },
    { id: randomUUID(), inputs: [{ key: 'total', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: total } }], target: { artifactId: document.artifact.id, targetElementId: 'amount' }, transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'ru', scale: 2, basis: 'major' }, updateMode: 'propose', label: 'Offer total' },
  ];
  const input = { workspaceId: base.workspaceId, projectId: base.projectId, expectedAuthzVersion: await currentArtifactAuthz(pool, base.workspaceId) };
  await service.register(base.owner, randomUUID(), { ...input, edges });
  return { ...base, dependencies: service, input, edges, tableId: table.artifact.id, documentId: document.artifact.id, price, total };
}
describe('authorized linked-change transactions', () => {
  it('accepts table/document changes atomically, replays once, reopens, and undoes through canonical history', async () => {
    const f = await setup(), before = await f.read(f.documentId), proposal = await f.dependencies.prepare(f.owner, randomUUID(), f.input);
    expect(proposal.proposal.changes.map((change) => change.state)).toEqual(['ready', 'ready']);
    const key = randomUUID(), review = { ...f.input, expectedRevision: proposal.revision, groupIds: [proposal.proposal.changes[0]!.groupId] };
    const accepted = await f.dependencies.review(f.owner, key, proposal.id, 'accept', review);
    expect(accepted.receipt?.artifacts).toHaveLength(2);
    expect(await f.dependencies.review(f.owner, key, proposal.id, 'accept', review)).toEqual(accepted);
    const after = await f.read(f.documentId), resolver = createArtifactTargetResolver(after.content);
    expect(JSON.stringify(resolver('amount')!.value)).toContain('500');
    expect(resolver('manual')!.value).toEqual(createArtifactTargetResolver(before.content)('manual')!.value);
    expect((await f.dependencies.changeset(f.owner, proposal.id, { workspaceId: f.workspaceId, projectId: f.projectId })).state).toBe('applied');
    await f.service.undo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, commandGroupId: randomUUID(), targetCommandGroupId: accepted.receipt!.commandGroupId, expectedArtifactRevisions: accepted.receipt!.committedRevisionVector, expectedSourceRevisions: {} });
    expect((await f.read(f.documentId)).content).toEqual(before.content);
    expect(createArtifactTargetResolver((await f.read(f.tableId)).content)(f.total)!.value).toMatchObject({ v: 3000, f: '=A1*B1' });
  });
  it('rejects stale upstream revisions before writing any downstream field', async () => {
    const f = await setup(), proposed = await f.dependencies.prepare(f.owner, randomUUID(), f.input), table = await f.read(f.tableId);
    const target = createArtifactTargetResolver(table.content)(f.price)!;
    await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [f.tableId]: table.artifact.currentRevision }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: f.tableId, baseRevision: table.artifact.currentRevision, kind: 'table', expectedSourceRevisions: {}, reason: 'New price', operations: [{ targetId: f.price, op: 'set', value: { v: 2000, t: 2 }, beforeHash: target.hash }] }] } });
    await expect(f.dependencies.review(f.owner, randomUUID(), proposed.id, 'accept', { ...f.input, expectedRevision: proposed.revision, groupIds: [proposed.proposal.changes[0]!.groupId] })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read(f.documentId)).artifact.currentRevision).toBe(0);
    expect((await f.dependencies.changeset(f.owner, proposed.id, { workspaceId: f.workspaceId, projectId: f.projectId })).revision).toBe(0);
  });
  it('does not expose graphs or saved previews after project access is absent', async () => {
    const f = await setup(), proposed = await f.dependencies.prepare(f.owner, randomUUID(), f.input);
    await expect(f.dependencies.read(f.member, { workspaceId: f.workspaceId, projectId: f.projectId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.dependencies.changeset(f.member, proposed.id, { workspaceId: f.workspaceId, projectId: f.projectId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('restores the prior graph mapping when the canonical binding group is undone and redone', async () => {
    const f = await setup(), before = await f.read(f.documentId), target = createArtifactTargetResolver(before.content)('amount')!;
    const updated: DependencyEdge = { ...f.edges[1]!, id: randomUUID(), transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'en', scale: 2, basis: 'major' } };
    const applied = await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, group: { commandGroupId: randomUUID(), dependencyEdges: [updated], expectedArtifactRevisions: { [f.documentId]: before.artifact.currentRevision }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: f.documentId, baseRevision: before.artifact.currentRevision, kind: 'document', expectedSourceRevisions: {}, reason: 'Change linked currency display', operations: [{ targetId: 'amount', op: 'set', value: target.value, beforeHash: target.hash }] }] } });
    const graph = () => f.dependencies.read(f.owner, { workspaceId: f.workspaceId, projectId: f.projectId });
    expect((await graph()).edges.find((edge) => edge.target.artifactId === f.documentId)).toEqual(updated);
    const undo = await f.service.undo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, commandGroupId: randomUUID(), targetCommandGroupId: applied.commandGroupId, expectedArtifactRevisions: applied.committedRevisionVector, expectedSourceRevisions: {} });
    expect((await graph()).edges.find((edge) => edge.target.artifactId === f.documentId)).toEqual(f.edges[1]);
    await f.service.redo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, commandGroupId: randomUUID(), targetCommandGroupId: applied.commandGroupId, expectedArtifactRevisions: undo.committedRevisionVector, expectedSourceRevisions: {} });
    expect((await graph()).edges.find((edge) => edge.target.artifactId === f.documentId)).toEqual(updated);
  });
  it('enforces origin, actor and strict query shape at the HTTP handler', async () => {
    const f = await setup(), origin = 'http://127.0.0.1:3000';
    const handlers = createDependencyHandlers({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId }, session: { id: f.owner.sessionId } } as never) });
    const headers = { 'x-tirlik-user-id': f.owner.userId, 'content-type': 'application/json', 'idempotency-key': randomUUID(), origin };
    const create = await handlers.handle(new Request(`${origin}/api/changesets`, { method: 'POST', headers, body: JSON.stringify(f.input) }));
    expect(create.status).toBe(201); expect(create.headers.get('cache-control')).toBe('no-store');
    const badOrigin = await handlers.handle(new Request(`${origin}/api/changesets`, { method: 'POST', headers: { ...headers, origin: 'https://other.invalid' }, body: JSON.stringify(f.input) }));
    expect(badOrigin.status).toBe(403);
    const mismatch = await handlers.handle(new Request(`${origin}/api/dependencies?workspaceId=${f.workspaceId}&projectId=${f.projectId}`, { headers: { 'x-tirlik-user-id': randomUUID() } }));
    expect(mismatch.status).toBe(409);
    const extra = await handlers.handle(new Request(`${origin}/api/dependencies?workspaceId=${f.workspaceId}&projectId=${f.projectId}&debug=1`, { headers }));
    expect(extra.status).toBe(422);
  });
});
