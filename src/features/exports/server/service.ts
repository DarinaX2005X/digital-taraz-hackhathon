import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import JSZip from 'jszip';
import { IdSchema } from '../../../contracts/primitives';
import { hashJson } from '../../artifacts/domain/canonical';
import type { ArtifactContent, JsonValue } from '../../artifacts/domain/content-models';
import { createArtifactService } from '../../artifacts/server/service';
import { loadArtifact } from '../../artifacts/server/service-support';
import { assertAuthzVersion, identityTransaction, withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { hasScope } from '../../identity/domain/policy';
import { IdentityError, validate } from '../../identity/server/http';
import { assertSourceReadAccess } from '../../sources/server/source-heads';
import { CreateExportSchema, type CreateExport, type ExportJob } from '../contracts';
import { ExportRegistry } from './registry';
import { EXPORT_MAX_BYTES, LocalExportStorage } from './storage';
import { authorizeExportResources, resourcesForExport } from './resources';
import type { ExportAssets, ExportInputManifest, FrozenItem, FrozenOutput, PlanExportResources, PlanResourceRef, StoredFile } from './types';

interface StoredBundle { fileName: string; sha256: string; byteSize: number; storageKey: string }
interface JobRow { id: string; workspace_id: string; created_by: string; operation_id: string; body_hash: string; input_manifest: ExportInputManifest; input_hash: string; status: ExportJob['status']; files: StoredFile[]; final_manifest: { bundle?: StoredBundle } | null; final_hash: string | null; lease_id: string | null; lease_expires_at: Date | null; created_at: Date; deleted_at: Date | null }
const hash = (value: unknown) => hashJson(JSON.parse(JSON.stringify(value)) as JsonValue);
const fail = (key: string, code: ConstructorParameters<typeof IdentityError>[0] = 'CONFLICT') => new IdentityError(code, `exports.errors.${key}`);
const safeName = (title: string) => title.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 110) || 'export';
const dto = (row: JobRow, authzVersion: number): ExportJob => ({ id: row.id, workspaceId: row.workspace_id, createdAt: row.created_at.toISOString(), historicalDraft: row.input_manifest.historicalDraft, locale: row.input_manifest.locale, privateFieldsPolicy: row.input_manifest.privateFieldsPolicy ?? 'exclude-internal', ...(row.input_manifest.release ? { release: row.input_manifest.release } : {}), revisions: row.input_manifest.items.map((item) => ({ artifactId: item.artifactId, revision: item.revision })), status: row.status, files: row.files.map(({ storageKey, ...file }) => { void storageKey; return file; }), ...(row.final_manifest?.bundle ? { bundle: { fileName: row.final_manifest.bundle.fileName, sha256: row.final_manifest.bundle.sha256, byteSize: row.final_manifest.bundle.byteSize } } : {}), ...(row.final_hash ? { manifestHash: row.final_hash } : {}), authzVersion, ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at.toISOString() } : {}) });
export function createExportService(options: { pool: Pool; registry: ExportRegistry; storage?: LocalExportStorage; assets: (principal: IdentityPrincipal, workspaceId: string) => ExportAssets; resolvePlanResources?: (tx: PoolClient, access: WorkspaceAccess, content: Extract<ArtifactContent, { kind: 'plan' }>) => Promise<PlanExportResources>; authorizePlanResources?: (tx: PoolClient, access: WorkspaceAccess, resources: readonly PlanResourceRef[]) => Promise<void> }) {
  const { pool, registry } = options, storage = options.storage ?? new LocalExportStorage(), artifacts = createArtifactService(pool);
  async function queueUnusedFile(workspaceId: string, jobId: string, storageKey: string) {
    // A COMMIT response can be lost after the receipt was saved. Lock and inspect
    // the durable row before scheduling any removal of the newly written bytes.
    await identityTransaction(pool, async (tx) => {
      const saved = (await tx.query<JobRow>('SELECT * FROM export_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspaceId, jobId])).rows[0];
      if (saved && !saved.deleted_at && (saved.files.some((file) => file.status === 'ready' && file.storageKey === storageKey) || saved.final_manifest?.bundle?.storageKey === storageKey)) return;
      if (saved) await tx.query('INSERT INTO export_file_cleanup(storage_key,workspace_id,job_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [storageKey, workspaceId, jobId]);
    });
  }
  async function authorize(tx: PoolClient, access: WorkspaceAccess, manifest: ExportInputManifest, principal: IdentityPrincipal) {
    if (manifest.privateFieldsPolicy === 'include-authorized' && !hasScope(access.membership, 'read-confidential')) throw fail('notFound', 'NOT_FOUND');
    for (const item of [...manifest.items].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
      const authorized = await loadArtifact(tx, access, item.artifactId, { scope: 'export', ...(manifest.release ? { expectedProjectId: manifest.release.projectId } : {}) });
      if (manifest.privateFieldsPolicy === 'include-authorized' && !hasScope({ ...authorized.access.membership, projectScopes: authorized.access.projectScopes }, 'read-confidential')) throw fail('notFound', 'NOT_FOUND');
    }
    for (const item of [...manifest.items].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) await assertSourceReadAccess(tx, access, item.sourceRefs);
    const resources = [...new Map(manifest.items.flatMap((item) => item.resourceRefs ?? []).map((resource) => [`${resource.kind}:${resource.id}`, resource])).values()];
    await authorizeExportResources(options.assets(principal, access.workspace.id), resources);
    const planResources = [...new Set(manifest.items.flatMap((item) => item.planResources?.resources.map((resource) => resource.resourceId) ?? []))].sort().map((resourceId) => ({ resourceId }));
    if (planResources.length) { if (!options.authorizePlanResources) throw fail('notFound', 'NOT_FOUND'); await options.authorizePlanResources(tx, access, planResources); }
  }
  async function row(tx: PoolClient, access: WorkspaceAccess, principal: IdentityPrincipal, id: string, lock = false): Promise<JobRow> {
    const saved = (await tx.query<JobRow>(`SELECT * FROM export_jobs WHERE workspace_id=$1 AND id=$2 AND created_by=$3 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [access.workspace.id, validate(IdSchema, id), access.userId])).rows[0];
    if (!saved) throw fail('notFound', 'NOT_FOUND');
    if (hash(saved.input_manifest) !== saved.input_hash) throw fail('integrity', 'UNAVAILABLE');
    await authorize(tx, access, saved.input_manifest, principal); return saved;
  }
  async function create(principal: IdentityPrincipal, operationId: string, input: CreateExport) {
    const body = validate(CreateExportSchema, input); validate(IdSchema, operationId);
    const { expectedAuthzVersion, ...selection } = body, bodyHash = hash(selection);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'export' }, async (tx, access) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`export:${body.workspaceId}:${access.userId}:${operationId}`]);
      const previous = (await tx.query<JobRow>('SELECT * FROM export_jobs WHERE workspace_id=$1 AND created_by=$2 AND operation_id=$3', [body.workspaceId, access.userId, operationId])).rows[0];
      if (previous) { if (previous.body_hash !== bodyHash) throw fail('idempotencyConflict'); if (previous.deleted_at) throw fail('notFound', 'NOT_FOUND'); await authorize(tx, access, previous.input_manifest, principal); return dto(previous, access.workspace.authz_version); }
      assertAuthzVersion(access, expectedAuthzVersion);
      if (body.privateFieldsPolicy === 'include-authorized' && !hasScope(access.membership, 'read-confidential')) throw fail('notFound', 'NOT_FOUND');
      const id = randomUUID(), createdAt = new Date().toISOString(), items: FrozenItem[] = [], outputs: FrozenOutput[] = [];
      // Stable lock order prevents a multi-artifact export from racing a grouped edit.
      for (const selected of [...body.items].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
        const authorized = await loadArtifact(tx, access, selected.artifactId, { scope: 'export', ...(body.release ? { expectedProjectId: body.release.projectId } : {}) });
        if (body.privateFieldsPolicy === 'include-authorized' && !hasScope({ ...authorized.access.membership, projectScopes: authorized.access.projectScopes }, 'read-confidential')) throw fail('notFound', 'NOT_FOUND');
      }
      for (const selected of body.items) {
        const detail = await artifacts.versionInTransaction(tx, principal, { workspaceId: body.workspaceId, artifactId: selected.artifactId, revision: selected.revision });
        await assertSourceReadAccess(tx, access, detail.artifact.sourceRefs);
        const resourceRefs = resourcesForExport(detail.content, selected.options);
        await authorizeExportResources(options.assets(principal, body.workspaceId), resourceRefs);
        const historical = detail.headRevision !== selected.revision || detail.sourceFreshness.some((source) => source.status !== 'current') || Boolean(detail.missingTargets?.length);
        if (historical && !body.historicalDraft) throw fail('historicalConsent');
        if (detail.artifact.status === 'trashed') throw fail('notFound', 'NOT_FOUND');
        if (selected.formats.some((format) => !registry.supports(detail.content.kind, format))) throw fail('formatUnavailable', 'VALIDATION_FAILED');
        if (detail.content.kind === 'table' && selected.formats.includes('csv') && detail.content.workbook.sheetOrder.length > 1 && !selected.options.sheetId) throw fail('sheetRequired', 'VALIDATION_FAILED');
        if (detail.content.kind === 'table' && selected.options.sheetId && !detail.content.workbook.sheets[selected.options.sheetId]) throw fail('sheetRequired', 'VALIDATION_FAILED');
        const itemIndex = items.length;
        const planResources = detail.content.kind === 'plan' && options.resolvePlanResources ? await options.resolvePlanResources(tx, access, detail.content) : undefined;
        if (detail.content.kind === 'plan' && !planResources && detail.content.entries.some((entry) => entry.resourceIds.length)) throw fail('resourceUnavailable', 'UNAVAILABLE');
        items.push({ artifactId: selected.artifactId, versionId: detail.version.id, revision: selected.revision, snapshotHash: detail.version.snapshotHash, contentHash: detail.version.contentRef.hash, title: detail.version.title, kind: detail.content.kind, options: selected.options, sourceRefs: detail.artifact.sourceRefs, resourceRefs, bindings: detail.artifact.bindings, locks: detail.locks, ...(planResources ? { planResources } : {}) });
        const label = `${safeName(detail.version.title)}-v${selected.revision}${body.historicalDraft ? '-draft' : ''}`;
        for (const format of selected.formats) {
          if (detail.content.kind === 'design' && ['png', 'jpeg'].includes(format)) {
            const availablePages = detail.content.pages, pages = selected.options.pageIds ?? availablePages.map((page) => page.id);
            if (pages.some((pageId) => !availablePages.some((page) => page.id === pageId))) throw fail('pageUnavailable', 'VALIDATION_FAILED');
            for (let i = 0; i < pages.length; i++) outputs.push({ id: randomUUID(), itemIndex, format, fileName: `${label}-${i + 1}.${format === 'jpeg' ? 'jpg' : format}`, pageId: pages[i]! });
          } else outputs.push({ id: randomUUID(), itemIndex, format, fileName: `${label}.${format}` });
        }
      }
      if (outputs.length > 200) throw fail('tooManyFiles', 'VALIDATION_FAILED');
      const privateFieldsPolicyHash = hash({ version: 1, policy: body.privateFieldsPolicy });
      const manifest: ExportInputManifest = { version: 2, exporterVersion: 'tirlik-export-2', locale: body.locale, historicalDraft: body.historicalDraft, privateFieldsPolicy: body.privateFieldsPolicy, privateFieldsPolicyHash, ...(body.release ? { release: body.release } : {}), createdAt, items, outputs };
      const files: StoredFile[] = outputs.map((output) => ({ id: output.id, artifactId: items[output.itemIndex]!.artifactId, revision: items[output.itemIndex]!.revision, format: output.format, fileName: output.fileName, status: 'pending', warnings: [] }));
      const saved = (await tx.query<JobRow>('INSERT INTO export_jobs(id,workspace_id,created_by,operation_id,body_hash,input_manifest,input_hash,files,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [id, body.workspaceId, access.userId, operationId, bodyHash, JSON.stringify(manifest), hash(manifest), JSON.stringify(files), createdAt])).rows[0]!;
      for (const item of items) await tx.query("INSERT INTO artifact_version_pins(id,workspace_id,artifact_id,revision,kind,retainer_id) VALUES($1,$2,$3,$4,'export',$5)", [randomUUID(), body.workspaceId, item.artifactId, item.revision, id]);
      return dto(saved, access.workspace.authz_version);
    });
  }
  async function read(principal: IdentityPrincipal, workspaceId: string, id: string) { return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export' }, async (tx, access) => dto(await row(tx, access, principal, id), access.workspace.authz_version)); }
  async function list(principal: IdentityPrincipal, workspaceId: string, artifactId: string) {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export' }, async (tx, access) => {
      await loadArtifact(tx, access, artifactId, { scope: 'export' });
      const candidates = (await tx.query<JobRow>("SELECT * FROM export_jobs WHERE workspace_id=$1 AND created_by=$2 AND deleted_at IS NULL AND input_manifest->'items' @> $3::jsonb ORDER BY created_at DESC,id DESC LIMIT 30", [workspaceId, access.userId, JSON.stringify([{ artifactId }])])).rows;
      const jobs: ExportJob[] = [];
      for (const job of candidates) { try { await authorize(tx, access, job.input_manifest, principal); jobs.push(dto(job, access.workspace.authz_version)); } catch (error) { if (!(error instanceof IdentityError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error; } }
      return { jobs, authzVersion: access.workspace.authz_version };
    });
  }
  async function render(principal: IdentityPrincipal, workspaceId: string, id: string, expectedAuthzVersion: number, signal?: AbortSignal) {
    const leaseId = randomUUID();
    const acquired = await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
      const saved = await row(tx, access, principal, id, true);
      if (saved.status === 'ready') return { saved, ready: true };
      if (saved.status === 'rendering' && saved.lease_expires_at && saved.lease_expires_at.getTime() > Date.now()) throw fail('alreadyRendering');
      const next = (await tx.query<JobRow>("UPDATE export_jobs SET status='rendering',lease_id=$3,lease_expires_at=now()+interval '10 minutes',updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *", [workspaceId, id, leaseId])).rows[0]!;
      return { saved: next, ready: false };
    });
    if (acquired.ready) return read(principal, workspaceId, id);
    const frozen = acquired.saved.input_manifest, assets = options.assets(principal, workspaceId);
    let bundle: StoredBundle | undefined;
    try {
      for (const output of frozen.outputs) {
        signal?.throwIfAborted();
        if (acquired.saved.files.find((file) => file.id === output.id)?.status === 'ready') continue;
        const item = frozen.items[output.itemIndex]!;
        let stored: Awaited<ReturnType<LocalExportStorage['write']>> | undefined;
        try {
          const detail = await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
            const current = await row(tx, access, principal, id); if (current.lease_id !== leaseId) throw fail('cancelled');
            const pinned = await artifacts.versionInTransaction(tx, principal, { workspaceId, artifactId: item.artifactId, revision: item.revision });
            if (pinned.version.id !== item.versionId || pinned.version.snapshotHash !== item.snapshotHash || pinned.version.contentRef.hash !== item.contentHash) throw fail('integrity', 'UNAVAILABLE'); return pinned;
          });
          const rendered = await registry.render({ content: detail.content, artifactId: item.artifactId, provenance: { sourceRefs: item.sourceRefs, bindings: item.bindings ?? [], locks: item.locks }, planResources: item.planResources, title: item.title, format: output.format, locale: frozen.locale, options: item.options, privateFieldsPolicy: frozen.privateFieldsPolicy ?? 'exclude-internal', historicalDraft: frozen.historicalDraft, revision: item.revision, createdAt: frozen.createdAt, pageId: output.pageId, assets, signal });
          signal?.throwIfAborted(); stored = await storage.write(workspaceId, id, rendered.bytes);
          await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
            const current = await row(tx, access, principal, id, true); if (current.lease_id !== leaseId) throw fail('cancelled');
            const files = current.files.map((file) => file.id === output.id ? { id: file.id, artifactId: file.artifactId, revision: file.revision, format: file.format, fileName: file.fileName, status: 'ready' as const, storageKey: stored!.key, sha256: stored!.sha256, byteSize: stored!.byteSize, mediaType: rendered.mediaType, warnings: rendered.warnings } : file);
            await tx.query("UPDATE export_jobs SET files=$3,lease_expires_at=now()+interval '10 minutes',updated_at=now() WHERE workspace_id=$1 AND id=$2", [workspaceId, id, JSON.stringify(files)]);
          });
          stored = undefined;
        } catch (error) {
          if (stored) await queueUnusedFile(workspaceId, id, stored.key).catch(() => undefined);
          if (signal?.aborted || (error instanceof IdentityError && ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code))) throw error;
          await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
            const current = await row(tx, access, principal, id, true); if (current.lease_id !== leaseId) throw fail('cancelled');
            const errorKey = error instanceof IdentityError && error.messageKey.startsWith('exports.errors.') ? error.messageKey : 'exports.errors.renderFailed';
            const files = current.files.map((file) => file.id === output.id && file.status !== 'ready' ? { ...file, status: 'failed' as const, errorKey } : file);
            await tx.query('UPDATE export_jobs SET files=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [workspaceId, id, JSON.stringify(files)]);
          });
        }
      }
      const finished = await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => { const current = await row(tx, access, principal, id); if (current.lease_id !== leaseId) throw fail('cancelled'); return current; });
      if (finished.files.every((file) => file.status === 'ready')) {
        if (finished.files.reduce((sum, file) => sum + (file.byteSize ?? 0), 0) > EXPORT_MAX_BYTES) throw fail('bundleTooLarge', 'PAYLOAD_TOO_LARGE');
        const zip = new JSZip(), date = new Date(frozen.createdAt), publicFiles = dto(finished, expectedAuthzVersion).files;
        const privateFieldsPolicy = frozen.privateFieldsPolicy ?? 'exclude-internal', privateFieldsPolicyHash = frozen.privateFieldsPolicyHash ?? hash({ version: 1, policy: privateFieldsPolicy });
        zip.file('manifest.json', JSON.stringify({ schemaVersion: 1, kind: 'tirlik-fixed-export-bundle', createdAt: frozen.createdAt, locale: frozen.locale, historicalDraft: frozen.historicalDraft, privateFieldsPolicy, privateFieldsPolicyHash, ...(frozen.release ? { release: frozen.release } : {}), revisions: frozen.items.map((item) => ({ artifactId: item.artifactId, versionId: item.versionId, revision: item.revision, snapshotHash: item.snapshotHash, contentHash: item.contentHash, kind: item.kind, sourceVersions: item.sourceRefs })), inputHash: finished.input_hash, files: publicFiles }, null, 2), { date });
        for (const file of finished.files) {
          signal?.throwIfAborted();
          if (!file.storageKey || !file.sha256 || !file.byteSize) throw fail('integrity', 'UNAVAILABLE');
          const bytes = await storage.read(file.storageKey, { sha256: file.sha256, byteSize: file.byteSize });
          zip.file(`files/${file.id}/${file.fileName}`, bytes, { date, binary: true });
        }
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        signal?.throwIfAborted();
        const storedBundle = await storage.write(workspaceId, id, bytes);
        bundle = { fileName: `Tirlik-${frozen.createdAt.slice(0, 10)}-${id.slice(0, 8)}${frozen.historicalDraft ? '-draft' : ''}.zip`, sha256: storedBundle.sha256, byteSize: storedBundle.byteSize, storageKey: storedBundle.key };
        signal?.throwIfAborted();
      }
      return await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
        const current = await row(tx, access, principal, id, true); if (current.lease_id !== leaseId) throw fail('cancelled');
        const ready = current.files.filter((file) => file.status === 'ready').length, status = ready === current.files.length ? 'ready' : ready ? 'partial' : 'failed';
        const final = status === 'ready' ? { input: frozen, inputHash: current.input_hash, files: dto(current, access.workspace.authz_version).files, bundle } : null;
        const saved = (await tx.query<JobRow>('UPDATE export_jobs SET status=$3,final_manifest=$4,final_hash=$5,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *', [workspaceId, id, status, final ? JSON.stringify(final) : null, final ? hash(final) : null])).rows[0]!;
        return dto(saved, access.workspace.authz_version);
      });
    } catch (error) {
      if (bundle) await queueUnusedFile(workspaceId, id, bundle.storageKey).catch(() => undefined);
      // No content is disclosed or published here; only the expired worker's lease is released.
      await pool.query("UPDATE export_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(files) f WHERE f->>'status'='ready') THEN 'partial' ELSE 'failed' END,lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND lease_id=$3", [workspaceId, id, leaseId]);
      throw error;
    }
  }
  async function cancel(principal: IdentityPrincipal, workspaceId: string, id: string, expectedAuthzVersion: number) {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
      const current = await row(tx, access, principal, id, true); if (current.status === 'ready' || current.status === 'cancelled') return dto(current, access.workspace.authz_version);
      return dto((await tx.query<JobRow>("UPDATE export_jobs SET status='cancelled',lease_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *", [workspaceId, id])).rows[0]!, access.workspace.authz_version);
    });
  }
  async function download(principal: IdentityPrincipal, workspaceId: string, id: string, fileId: string) {
    const get = () => withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export' }, async (tx, access) => { const current = await row(tx, access, principal, id), file = current.files.find((file) => file.id === fileId); if (!file || file.status !== 'ready' || !file.storageKey || !file.sha256 || !file.byteSize || !file.mediaType) throw fail('notFound', 'NOT_FOUND'); return file as StoredFile & { storageKey: string; sha256: string; byteSize: number; mediaType: string }; });
    const file = await get(), bytes = await storage.read(file.storageKey, file); const current = await get();
    if (file.sha256 !== current.sha256 || file.storageKey !== current.storageKey) throw fail('integrity', 'UNAVAILABLE');
    return { bytes, fileName: file.fileName, mediaType: file.mediaType, sha256: file.sha256 };
  }
  async function remove(principal: IdentityPrincipal, workspaceId: string, id: string, expectedAuthzVersion: number) {
    await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export', expectedAuthzVersion }, async (tx, access) => {
      const current = await row(tx, access, principal, id, true);
      if (current.status === 'rendering') throw fail('cancelBeforeDelete');
      for (const file of current.files) if (file.storageKey) await tx.query('INSERT INTO export_file_cleanup(storage_key,workspace_id,job_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [file.storageKey, workspaceId, id]);
      if (current.final_manifest?.bundle) await tx.query('INSERT INTO export_file_cleanup(storage_key,workspace_id,job_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [current.final_manifest.bundle.storageKey, workspaceId, id]);
      await tx.query('UPDATE export_jobs SET deleted_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2', [workspaceId, id]);
      await tx.query("DELETE FROM artifact_version_pins WHERE workspace_id=$1 AND kind='export' AND retainer_id=$2", [workspaceId, id]);
    });
    await cleanup(30); return { deleted: true };
  }
  async function cleanup(limit = 30) {
    const pending = (await pool.query<{ storage_key: string }>('SELECT storage_key FROM export_file_cleanup ORDER BY created_at LIMIT $1', [Math.min(100, Math.max(1, limit))])).rows;
    for (const file of pending) { try { await storage.remove(file.storage_key); await pool.query('DELETE FROM export_file_cleanup WHERE storage_key=$1', [file.storage_key]); } catch { /* Keep the durable cleanup receipt for the next housekeeping run. */ } }
  }
  async function downloadBundle(principal: IdentityPrincipal, workspaceId: string, id: string) {
    const get = () => withWorkspaceAccess(pool, principal, { workspaceId, scope: 'export' }, async (tx, access) => { const current = await row(tx, access, principal, id), bundle = current.final_manifest?.bundle; if (current.status !== 'ready' || !bundle) throw fail('notFound', 'NOT_FOUND'); return bundle; });
    const saved = await get(), bytes = await storage.read(saved.storageKey, saved), checked = await get();
    if (checked.sha256 !== saved.sha256 || checked.storageKey !== saved.storageKey) throw fail('integrity', 'UNAVAILABLE');
    return { bytes, fileName: saved.fileName, sha256: saved.sha256, mediaType: 'application/zip' };
  }
  return { create, read, list, render, cancel, download, downloadBundle, remove, cleanup };
}

export type ExportService = ReturnType<typeof createExportService>;
