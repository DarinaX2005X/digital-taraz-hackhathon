import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SourceRef } from '@/contracts/artifacts';
import type { SessionPrincipal } from '@/features/identity/server/access';
import { createDesignImportHandler } from '@/features/design-export/server/import-handler';
import { createDesignPackage } from '@/features/design-export/server/package';
import { digest } from '@/features/design-export/server/assets';
import type { DesignContent } from '@/features/designs/domain/model';
import { createSourceVisualImportAdapter } from '@/features/sources/server/visual-import';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';

const origin = 'http://127.0.0.1:59676';
let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

function actor(principal: SessionPrincipal) {
  return {
    user: { id: principal.userId, name: 'Design importer', email: `${principal.userId}@example.test`, emailVerified: true, locale: 'ru' as const },
    session: { id: principal.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
  };
}

type ImportHandler = ReturnType<typeof createDesignImportHandler>;
const handlerErrors = new WeakMap<ImportHandler, string[]>();
function handler(principal: SessionPrincipal) {
  const errors: string[] = [], value = createDesignImportHandler({ pool, origin, getActor: async () => actor(principal), reportError: (error) => errors.push(error instanceof Error ? error.stack ?? error.message : String(error)) });
  handlerErrors.set(value, errors); return value;
}
function diagnostic(handle: ImportHandler) { return handlerErrors.get(handle)?.at(-1) ?? 'no internal handler error'; }

type ImportAction = 'preview' | 'import';
async function request(
  handle: ImportHandler,
  bytes: Uint8Array,
  input: { workspaceId: string; projectId: string; expectedAuthzVersion: number; action: ImportAction; previewHash?: string; sourcePolicy?: 'preserve' | 'detach'; confirmRights?: boolean },
  operationId = randomUUID(),
  options: { requestOrigin?: string; actorHeader?: string } = {},
) {
  const query = new URLSearchParams({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    expectedAuthzVersion: String(input.expectedAuthzVersion),
    action: input.action,
    sourcePolicy: input.sourcePolicy ?? 'preserve',
    confirmRights: String(input.confirmRights ?? false),
    ...(input.previewHash ? { previewHash: input.previewHash } : {}),
  });
  return handle(new Request(`${origin}/api/designs/import?${query}`, {
    method: 'POST',
    headers: {
      Origin: options.requestOrigin ?? origin,
      'X-Tirlik-User-Id': options.actorHeader ?? actorHeader(handle),
      'Idempotency-Key': operationId,
      'Content-Type': 'application/vnd.tirlik.design+zip',
    },
    body: new Blob([new Uint8Array(bytes)]),
    signal: AbortSignal.timeout(10_000),
  }));
}

// Keep the actor ID beside each handler without weakening the production actor/header check.
const handlerActors = new WeakMap<ImportHandler, string>();
function ownedHandler(principal: SessionPrincipal) {
  const value = handler(principal); handlerActors.set(value, principal.userId); return value;
}
function actorHeader(handle: ImportHandler) {
  const value = handlerActors.get(handle); if (!value) throw new Error('TEST_HANDLER_ACTOR_REQUIRED'); return value;
}

async function portableProject(options: { assetId?: string; sourceRef?: SourceRef; historicalDraftLabel?: string } = {}) {
  const assetId = options.assetId ?? randomUUID();
  const image = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#efca56' } }).png().toBuffer();
  const content: DesignContent = { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 640, height: 480, unit: 'px', background: '#ffffff', layers: [{ id: 'brand-block', type: 'group', transform: { x: 20, y: 18, width: 580, height: 350, rotation: 0 }, style: { opacity: 1 }, layers: [
    { id: 'title', type: 'text', text: 'Қазақша ұсыныс · Предложение', transform: { x: 10, y: 6, width: 560, height: 80, rotation: 0 }, style: { fontFamily: 'Noto Sans', fontSize: 28, fill: '#153e42' } },
    { id: 'photo', type: 'image', assetId, crop: { x: .1, y: .2, width: .8, height: .6 }, transform: { x: 20, y: 122, width: 260, height: 180, rotation: 12 }, style: { opacity: .85 } },
  ] }] }] };
  const provenance = {
    sourceRefs: options.sourceRef ? [options.sourceRef] : [],
    bindings: options.sourceRef ? [{ targetElementId: 'title', sourceRef: options.sourceRef, transformId: 'imported-title', updateMode: 'propose' as const, override: { reason: 'Portable manual wording', actorId: randomUUID(), at: '2026-10-15T00:00:00.000Z' }, lock: { reason: 'Keep the source heading', actorId: randomUUID(), at: '2026-10-15T00:00:00.000Z' } }] : [],
    locks: { 'brand-block': { actorId: randomUUID(), reason: 'Keep the approved composition', at: '2026-10-15T00:00:00.000Z' }, photo: { actorId: randomUUID(), reason: 'Keep the approved crop', at: '2026-10-15T00:00:00.000Z' } },
  };
  const bytes = await createDesignPackage({
    content,
    title: 'Portable proposal',
    locale: 'kk',
    historicalDraftLabel: options.historicalDraftLabel,
    provenance,
    assets: {
      image: async (id) => {
        if (id !== assetId) throw new Error('UNEXPECTED_TEST_ASSET');
        return { bytes: image, sha256: digest(image), mediaType: 'image/png', license: { name: 'Synthetic owned image', embeddingAllowed: true } };
      },
      font: async () => { throw new Error('UNEXPECTED_CUSTOM_FONT'); },
    },
  });
  return { bytes, content, image, assetId, provenance };
}

