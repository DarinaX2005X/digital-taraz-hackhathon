import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityViewerSchema, WorkspaceResultSchema } from '../../src/features/identity/contracts';
import { ProjectResultSchema } from '../../src/features/workspace/contracts';
import { SourceDetailSchema, SourceInitResultSchema, SourceListSchema, SourceOcrQuoteSchema, SourcePreviewSchema, SourceReviewSchema, SourceUploadResultSchema, SourceVersionSchema, SourceVisualAssetListSchema } from '../../src/contracts/sources';
import { artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool, origin: string;
beforeAll(() => { pool = artifactTestPool(); origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`; });
afterAll(async () => { await pool?.end(); });
class Client {
  cookies = new Map<string, string>(); userId?: string;
  async request(path: string, method = 'GET', body?: unknown, extra: HeadersInit = {}) {
    const headers = new Headers(extra);
    if (method !== 'GET') { if (!headers.has('origin')) headers.set('origin', origin); headers.set('content-type', body instanceof Uint8Array ? 'application/octet-stream' : 'application/json'); }
    if (this.userId && !headers.has('x-tirlik-user-id')) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body), redirect: 'manual' });
    for (const serialized of response.headers.getSetCookie()) { const first = serialized.split(';')[0]!, split = first.indexOf('='); if (first.slice(split + 1)) this.cookies.set(first.slice(0, split), first.slice(split + 1)); else this.cookies.delete(first.slice(0, split)); }
    return response;
  }
}
async function account() {
  const client = new Client(), email = `source-http-${randomUUID()}@example.test`, password = 'Synthetic source password 42';
  expect((await client.request('/api/auth/sign-up/email', 'POST', { email, password, name: 'Synthetic source owner', locale: 'ru' })).status).toBe(200);
  const mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`, search = new URL('/api/v1/search', mailOrigin); search.searchParams.set('query', `to:${email}`);
  const messages = await (await fetch(search)).json() as { messages: { ID: string }[] };
  let token: string | null = null;
  for (const message of messages.messages) { const mail = await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`)).json() as { Text: string }; const link = mail.Text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/verify\?[^\s]+/)?.[0]; if (link) { token = new URL(link).searchParams.get('token'); break; } }
  expect(token).not.toBeNull(); expect((await client.request('/api/auth/verify-email', 'POST', { token })).status).toBe(200);
  expect((await client.request('/api/auth/sign-in/email', 'POST', { email, password })).status).toBe(200);
  const viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json()); client.userId = viewer.user.id;
  const workspace = WorkspaceResultSchema.parse(await (await client.request('/api/identity/workspaces', 'POST', { name: 'Synthetic source workspace' }, { 'idempotency-key': randomUUID() })).json()).workspace;
  const project = ProjectResultSchema.parse(await (await client.request('/api/projects', 'POST', { workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion, title: 'Synthetic source project' }, { 'idempotency-key': randomUUID() })).json()).project;
  return { client, viewer, workspace, project };
}

describe('mounted source upload and original HTTP path', () => {
  it('uploads own bytes, reads the preview and original, enforces actor/origin/session gates', async () => {
    const { client, viewer, workspace, project } = await account();
    const bytes = Buffer.from('Код,Цена\n0001,"12,50"\n0001,\n'), workspaceId = workspace.workspaceId, query = `workspaceId=${workspaceId}`;
    const body = { workspaceId, projectId: project.id, title: 'Свой прайс', fileName: 'прайс.csv', format: 'csv', size: bytes.length }, key = randomUUID();
    const initResponse = await client.request('/api/sources/uploads/init', 'POST', body, { 'idempotency-key': key });
    expect(initResponse.status).toBe(201); expect(initResponse.headers.get('cache-control')).toBe('no-store');
    const initialized = SourceInitResultSchema.parse(await initResponse.json());
    const put = await client.request(`/api/sources/uploads/${initialized.upload.id}?${query}`, 'PUT', bytes, { 'x-upload-token': initialized.token! });
    expect(put.status).toBe(200); expect(SourceUploadResultSchema.parse(await put.json()).upload.status).toBe('uploaded');
    expect((await client.request(`/api/sources/uploads/${initialized.upload.id}?${query}`, 'PUT', bytes, { 'x-upload-token': initialized.token! })).status).toBe(409);
    const readyResponse = await client.request(`/api/sources/uploads/${initialized.upload.id}/finalize`, 'POST', { workspaceId });
    expect(readyResponse.status).toBe(200); const ready = SourceUploadResultSchema.parse(await readyResponse.json()); expect(ready.upload.status).toBe('ready');
    const sourceId = ready.upload.sourceId, detailUrl = `/api/sources/${sourceId}?${query}`;
    const pinned = SourceVersionSchema.parse(await (await client.request(`/api/sources/${sourceId}/versions/${ready.upload.versionId}?${query}`)).json());
    expect(pinned).toMatchObject({ uploadId: ready.upload.id, sourceRef: { sourceId, sourceVersionId: ready.upload.versionId, revision: 1 }, manifest: { complete: true } });
    expect(SourceDetailSchema.parse(await (await client.request(detailUrl)).json()).source.revision).toBe(1);
    expect(SourceListSchema.parse(await (await client.request(`/api/sources?${query}&projectId=${project.id}`)).json()).sources[0]!.id).toBe(sourceId);
    expect(SourceListSchema.parse(await (await client.request(`/api/sources/library?${query}&query=${encodeURIComponent('Свой')}&format=csv`)).json()).sources[0]!.id).toBe(sourceId);
    const preview = SourcePreviewSchema.parse(await (await client.request(`/api/sources/${sourceId}/preview?${query}&uploadId=${ready.upload.id}`)).json());
    expect(preview.chunk.fragments[1]!.values).toEqual(['0001', '12,50']);
    const download = await client.request(`/api/sources/${sourceId}/original?${query}&uploadId=${ready.upload.id}`);
    expect(download.status).toBe(200); expect(download.headers.get('content-disposition')).toContain('attachment'); expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);
    const page = `/app/materials/sources/${sourceId}?${query}&uploadId=${ready.upload.id}&sourceVersionId=${ready.upload.versionId}`;
    expect((await client.request(page)).status).toBe(200);
    expect((await client.request(`/app/materials/add?${query}&projectId=${project.id}`)).status).toBe(200);
    const guest = new Client(); expect((await guest.request(detailUrl)).status).toBe(401);
    const guestPage = await guest.request(page); expect([303, 307]).toContain(guestPage.status);
    expect(new URL(guestPage.headers.get('location')!, origin).searchParams.get('returnTo')).toBe(page);
    expect((await client.request(detailUrl, 'GET', undefined, { 'x-tirlik-user-id': randomUUID() })).status).toBe(409);
    expect((await client.request('/api/sources/uploads/init', 'POST', body, { 'idempotency-key': randomUUID(), origin: 'https://other.example' })).status).toBe(403);
    expect((await client.request(`/api/sources?${query}&projectId=${project.id}&limit=1&limit=2`)).status).toBe(422);
    const photo = await readFile('fixtures/business/services/product-photo.jpg');
    const imageInit = SourceInitResultSchema.parse(await (await client.request('/api/sources/uploads/init', 'POST', { workspaceId, projectId: project.id, title: 'Synthetic photo', fileName: 'photo.jpg', format: 'jpeg', size: photo.length, options: { purpose: 'visual', assetLicense: { permission: 'confirmed', label: 'Synthetic fixture', canEmbed: true } } }, { 'idempotency-key': randomUUID() })).json());
    expect((await client.request(`/api/sources/uploads/${imageInit.upload.id}?${query}`, 'PUT', photo, { 'x-upload-token': imageInit.token! })).status).toBe(200);
    const imageUrl = `/api/sources/assets/${imageInit.upload.id}?${query}`;
    const imageResponse = await client.request(imageUrl);
    expect(imageResponse.status).toBe(200); expect(imageResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(imageResponse.headers.get('cache-control')).toBe('no-store'); expect(Buffer.from(await imageResponse.arrayBuffer()).equals(photo)).toBe(true);
    expect((await guest.request(imageUrl)).status).toBe(401);
    const imageReady = SourceUploadResultSchema.parse(await (await client.request(`/api/sources/uploads/${imageInit.upload.id}/finalize`, 'POST', { workspaceId })).json());
    expect(imageReady.upload.status).toBe('ready');
    const assets = SourceVisualAssetListSchema.parse(await (await client.request(`/api/sources/assets?${query}&projectId=${project.id}&kind=image`)).json());
    expect(assets.items).toEqual([expect.objectContaining({ id: imageInit.upload.id, sourceVersionId: imageReady.upload.versionId, kind: 'image', mediaType: 'image/jpeg', license: { permission: 'confirmed', label: 'Synthetic fixture', canEmbed: true } })]);
    expect(Buffer.from(await (await client.request(imageUrl)).arrayBuffer()).equals(photo)).toBe(true);
    const thumbnailUrl = `/api/sources/uploads/${imageInit.upload.id}/thumbnail?${query}`, thumbnail = await client.request(thumbnailUrl);
    expect(thumbnail.status).toBe(200); expect(thumbnail.headers.get('content-type')).toBe('image/webp'); expect(thumbnail.headers.get('cache-control')).toBe('no-store');
    const thumbnailMetadata = await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();
    expect(thumbnailMetadata.width).toBeLessThanOrEqual(320); expect(thumbnailMetadata.height).toBeLessThanOrEqual(240);
    expect((await guest.request(thumbnailUrl)).status).toBe(401);
    const scan = SourceInitResultSchema.parse(await (await client.request('/api/sources/uploads/init', 'POST', { workspaceId, projectId: project.id, title: 'Synthetic scan', fileName: 'scan.jpg', format: 'jpeg', size: photo.length, options: { purpose: 'text' } }, { 'idempotency-key': randomUUID() })).json());
    expect((await client.request(`/api/sources/uploads/${scan.upload.id}?${query}`, 'PUT', photo, { 'x-upload-token': scan.token! })).status).toBe(200);
    expect(SourceUploadResultSchema.parse(await (await client.request(`/api/sources/uploads/${scan.upload.id}/finalize`, 'POST', { workspaceId })).json()).upload.status).toBe('partial');
    const reviewUrl = `/api/sources/uploads/${scan.upload.id}/review?${query}`;
    expect(SourceReviewSchema.parse(await (await client.request(reviewUrl)).json())).toMatchObject({ pendingPages: 1, readyPages: 0, reviewPages: 0, pendingStart: null, pages: [{ page: 1, state: 'pending', original: null, corrected: null }] });
    expect(SourceOcrQuoteSchema.parse(await (await client.request(`/api/sources/uploads/${scan.upload.id}/recognition-quote?${query}&pageLimit=3`)).json())).toMatchObject({ available: false, maximumUsd: null, remainingPages: 1 });
    expect((await guest.request(reviewUrl)).status).toBe(401);
    const pageImage = await client.request(`/api/sources/uploads/${scan.upload.id}/pages/1/image?${query}`);
    expect(pageImage.status).toBe(200); expect(pageImage.headers.get('content-type')).toBe('image/png');
    expect((await sharp(Buffer.from(await pageImage.arrayBuffer())).metadata()).format).toBe('png');
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [viewer.session.id]);
    expect((await client.request(`/api/sources/${sourceId}/original?${query}&uploadId=${ready.upload.id}`)).status).toBe(401);
    expect((await client.request(imageUrl)).status).toBe(401);
    expect((await client.request(thumbnailUrl)).status).toBe(401);
    expect((await client.request(reviewUrl)).status).toBe(401);
  }, 90000);
});
