import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { createSourceService } from '../../src/features/sources/server/service';
import { createSourceRecognitionService } from '../../src/features/sources/server/review';
import { sourceOcrRegistration } from '../../src/features/sources/server/ocr-runtime';
import { LocalSourceStorage, sourceHash } from '../../src/features/sources/server/storage';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { hash } from '../../src/features/runs/server/data';
import { CURRENT_TEXT_ROUTE } from '../../src/features/runs/server/model-runtime';
import { MODEL_POLICY_REVISION } from '../../src/features/runs/server/model-policy';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); }); afterAll(async () => { await pool?.end(); });
async function installOfflineVisionQuote() {
  const pricing = { ...CURRENT_TEXT_ROUTE, provider: 'Synthetic offline quote', inputUsd: '0', outputUsd: '0', requestUsd: '0.05', imageUsd: '0', contextTokens: 1000, maxOutputTokens: 6000, supportedParameters: ['max_tokens', 'response_format'], checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), modelExpiresAt: null, proof: 'passed', proofRef: randomUUID(), vision: true, jsonMode: 'json_schema' };
  await pool.query('INSERT INTO agent_model_endpoints(model,endpoint,kind,state,policy_revision,pricing_snapshot,pricing_hash,proof_state,proof_ref) VALUES($1,$2,$3,\'enabled\',$4,$5,$6,\'passed\',$7) ON CONFLICT(model,endpoint,kind) DO UPDATE SET state=EXCLUDED.state,policy_revision=EXCLUDED.policy_revision,pricing_snapshot=EXCLUDED.pricing_snapshot,pricing_hash=EXCLUDED.pricing_hash,proof_state=EXCLUDED.proof_state,proof_ref=EXCLUDED.proof_ref', [pricing.model, pricing.endpoint, pricing.kind, MODEL_POLICY_REVISION, pricing, hash(pricing), pricing.proofRef]);
  vi.stubEnv('OPENROUTER_API_KEY', 'offline-quote-no-provider-call');
}
async function fixture(accessClass: 'internal' | 'confidential' = 'internal') {
  const f = await artifactFixture(pool), storage = new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'source-ocr-tests', randomUUID())), sources = createSourceService(pool, storage);
  const bytes = await readFile('fixtures/business/services/product-photo.jpg');
  const init = await sources.init(f.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: f.workspaceId, projectId: f.projectId, title: 'Synthetic scanned price', fileName: 'scan.jpg', format: 'jpeg', size: bytes.length, accessClass, options: { encoding: 'utf-8', purpose: 'text' } }));
  await sources.put(f.owner, f.workspaceId, init.upload.id, init.token!, new Blob([new Uint8Array(bytes)]).stream());
  await sources.finalize(f.owner, f.workspaceId, init.upload.id);
  const model = vi.fn(async () => ({ content: JSON.stringify({ blocks: [{ kind: 'row', text: '', values: ['Қызмет', '12,50', '', '₸'] }], warnings: ['Check the faded price'] }), toolCalls: [] }));
  const registration = sourceOcrRegistration(pool, { storage, gateway: { complete: model } }), runs = createRunService(pool, createRunRegistry([registration.capability], registration.tools));
  const review = createSourceRecognitionService(pool, { service: runs, wake: async () => undefined }, storage);
  async function startBatch() {
    const row = (await pool.query<{ reserved_version_id: string }>('SELECT reserved_version_id FROM source_uploads WHERE id=$1', [init.upload.id])).rows[0]!;
    const id = randomUUID(), operationId = randomUUID();
    await pool.query('INSERT INTO source_ocr_batches(id,workspace_id,source_id,upload_id,actor_id,operation_id,body_hash,source_version_id,byte_hash,locale,pages,maximum_page_usd,request) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,\'kk\',\'[1]\',\'0.05\',\'{}\')', [id, f.workspaceId, init.upload.sourceId, init.upload.id, f.owner.userId, operationId, sourceHash('synthetic'), row.reserved_version_id, sourceHash(bytes)]);
    await pool.query('UPDATE source_pages SET batch_id=$2 WHERE upload_id=$1', [init.upload.id, id]);
    const run = await runs.create(f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, capabilityId: 'source.ocr', capabilityVersion: 1, goal: 'Synthetic OCR transport proof', locale: 'kk', inputRefs: [] }, operationId, { trusted: true, confidential: accessClass === 'confidential', privateInput: { batchId: id, uploadId: init.upload.id, sourceId: init.upload.sourceId, sourceVersionId: row.reserved_version_id, byteHash: sourceHash(bytes), maximumPageUsd: '0.05', pages: [1] } });
    await pool.query('UPDATE source_ocr_batches SET run_id=$2 WHERE id=$1', [id, run.id]);
    await pool.query('UPDATE source_pages SET run_id=$2 WHERE upload_id=$1', [init.upload.id, run.id]);
    // Keep this disposable fixture ahead of unrelated queued fixtures without mutating them.
    await pool.query("UPDATE agent_runs SET created_at='2000-01-01T00:00:00Z' WHERE id=$1", [run.id]);
    const claim = await runs.claim(); if (!claim || claim.runId !== run.id) throw new Error('Synthetic OCR claim unavailable');
    return { run, claim };
  }
  return { ...f, bytes, sources, review, model, runs, startBatch, upload: init.upload };
}