async function productCounts(workspaceId: string) {
  const row = (await pool.query<{ artifacts: number; sources: number; assets: number }>(`SELECT
    (SELECT count(*)::int FROM artifacts WHERE workspace_id=$1) AS artifacts,
    (SELECT count(*)::int FROM sources WHERE workspace_id=$1) AS sources,
    (SELECT count(*)::int FROM source_assets WHERE workspace_id=$1) AS assets`, [workspaceId])).rows[0]!;
  return row;
}

describe('design import API handler and isolated database boundary', () => {
  it('previews a bounded archive and historical draft without creating product records', async () => {
    const f = await artifactFixture(pool), handle = ownedHandler(f.owner), project = await portableProject({ historicalDraftLabel: 'Тарихи нобай · v7' }), before = await productCounts(f.workspaceId);
    const response = await request(handle, project.bytes, { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: await currentArtifactAuthz(pool, f.workspaceId), action: 'preview' });
    expect(response.status).toBe(200);
    const preview = await response.json() as { previewHash: string; title: string; pageCount: number; assets: unknown[]; sourceCount: number; canPreserveSources: boolean; lockCount: number; historicalDraftLabel?: string; warnings: string[] };
    expect(preview).toMatchObject({ title: 'Portable proposal', pageCount: 1, sourceCount: 0, canPreserveSources: true, lockCount: 2, historicalDraftLabel: 'Тарихи нобай · v7' });
    expect(preview.assets).toHaveLength(2); expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/); expect(preview.warnings).toContain('historical-draft:Тарихи нобай · v7');
    expect(await productCounts(f.workspaceId)).toEqual(before);
  });

  it('imports preserved provenance once and replays the exact result after an uncertain response', async () => {
    const f = await artifactFixture(pool), handle = ownedHandler(f.owner), image = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#efca56' } }).png().toBuffer();
    const importedSource = await createSourceVisualImportAdapter(pool).import(f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, operationId: randomUUID(), name: 'approved.png', format: 'png', sha256: digest(image), license: { permission: 'confirmed', canEmbed: true, label: 'Synthetic owned image' }, accessClass: 'internal', bytes: image });
    const sourceRef: SourceRef = { sourceId: importedSource.sourceId, sourceVersionId: importedSource.sourceVersionId, revision: 1 };
    const project = await portableProject({ assetId: importedSource.assetId, sourceRef }), before = await productCounts(f.workspaceId), authz = await currentArtifactAuthz(pool, f.workspaceId);
    const previewResponse = await request(handle, project.bytes, { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: authz, action: 'preview' });
    const preview = await previewResponse.json() as { previewHash: string; canPreserveSources: boolean; lockCount: number };
    expect(previewResponse.status).toBe(200); expect(preview.canPreserveSources).toBe(true); expect(preview.lockCount).toBe(3);
    const operationId = randomUUID(), importInput = { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: authz, action: 'import' as const, previewHash: preview.previewHash, sourcePolicy: 'preserve' as const, confirmRights: true };
    const firstResponse = await request(handle, project.bytes, importInput, operationId), first = await firstResponse.json() as { artifactId: string; projectId: string; revision: number; detachedSources: number };
    const replayResponse = await request(handle, project.bytes, importInput, operationId), replay = await replayResponse.json();
    expect(firstResponse.status, `${diagnostic(handle)}\nresponse=${JSON.stringify(first)}`).toBe(201); expect(replayResponse.status, `${diagnostic(handle)}\nresponse=${JSON.stringify(replay)}`).toBe(201); expect(replay).toEqual(first); expect(first).toMatchObject({ projectId: f.projectId, revision: 1, detachedSources: 0 });
    const snapshot = await f.read(first.artifactId); expect(snapshot.artifact.sourceRefs).toEqual([sourceRef]); expect(snapshot.artifact.bindings).toEqual([{ targetElementId: 'title', sourceRef, transformId: 'imported-title', updateMode: 'propose' }]);
    expect(snapshot.locks?.photo).toMatchObject({ actorId: f.owner.userId, reason: 'Keep the approved crop' }); expect(snapshot.locks?.title).toMatchObject({ actorId: f.owner.userId, reason: 'Keep the source heading' }); expect(snapshot.locks?.['brand-block']).toMatchObject({ actorId: f.owner.userId, reason: 'Keep the approved composition' }); expect(snapshot.history.some((group) => group.origin === 'import')).toBe(true);
    expect(snapshot.content.kind).toBe('design'); if (snapshot.content.kind !== 'design') throw new Error('EXPECTED_DESIGN');
    const group = snapshot.content.pages[0]!.layers[0]!, originalGroup = project.content.pages[0]!.layers[0]!; expect(group.id).toBe('brand-block'); expect(group.layers?.map((layer) => layer.id)).toEqual(['title', 'photo']); const photo=group.layers![1]!,originalPhoto=originalGroup.layers![1]!;expect(photo.crop).toEqual(originalPhoto.crop);expect(photo.style).toEqual(originalPhoto.style);expect(photo.assetId).not.toBe(project.assetId);
    const after = await productCounts(f.workspaceId); expect(after).toEqual({ artifacts: before.artifacts + 1, sources: before.sources + 1, assets: before.assets + 1 });
  });

  it('keeps deterministic failures write-free and allows the same operation to detach inaccessible sources', async () => {
    const f = await artifactFixture(pool), handle = ownedHandler(f.owner), external: SourceRef = { sourceId: randomUUID(), sourceVersionId: randomUUID(), revision: 1 }, project = await portableProject({ sourceRef: external }), before = await productCounts(f.workspaceId), authz = await currentArtifactAuthz(pool, f.workspaceId);
    const previewResponse = await request(handle, project.bytes, { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: authz, action: 'preview' }), preview = await previewResponse.json() as { previewHash: string; canPreserveSources: boolean };
    expect(previewResponse.status).toBe(200); expect(preview.canPreserveSources).toBe(false);
    const operationId = randomUUID(), base = { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: authz, action: 'import' as const, previewHash: preview.previewHash };
    expect((await request(handle, project.bytes, { ...base, sourcePolicy: 'detach', confirmRights: false }, operationId)).status).toBe(422);
    expect((await request(handle, project.bytes, { ...base, previewHash: '0'.repeat(64), sourcePolicy: 'detach', confirmRights: true }, operationId)).status).toBe(409);
    expect((await request(handle, project.bytes, { ...base, sourcePolicy: 'preserve', confirmRights: true }, operationId)).status).toBe(422);
    expect(await productCounts(f.workspaceId)).toEqual(before);
    const detachedResponse = await request(handle, project.bytes, { ...base, sourcePolicy: 'detach', confirmRights: true }, operationId), detached = await detachedResponse.json() as { artifactId: string; revision: number; detachedSources: number };
    expect(detachedResponse.status, `${diagnostic(handle)}\nresponse=${JSON.stringify(detached)}`).toBe(201); expect(detached).toMatchObject({ revision: 1, detachedSources: 1 });
    const snapshot = await f.read(detached.artifactId); expect(snapshot.artifact.sourceRefs).toEqual([]); expect(snapshot.artifact.bindings).toEqual([]); expect(snapshot.locks?.photo?.actorId).toBe(f.owner.userId); expect(snapshot.locks?.title).toMatchObject({ actorId: f.owner.userId, reason: 'Keep the source heading' }); expect(snapshot.locks?.['brand-block']?.actorId).toBe(f.owner.userId);
    const after = await productCounts(f.workspaceId); expect(after).toEqual({ artifacts: before.artifacts + 1, sources: before.sources + 1, assets: before.assets + 1 });
  });

  it('rejects foreign project access, origin and actor headers before product writes', async () => {
    const f = await artifactFixture(pool), project = await portableProject(), owner = ownedHandler(f.owner), member = ownedHandler(f.member), before = await productCounts(f.workspaceId), input = { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: await currentArtifactAuthz(pool, f.workspaceId), action: 'preview' as const };
    expect((await request(owner, project.bytes, input, randomUUID(), { requestOrigin: 'http://evil.invalid' })).status).toBe(403);
    expect((await request(owner, project.bytes, input, randomUUID(), { actorHeader: f.member.userId })).status).toBe(409);
    expect((await request(member, project.bytes, input)).status).toBe(404);
    expect(await productCounts(f.workspaceId)).toEqual(before);
  });
});
