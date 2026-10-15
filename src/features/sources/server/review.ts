import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Pool, PoolClient } from 'pg';
import { IdSchema } from '../../../contracts/primitives';
import { AcceptSourcePageSchema, SourceChunkSchema, SourceManifestSchema, SourceOptionsSchema, SourceOcrSelectionSchema, SourcePageContentSchema, SourceReviewSchema, StartSourceOcrSchema, type SourceFragment, type SourceOcrQuote, type SourcePageContent } from '../../../contracts/sources';
import { withWorkspaceAccess, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import type { RunService } from '../../runs/server/service';
import { applicationModelQuote } from '../../runs/server/model-runtime';
import { RUN_LIMITS } from '../../runs/domain/limits';
import { authorizedUpload, type UploadRow } from './service';
import { buildExtraction } from './parser';
import { publishSourceVersion } from './source-heads';
import { LocalSourceStorage, sourceHash } from './storage';
import { prepareOriginalVisualAsset, registerOriginalVisualAsset } from './visual-assets';
import { hash } from '../../runs/server/data';

export const OCR_MAX_OUTPUT_TOKENS = 6000;
export interface SourcePageRow { page: number; state: 'pending' | 'ready' | 'needs-review' | 'failed'; run_id: string | null; batch_id: string | null; review_revision: number; original_content: SourcePageContent | null; corrected_content: SourcePageContent | null; reviewed_at: Date | null }
export interface SourceOcrBatch { id: string; workspace_id: string; source_id: string; upload_id: string; actor_id: string; operation_id: string; body_hash: string; source_version_id: string; byte_hash: string; locale: 'ru' | 'kk' | 'en'; pages: number[]; request: unknown; maximum_page_usd: string; run_id: string | null }
const conflict = () => new IdentityError('CONFLICT', 'sources.errors.conflict');
export const recognizedFragments = (page: number, content: SourcePageContent, reviewed = false): SourceFragment[] => content.blocks.map((block, index) => ({ id: `recognized:${page}:${index + 1}`, page, ...(block.values ? { row: index + 1, values: block.values } : { text: block.text! }), review: reviewed ? 'observed' : 'needs-review' }));

/** Rebuilds the unpublished derived manifest; original bytes and OCR observations stay immutable. */
export async function rebuildRecognizedManifest(tx: PoolClient, auth: WorkspaceAccess, upload: UploadRow) {
  if (upload.published_version_id || upload.status !== 'partial' || !upload.manifest || !upload.byte_hash) throw conflict();
  const old = SourceManifestSchema.parse(upload.manifest);
  const chunks = (await tx.query<{ content: unknown; hash: string; ordinal: number }>('SELECT ordinal,hash,content FROM source_chunks WHERE upload_id=$1 ORDER BY ordinal', [upload.id])).rows;
  const extracted: SourceFragment[] = [];
  for (const row of chunks) {
    const chunk = SourceChunkSchema.parse(row.content);
    if (sourceHash(JSON.stringify(chunk)) !== row.hash || old.chunkHashes[row.ordinal] !== row.hash) throw conflict();
    extracted.push(...chunk.fragments.filter((fragment) => !fragment.id.startsWith('recognized:')));
  }
  const pages = (await tx.query<SourcePageRow>('SELECT * FROM source_pages WHERE upload_id=$1 ORDER BY page', [upload.id])).rows;
  for (const page of pages) if (page.original_content) extracted.push(...recognizedFragments(page.page, SourcePageContentSchema.parse(page.corrected_content ?? page.original_content), page.reviewed_at !== null));
  const complete = pages.every((page) => page.state === 'ready');
  const result = buildExtraction(upload.format, upload.byte_hash, SourceOptionsSchema.parse(upload.options), extracted, old.sheets, [...old.diagnostics.filter((value) => value !== 'vision-required' && value !== 'recognition-review'), ...(complete ? [] : [pages.some((page) => page.state === 'pending' || page.state === 'failed') ? 'vision-required' : 'recognition-review'])], pages.map(({ page, state }) => ({ page, state: state === 'needs-review' ? 'pending' : state })));
  await tx.query('DELETE FROM source_chunks WHERE upload_id=$1', [upload.id]);
  for (let ordinal = 0; ordinal < result.chunks.length; ordinal++) await tx.query('INSERT INTO source_chunks(upload_id,ordinal,hash,content) VALUES($1,$2,$3,$4)', [upload.id, ordinal, result.manifest.chunkHashes[ordinal], JSON.stringify(result.chunks[ordinal])]);
  if (complete) await publishSourceVersion(tx, auth, { sourceId: upload.source_id, versionId: upload.reserved_version_id, expectedRevision: upload.expected_revision, snapshotHash: result.snapshotHash });
  await tx.query('UPDATE source_uploads SET manifest=$2,status=$3,published_version_id=$4,updated_at=now() WHERE id=$1', [upload.id, JSON.stringify(result.manifest), complete ? 'ready' : 'partial', complete ? upload.reserved_version_id : null]);
  return complete;
}

export function createSourceRecognitionService(pool: Pool, runtime?: { service: RunService; wake: () => Promise<unknown> }, storage = new LocalSourceStorage()) {
  const access = <T>(principal: SessionPrincipal, workspaceId: string, effect: (tx: PoolClient, auth: WorkspaceAccess) => Promise<T>, edit = false) => withWorkspaceAccess(pool, principal, { workspaceId: validate(IdSchema, workspaceId), scope: edit ? 'edit' : 'read' }, effect);
  async function review(principal: SessionPrincipal, workspaceId: string, uploadId: string) {
    validate(IdSchema, uploadId);
    return access(principal, workspaceId, async (tx, auth) => {
      await authorizedUpload(tx, auth, uploadId, 'read');
      const pages = (await tx.query<SourcePageRow>('SELECT * FROM source_pages WHERE upload_id=$1 ORDER BY page', [uploadId])).rows;
      const pending = (await tx.query<SourceOcrBatch>('SELECT * FROM source_ocr_batches WHERE workspace_id=$1 AND upload_id=$2 AND actor_id=$3 AND run_id IS NULL ORDER BY created_at LIMIT 1', [workspaceId, uploadId, auth.userId])).rows[0];
      let pendingStart = null;
      if (pending) {
        const request = StartSourceOcrSchema.parse(pending.request);
        if (request.workspaceId !== workspaceId || hash({ ...request, uploadId }) !== pending.body_hash) throw conflict();
        pendingStart = { operationId: pending.operation_id, locale: request.locale, pageLimit: request.pageLimit, expectedPages: request.expectedPages, maximumUsd: request.maximumUsd };
      }
      return SourceReviewSchema.parse({ uploadId, pages: pages.map((page) => ({ page: page.page, state: page.state, runId: page.run_id, revision: page.review_revision, original: page.original_content, corrected: page.corrected_content, reviewedAt: page.reviewed_at?.toISOString() ?? null })), pendingPages: pages.filter((page) => page.state === 'pending' || page.state === 'failed').length, readyPages: pages.filter((page) => page.state === 'ready').length, reviewPages: pages.filter((page) => page.state === 'needs-review').length, pendingStart });
    });
  }
  async function quote(principal: SessionPrincipal, workspaceId: string, uploadId: string, pageLimit = 3): Promise<SourceOcrQuote> {
    const input = validate(SourceOcrSelectionSchema, { workspaceId, locale: 'ru', pageLimit }); validate(IdSchema, uploadId);
    const pending = await access(principal, input.workspaceId, async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit');
      if (upload.status !== 'partial') return [];
      return (await tx.query<{ page: number }>("SELECT page FROM source_pages WHERE upload_id=$1 AND state='pending' AND batch_id IS NULL ORDER BY page", [uploadId])).rows.map((row) => row.page);
    }, true);
    if (!pending.length) return { available: false, reason: 'no-pages', pages: [], remainingPages: 0, maximumUsd: null };
    try {
      const { reservedUsd } = await applicationModelQuote(pool, { maxOutputTokens: OCR_MAX_OUTPUT_TOKENS, parameters: ['max_tokens', 'response_format'], vision: true });
      const maximumPages = new Decimal(reservedUsd).isZero() ? 10 : new Decimal(RUN_LIMITS.runUsd).div(reservedUsd).floor().toNumber();
      const pages = pending.slice(0, Math.min(pageLimit, maximumPages, 10));
      return { available: pages.length > 0, reason: pages.length ? null : 'run_budget', pages, remainingPages: pending.length - pages.length, maximumUsd: new Decimal(reservedUsd).times(pages.length).toFixed() };
    } catch (error) { return { available: false, reason: error instanceof Error && 'failure' in error ? String(error.failure) : 'model-unavailable', pages: [], remainingPages: pending.length, maximumUsd: null }; }
  }
  async function start(principal: SessionPrincipal, uploadId: string, operationId: string, raw: unknown) {
    if (!runtime) throw new IdentityError('CONFLICT', 'sources.errors.recognitionUnavailable');
    const input = validate(StartSourceOcrSchema, raw); validate(IdSchema, uploadId); validate(IdSchema, operationId);
    const bodyHash = hash({ ...input, uploadId });
    const existing = await access(principal, input.workspaceId, async (tx, auth) => {
      await authorizedUpload(tx, auth, uploadId, 'edit');
      const batch = (await tx.query<SourceOcrBatch>('SELECT * FROM source_ocr_batches WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [input.workspaceId, principal.userId, operationId])).rows[0];
      if (batch && batch.body_hash !== bodyHash) throw conflict();
      return batch;
    }, true);
    const estimate = existing ? null : await quote(principal, input.workspaceId, uploadId, input.pageLimit);
    if (!existing && (!estimate?.available || !estimate.pages.length)) throw new IdentityError('CONFLICT', 'sources.errors.recognitionUnavailable');
    if (!existing && (JSON.stringify(estimate!.pages) !== JSON.stringify(input.expectedPages) || new Decimal(estimate!.maximumUsd!).gt(input.maximumUsd))) throw conflict();
    const prepared = await access(principal, input.workspaceId, async (tx, auth) => {
      const { upload, source } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
      let batch = (await tx.query<SourceOcrBatch>('SELECT * FROM source_ocr_batches WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [input.workspaceId, principal.userId, operationId])).rows[0];
      if (batch && batch.body_hash !== bodyHash) throw conflict();
      if (!batch) {
        if (upload.status !== 'partial' || !upload.byte_hash || !estimate?.pages.length) throw conflict();
        const selected = (await tx.query<{ page: number }>("SELECT page FROM source_pages WHERE upload_id=$1 AND state='pending' AND batch_id IS NULL AND page=ANY($2::integer[]) ORDER BY page FOR UPDATE", [uploadId, estimate.pages])).rows.map((row) => row.page);
        if (selected.length !== estimate.pages.length) throw conflict();
        const id = randomUUID();
        const maximumPageUsd = new Decimal(input.maximumUsd).div(selected.length).toDecimalPlaces(12, Decimal.ROUND_DOWN).toFixed();
        batch = (await tx.query<SourceOcrBatch>('INSERT INTO source_ocr_batches(id,workspace_id,source_id,upload_id,actor_id,operation_id,body_hash,source_version_id,byte_hash,locale,pages,maximum_page_usd,request) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *', [id, input.workspaceId, upload.source_id, uploadId, principal.userId, operationId, bodyHash, upload.reserved_version_id, upload.byte_hash, input.locale, JSON.stringify(selected), maximumPageUsd, JSON.stringify(input)])).rows[0]!;
        await tx.query('UPDATE source_pages SET batch_id=$2 WHERE upload_id=$1 AND page=ANY($3::integer[])', [uploadId, id, selected]);
      }
      return { batch, projectId: source.project_id, confidential: source.access_class === 'confidential' };
    }, true);
    const batch = prepared.batch;
    const run = await runtime.service.create(principal, { workspaceId: input.workspaceId, projectId: prepared.projectId, capabilityId: 'source.ocr', capabilityVersion: 1, goal: { ru: 'Распознать страницы материала', kk: 'Материал беттерін тану', en: 'Recognize material pages' }[input.locale], locale: input.locale, inputRefs: [] }, operationId, { trusted: true, confidential: prepared.confidential, privateInput: { batchId: batch.id, uploadId, sourceId: batch.source_id, sourceVersionId: batch.source_version_id, byteHash: batch.byte_hash, pages: batch.pages, maximumPageUsd: batch.maximum_page_usd } });
    await access(principal, input.workspaceId, async (tx, auth) => { await authorizedUpload(tx, auth, uploadId, 'edit', true); await tx.query('UPDATE source_ocr_batches SET run_id=$2 WHERE id=$1 AND (run_id IS NULL OR run_id=$2)', [batch.id, run.id]); await tx.query('UPDATE source_pages SET run_id=$3 WHERE upload_id=$1 AND batch_id=$2 AND run_id IS NULL', [uploadId, batch.id, run.id]); }, true);
    await runtime.wake().catch(() => undefined);
    return run;
  }
  async function accept(principal: SessionPrincipal, uploadId: string, raw: unknown) {
    const input = validate(AcceptSourcePageSchema, raw); validate(IdSchema, uploadId);
    const selected = await access(principal, input.workspaceId, async (tx, auth) => (await authorizedUpload(tx, auth, uploadId, 'edit')).upload, true);
    let visualAsset: Awaited<ReturnType<typeof prepareOriginalVisualAsset>> = null;
    if (['png', 'jpeg', 'webp'].includes(selected.format)) {
      if (!selected.original_key) throw conflict();
      const bytes = await storage.read(selected.original_key);
      if (sourceHash(bytes) !== selected.byte_hash || bytes.length !== selected.byte_size) throw conflict();
      visualAsset = await prepareOriginalVisualAsset(selected, bytes);
    }
    await access(principal, input.workspaceId, async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
      const row = (await tx.query<SourcePageRow>('SELECT * FROM source_pages WHERE upload_id=$1 AND page=$2 FOR UPDATE', [uploadId, input.page])).rows[0];
      if (!row?.original_content) throw conflict();
      if (row.review_revision === input.expectedRevision + 1 && row.reviewed_at && hash(row.corrected_content) === hash(input.content)) return;
      if (row.state !== 'needs-review' || row.review_revision !== input.expectedRevision || upload.status !== 'partial') throw conflict();
      await tx.query("UPDATE source_pages SET state='ready',corrected_content=$3,reviewed_at=now(),reviewed_by=$4,review_revision=review_revision+1 WHERE upload_id=$1 AND page=$2", [uploadId, input.page, JSON.stringify(input.content), principal.userId]);
      if (await rebuildRecognizedManifest(tx, auth, upload)) await registerOriginalVisualAsset(tx, auth, upload, visualAsset);
    }, true);
    return review(principal, input.workspaceId, uploadId);
  }
  return { review, quote, start, accept };
}