describe('durable recognized source review', () => {
  it('keeps raw recognition, requires review, commits corrected values once and preserves the original', async () => {
    const f = await fixture(), { claim } = await f.startBatch();
    expect(await f.runs.executeStep(claim)).toBe('continue'); expect(await f.runs.executeStep(claim)).toBe('stopped');
    expect(f.model).toHaveBeenCalledTimes(1);
    const first = await f.review.review(f.owner, f.workspaceId, f.upload.id);
    expect(first).toMatchObject({ pendingPages: 0, reviewPages: 1, readyPages: 0 });
    expect((await f.sources.read(f.owner, f.workspaceId, f.upload.sourceId)).source.revision).toBe(0);
    expect(first.pages[0]!.original!.blocks[0]!.values).toEqual(['Қызмет', '12,50', '', '₸']);
    const input = { workspaceId: f.workspaceId, page: 1, expectedRevision: first.pages[0]!.revision, content: { blocks: [{ values: ['Қызмет', '12,80', '', '₸'] }], warnings: [] } };
    expect(await f.review.accept(f.owner, f.upload.id, input)).toMatchObject({ reviewPages: 0, readyPages: 1 });
    await f.review.accept(f.owner, f.upload.id, input);
    const detail = await f.sources.read(f.owner, f.workspaceId, f.upload.sourceId);
    expect(detail.source.revision).toBe(1); expect(detail.uploads[0]!.status).toBe('ready');
    const preview = await f.sources.preview(f.owner, f.workspaceId, f.upload.sourceId, f.upload.id);
    expect(preview.chunk.fragments[0]).toMatchObject({ page: 1, values: ['Қызмет', '12,80', '', '₸'], review: 'observed' });
    const saved = await f.review.review(f.owner, f.workspaceId, f.upload.id); expect(saved.pages[0]!.original!.blocks[0]!.values![1]).toBe('12,50');
    expect((await f.sources.download(f.owner, f.workspaceId, f.upload.sourceId, f.upload.id)).bytes.equals(f.bytes)).toBe(true);
    await expect(pool.query("UPDATE source_pages SET original_content='{}' WHERE upload_id=$1", [f.upload.id])).rejects.toMatchObject({ code: '23514' });
    await expect(f.review.accept(f.owner, f.upload.id, { ...input, content: { blocks: [{ text: 'overwrite' }], warnings: [] } })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('fences cancelled uploads before provider work and hides confidential run/source metadata', async () => {
    const f = await fixture('confidential');
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 1 });
    const { claim, run } = await f.startBatch();
    await expect(f.runs.read(f.member, run.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.review.review(f.member, f.workspaceId, f.upload.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.sources.cancel(f.owner, f.workspaceId, f.upload.id);
    expect(await f.runs.executeStep(claim)).toBe('stopped'); expect(f.model).not.toHaveBeenCalled();
    expect((await f.sources.read(f.owner, f.workspaceId, f.upload.sourceId)).source.revision).toBe(0);
  });
  it('binds public start to reviewed quote, idempotent operation and selected page batch', async () => {
    const f = await fixture();
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    await installOfflineVisionQuote();
    try {
      const quote = await f.review.quote(f.owner, f.workspaceId, f.upload.id, 3); expect(quote).toMatchObject({ available: true, pages: [1], maximumUsd: '0.05' });
      const input = { workspaceId: f.workspaceId, locale: 'kk', pageLimit: 3, expectedPages: [1], maximumUsd: '0.05' }, key = randomUUID();
      await expect(f.review.start(f.owner, f.upload.id, randomUUID(), { ...input, maximumUsd: '0.01' })).rejects.toMatchObject({ code: 'CONFLICT' });
      const create = vi.spyOn(f.runs, 'create'); create.mockRejectedValueOnce(new Error('Synthetic interruption before durable run'));
      await expect(f.review.start(f.owner, f.upload.id, key, input)).rejects.toThrow('Synthetic interruption');
      expect((await f.review.review(f.owner, f.workspaceId, f.upload.id)).pendingStart).toEqual({ operationId: key, locale: 'kk', pageLimit: 3, expectedPages: [1], maximumUsd: '0.05' });
      expect((await f.review.review(f.member, f.workspaceId, f.upload.id)).pendingStart).toBeNull();
      const run = await f.review.start(f.owner, f.upload.id, key, input), replay = await f.review.start(f.owner, f.upload.id, key, input); expect(replay.id).toBe(run.id);
      expect((await f.review.review(f.owner, f.workspaceId, f.upload.id)).pendingStart).toBeNull(); create.mockRestore();
      expect((await pool.query('SELECT id FROM source_ocr_batches WHERE upload_id=$1', [f.upload.id])).rowCount).toBe(1);
      expect((await f.review.quote(f.owner, f.workspaceId, f.upload.id, 3)).pages).toEqual([]);
      await expect(f.review.start(f.owner, f.upload.id, key, { ...input, pageLimit: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
      await f.runs.cancel(f.owner, run.id, { expectedEpoch: run.epoch }, randomUUID());
    } finally { vi.unstubAllEnvs(); }
    expect(f.model).not.toHaveBeenCalled();
  });
  it('surfaces a terminal page failure and starts a new quoted batch without repeating the old run', async () => {
    const f = await fixture(), first = await f.startBatch();
    await f.runs.cancel(f.owner, first.run.id, { expectedEpoch: first.claim.epoch }, randomUUID());
    const failed = await f.review.review(f.owner, f.workspaceId, f.upload.id);
    expect(failed).toMatchObject({ pendingPages: 0, failedPages: 1, reviewPages: 0, pages: [{ page: 1, state: 'failed', runId: first.run.id, runState: 'cancelled', failure: 'cancelled' }] });
    await installOfflineVisionQuote();
    try {
      const quote = await f.review.quote(f.owner, f.workspaceId, f.upload.id, 1);
      expect(quote).toMatchObject({ available: true, pages: [1], maximumUsd: '0.05' });
      const next = await f.review.start(f.owner, f.upload.id, randomUUID(), { workspaceId: f.workspaceId, locale: 'ru', pageLimit: 1, expectedPages: quote.pages, maximumUsd: quote.maximumUsd });
      expect(next.id).not.toBe(first.run.id);
      expect(await f.review.review(f.owner, f.workspaceId, f.upload.id)).toMatchObject({ pendingPages: 1, failedPages: 0, pages: [{ page: 1, state: 'pending', runId: next.id, runState: 'queued', failure: null }] });
      await f.runs.cancel(f.owner, next.id, { expectedEpoch: next.epoch }, randomUUID());
    } finally { vi.unstubAllEnvs(); }
    expect(f.model).not.toHaveBeenCalled();
  });
});
