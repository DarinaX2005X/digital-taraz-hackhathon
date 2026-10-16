import { AwsClient } from 'aws4fetch';

export const R2_UPLOAD_CONTENT_TYPE = 'application/octet-stream';
export const R2_UPLOAD_IF_NONE_MATCH = '*';
const R2_ENV_NAMES = ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;

export type StorageDriver = 'local' | 'r2';
export interface R2StorageConfig {
  driver: 'r2';
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetcher?: typeof fetch;
}
export type StorageSelection = { driver: 'local'; root: string } | R2StorageConfig;

export class R2StorageError extends Error {
  constructor(readonly reason: 'configuration' | 'missing' | 'size' | 'immutable' | 'unavailable') {
    super(`R2_STORAGE_${reason.toUpperCase()}`);
  }
}

function configuredR2(fetcher?: typeof fetch): R2StorageConfig | null {
  const values = R2_ENV_NAMES.map((name) => process.env[name] ?? '');
  const populated = values.filter(Boolean).length;
  if (populated > 0 && populated < R2_ENV_NAMES.length) throw new R2StorageError('configuration');
  if (!populated) return null;
  const accountId = values[0]!, bucketName = values[1]!, accessKeyId = values[2]!, secretAccessKey = values[3]!;
  return { driver: 'r2', accountId, bucketName, accessKeyId, secretAccessKey, fetcher };
}

export function selectStorage(defaultLocalRoot: string, override?: string | R2StorageConfig): StorageSelection {
  if (typeof override === 'string') return { driver: 'local', root: override };
  if (override) return validateConfig(override);
  const configured = configuredR2();
  const requested = process.env.TIRLIK_STORAGE_DRIVER;
  if (requested !== undefined && requested !== 'local' && requested !== 'r2') throw new R2StorageError('configuration');
  const vercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
  if (vercel && requested !== 'r2') throw new R2StorageError('configuration');
  if (requested === 'r2') {
    if (!configured) throw new R2StorageError('configuration');
    return validateConfig(configured);
  }
  return { driver: 'local', root: defaultLocalRoot };
}

function validateConfig(config: R2StorageConfig): R2StorageConfig {
  if (!/^[a-f0-9]{32}$/i.test(config.accountId)
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucketName)
    || !config.accessKeyId
    || !config.secretAccessKey) throw new R2StorageError('configuration');
  return config;
}

function safeObjectKey(key: string) {
  const parts = key.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) throw new R2StorageError('configuration');
  return parts.map(encodeURIComponent).join('/');
}

async function boundedBody(response: Response, maximum: number) {
  if (!response.body) throw new R2StorageError('unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new R2StorageError('size');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const sameBytes = (left: Uint8Array, right: Uint8Array) => left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

export class R2ObjectStorage {
  private readonly client: AwsClient;
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;

  constructor(config: R2StorageConfig) {
    const checked = validateConfig(config);
    this.client = new AwsClient({ accessKeyId: checked.accessKeyId, secretAccessKey: checked.secretAccessKey, service: 's3', region: 'auto', retries: 0 });
    this.fetcher = checked.fetcher ?? fetch;
    this.endpoint = `https://${checked.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(checked.bucketName)}`;
  }

  private url(key: string) { return `${this.endpoint}/${safeObjectKey(key)}`; }

  private async request(key: string, init: RequestInit & { aws?: { signQuery?: boolean; allHeaders?: boolean } }) {
    try {
      const signed = await this.client.sign(this.url(key), { cache: 'no-store', redirect: 'error', ...init });
      return await this.fetcher(signed);
    } catch (error) {
      if (error instanceof R2StorageError) throw error;
      throw new R2StorageError('unavailable');
    }
  }

  async presignImmutablePut(key: string, expiresSeconds = 15 * 60) {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 60 || expiresSeconds > 15 * 60) throw new R2StorageError('configuration');
    const url = new URL(this.url(key));
    url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
    const signed = await this.client.sign(url, {
      method: 'PUT',
      headers: { 'Content-Type': R2_UPLOAD_CONTENT_TYPE, 'If-None-Match': R2_UPLOAD_IF_NONE_MATCH },
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url;
  }

  async head(key: string, maximum: number) {
    const response = await this.request(key, { method: 'HEAD' });
    if (response.status === 404) throw new R2StorageError('missing');
    if (!response.ok) throw new R2StorageError('unavailable');
    const raw = response.headers.get('content-length');
    const size = raw && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(size) || size < 1 || size > maximum) throw new R2StorageError('size');
    return { size, etag: response.headers.get('etag') };
  }

  async read(key: string, maximum: number, expectedSize?: number) {
    const metadata = await this.head(key, maximum);
    if (expectedSize !== undefined && metadata.size !== expectedSize) throw new R2StorageError('size');
    const response = await this.request(key, { method: 'GET' });
    if (response.status === 404) throw new R2StorageError('missing');
    if (!response.ok) throw new R2StorageError('unavailable');
    const bytes = await boundedBody(response, maximum);
    if (bytes.byteLength !== metadata.size || expectedSize !== undefined && bytes.byteLength !== expectedSize) throw new R2StorageError('size');
    return bytes;
  }

  async putImmutable(key: string, bytes: Uint8Array, maximum: number) {
    if (!bytes.byteLength || bytes.byteLength > maximum) throw new R2StorageError('size');
    let response: Response | undefined;
    let uncertain = false;
    try {
      response = await this.request(key, {
        method: 'PUT',
        headers: { 'Content-Type': R2_UPLOAD_CONTENT_TYPE, 'If-None-Match': R2_UPLOAD_IF_NONE_MATCH },
        body: bytes.slice().buffer as ArrayBuffer,
        aws: { allHeaders: true },
      });
      if (response.ok) return response.headers.get('etag');
      uncertain = response.status === 412 || response.status >= 500;
    } catch {
      uncertain = true;
    }
    if (uncertain) {
      try {
        const existing = await this.read(key, maximum, bytes.byteLength);
        if (sameBytes(existing, bytes)) return null;
        throw new R2StorageError('immutable');
      } catch (error) {
        if (error instanceof R2StorageError && error.reason === 'immutable') throw error;
      }
    }
    throw new R2StorageError(response?.status === 412 ? 'immutable' : 'unavailable');
  }

  async remove(key: string) {
    const response = await this.request(key, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new R2StorageError('unavailable');
  }
}
