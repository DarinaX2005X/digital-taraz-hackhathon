import { beforeEach, describe, expect, it, vi } from 'vitest';
import { probePath, probePayload, sha256 } from '@/server/preflight/contracts';

const mocks = vi.hoisted(() => ({
  put: vi.fn(), get: vi.fn(), del: vi.fn(),
  query: vi.fn(), connect: vi.fn(), release: vi.fn(),
}));
vi.mock('@vercel/blob', () => mocks);
vi.mock('@/server/db/pool', () => ({ getDatabasePool: () => mocks }));
import { ensureProbeFile, readProbeFile } from '@/server/preflight/blob';
import { admitProbe, markProbeCleaned } from '@/server/preflight/store';

const probeId = '10000000-0000-4000-8000-000000000001';
function blobResult(bytes = probePayload(probeId)) {
  return { statusCode: 200, stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
}

describe('bounded synthetic hosting storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.connect.mockResolvedValue(mocks);
    mocks.get.mockImplementation(() => Promise.resolve(blobResult()));
  });

  it('reconciles a lost blob write only by reading identical content at the fixed path', async () => {
    mocks.put.mockRejectedValue(new Error('lost receipt'));
    expect(await ensureProbeFile(probeId)).toEqual({ pathname: probePath(probeId), hash: sha256(probePayload(probeId)) });
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledWith(probePath(probeId), expect.objectContaining({ access: 'private', useCache: false }));
  });

  it('never treats an unrelated payload as recovery of an ambiguous write', async () => {
    mocks.put.mockRejectedValue(new Error('lost receipt'));
    mocks.get.mockImplementation(() => Promise.resolve(blobResult(Buffer.from('{"different":true}'))));
    await expect(ensureProbeFile(probeId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.put).toHaveBeenCalledOnce();
  });

  it('rejects missing and oversized private files', async () => {
    mocks.get.mockResolvedValueOnce(null);
    await expect(readProbeFile(probeId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    mocks.get.mockResolvedValueOnce(blobResult(Buffer.alloc(1025)));
    await expect(readProbeFile(probeId)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('uses a transaction-scoped admission lock and returns an existing record without a second insert', async () => {
    const existing = { probe_id: probeId, workflow_run_id: 'wrun_existing' };
    mocks.query.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [existing] }).mockResolvedValueOnce({});
    expect(await admitProbe(probeId, 'dpl_new')).toEqual({ created: false, row: existing });
    expect(mocks.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN', 'SELECT pg_advisory_xact_lock(1727062740)',
      'SELECT * FROM preflight_hosting_probes WHERE probe_id = $1', 'COMMIT',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it.each([{ recent: 5, active: 0 }, { recent: 0, active: 2 }])('rolls back when the bounded admission limit is reached: %j', async (count) => {
    mocks.query.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [count] }).mockResolvedValueOnce({});
    await expect(admitProbe(probeId, 'dpl_new')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('cleanup clears only the exact probe file pointer and retains admission time', async () => {
    mocks.query.mockResolvedValue({ rowCount: 1 });
    await markProbeCleaned(probeId, false);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain('blob_path = NULL');
    expect(sql).toContain('WHERE probe_id = $1');
    expect(sql).not.toMatch(/DELETE|created_at\s*=/);
    expect(params).toEqual([probeId, false]);
  });
});
