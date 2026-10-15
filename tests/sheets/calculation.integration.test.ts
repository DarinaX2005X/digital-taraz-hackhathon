import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PreparedCalculationSchema, type PreparedCalculation } from '@/contracts/calculations';
import type { SourceRef } from '@/contracts/artifacts';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { withWorkspaceAccess } from '@/features/identity/server/access';
import { createCalculationService } from '@/features/sheets/server/calculations';
import { createCalculationHandlers } from '@/features/sheets/server/calculation-handlers';
import { createBlankTable, stableCellId } from '@/features/sheets/domain/model';
import { createPendingSource, publishSourceVersion } from '@/features/sources/server/source-heads';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

function table() {
  const content = createBlankTable('Exact total', { rows: 4, columns: 3 }), sheetId = content.workbook.sheetOrder[0]!, sheet = content.workbook.sheets[sheetId]!;
  const id = (row: number, column: number) => stableCellId(content, { sheetId, row, column });
  sheet.cellData = { 0: { 0: { v: 3, t: 2 }, 1: { v: 420, t: 2 }, 2: { f: '=ROUND(A1*B1,2)', v: 999999, t: 2 } }, 1: { 2: { f: '=C1', v: 999999, t: 2 } }, 2: { 2: { f: '=C2', v: 999999, t: 2 } } };
  sheet.calculation = { schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up', lines: [{ id: 'service', quantityCellId: id(0, 0), priceCellId: id(0, 1), amountCellId: id(0, 2), expectedFormula: '=ROUND(A1*B1,2)' }], subtotalCellId: id(1, 2), subtotalFormula: '=C1', totalCellId: id(2, 2), totalFormula: '=C2' };
  return { content, sheetId };
}

function rehash(input: PreparedCalculation): PreparedCalculation {
  input.calculationHash = hashJson({ inputHash: input.inputHash, result: input.result, updates: input.updates } as unknown as JsonValue);
  const unsigned: Partial<PreparedCalculation> = { ...input }; delete unsigned.preparedHash;
  input.preparedHash = hashJson(unsigned as unknown as JsonValue);
  return input;
}

describe('transactional prepared calculation authority', () => {
  it('rejects a fully rehashed forged cached total and writes no revision', async () => {
    const f = await artifactFixture(pool), fixture = table(), created = await f.create(fixture.content, 'Quote'), service = createCalculationService(pool);
    const prepared = await service.prepare(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: 1, baseRevision: 0, sheetId: fixture.sheetId });
    const forged = structuredClone(prepared), total = forged.spec.totalCellId;
    forged.result.values[total] = '1.00'; forged.result.total = '1.00';
    forged.updates.find((update) => update.cellId === total)!.cell.v = '1.00';
    rehash(forged);
    await expect(service.apply(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: 1, prepared: forged, reason: 'Apply forged cache' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read(created.artifact.id)).artifact.currentRevision).toBe(0);
  });

  it('applies the server result once and returns the same receipt for a same-key retry', async () => {
    const f = await artifactFixture(pool), fixture = table(), created = await f.create(fixture.content, 'Quote'), service = createCalculationService(pool);
    const prepared = await service.prepare(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: 1, baseRevision: 0, sheetId: fixture.sheetId });
    const operationId = randomUUID(), input = { workspaceId: f.workspaceId, expectedAuthzVersion: 1, prepared, reason: 'Verify exact total' };
    const first = await service.apply(f.owner, operationId, input), replay = await service.apply(f.owner, operationId, input);
    expect(replay).toEqual(first);
    const opened = await f.read(created.artifact.id);
    expect(opened.artifact.currentRevision).toBe(1);
    expect(JSON.stringify(opened.content)).toContain('1260.00');
  });

  it('rejects a prepared value after the source head advances', async () => {
    const f = await artifactFixture(pool), sourceId = randomUUID(), versionId = randomUUID();
    const sourceRef: SourceRef = { sourceId, sourceVersionId: versionId, revision: 1 };
    await withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, scope: 'edit' }, async (tx, access) => {
      await createPendingSource(tx, access, { sourceId, projectId: f.projectId, accessClass: 'internal' });
      await publishSourceVersion(tx, access, { sourceId, versionId, expectedRevision: 0, snapshotHash: '1'.repeat(64) });
    });
    const fixture = table(), created = await f.service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Bound quote', content: fixture.content, sourceRefs: [sourceRef] }), service = createCalculationService(pool);
    const prepared = await service.prepare(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: 1, baseRevision: 0 });
    await withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, scope: 'edit' }, (tx, access) => publishSourceVersion(tx, access, { sourceId, versionId: randomUUID(), expectedRevision: 1, snapshotHash: '2'.repeat(64) }));
    await expect(service.apply(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: 1, prepared, reason: 'Stale source must fail' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read(created.artifact.id)).artifact.currentRevision).toBe(0);
  });

  it('rechecks project ACL before applying or replaying a prepared calculation', async () => {
    const f = await artifactFixture(pool), fixture = table(), created = await f.create(fixture.content, 'Quote'), service = createCalculationService(pool);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 1 });
    const authz = await currentArtifactAuthz(pool, f.workspaceId);
    const prepared = await service.prepare(f.member, { workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: authz, baseRevision: 0 });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: authz });
    await expect(service.apply(f.member, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: authz, prepared, reason: 'Revoked actor' })).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN|CONFLICT/) });
    expect((await f.read(created.artifact.id)).artifact.currentRevision).toBe(0);
  });

  it('exposes strict no-store prepare/apply handlers without trusting actor or origin headers', async () => {
    const f = await artifactFixture(pool), fixture = table(), created = await f.create(fixture.content, 'HTTP quote'), origin = 'http://127.0.0.1:3000';
    const handlers = createCalculationHandlers({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId }, session: { id: f.owner.sessionId } } as never) });
    const headers = { origin, 'content-type': 'application/json', 'x-tirlik-user-id': f.owner.userId };
    const prepare = await handlers(new Request(`${origin}/api/sheets/calculations/prepare`, { method: 'POST', headers, body: JSON.stringify({ workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: 1, baseRevision: 0 }) }), 'prepare');
    expect(prepare.status).toBe(200); expect(prepare.headers.get('cache-control')).toBe('no-store');
    const prepared = PreparedCalculationSchema.parse(await prepare.json()), key = randomUUID();
    const body = { workspaceId: f.workspaceId, expectedAuthzVersion: 1, prepared, reason: 'Apply checked total' };
    const applied = await handlers(new Request(`${origin}/api/sheets/calculations/apply`, { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify(body) }), 'apply');
    expect(applied.status).toBe(200); expect(applied.headers.get('cache-control')).toBe('no-store');
    const wrongOrigin = await handlers(new Request(`${origin}/api/sheets/calculations/prepare`, { method: 'POST', headers: { ...headers, origin: 'https://other.invalid' }, body: JSON.stringify({ workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: 1, baseRevision: 1 }) }), 'prepare');
    expect(wrongOrigin.status).toBe(403);
    const wrongActor = await handlers(new Request(`${origin}/api/sheets/calculations/prepare`, { method: 'POST', headers: { ...headers, 'x-tirlik-user-id': randomUUID() }, body: JSON.stringify({ workspaceId: f.workspaceId, artifactId: created.artifact.id, expectedAuthzVersion: 1, baseRevision: 1 }) }), 'prepare');
    expect(wrongActor.status).toBe(409);
  });
});
