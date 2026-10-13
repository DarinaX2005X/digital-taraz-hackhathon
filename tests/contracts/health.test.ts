import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorEnvelopeSchema } from '../../src/contracts/errors';

const query = vi.hoisted(() => vi.fn());
vi.mock('../../src/server/db/pool', () => ({ getDatabasePool: () => ({ query }) }));
import { GET } from '../../src/app/api/health/route';

afterEach(() => { query.mockReset(); });
describe('health route', () => {
  it('reports ready only after a database query', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const response = await GET();
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', service: 'tirlik', database: 'ready' });
  });
  it('returns a typed 503 without database credentials or stack', async () => {
    query.mockRejectedValueOnce(new Error('postgresql://secret@private-host'));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secret|private-host|stack/);
  });
});
