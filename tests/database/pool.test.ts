import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => ({ on: vi.fn() }));
const constructed = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({
  Pool: class {
    constructor(config: unknown) { constructed(config); return pool; }
  },
}));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('server database pool', () => {
  it('requires explicit database configuration', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getDatabasePool } = await import('../../src/server/db/pool');
    expect(() => getDatabasePool()).toThrow('DATABASE_URL_REQUIRED');
    expect(constructed).not.toHaveBeenCalled();
  });
  it('reuses a bounded pool and handles idle connection failure without exposing credentials', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:private@127.0.0.1:5432/tirlik');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getDatabasePool } = await import('../../src/server/db/pool');
    expect(getDatabasePool()).toBe(getDatabasePool());
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(constructed.mock.calls[0]?.[0]).toMatchObject({ max: 5, connectionTimeoutMillis: 3000, statement_timeout: 15000 });
    expect(pool.on.mock.calls[0]?.[0]).toBe('error');
    const onError = pool.on.mock.calls[0]?.[1] as (error: Error) => void;
    onError(new Error('private credentials'));
    expect(log).toHaveBeenCalledExactlyOnceWith('DATABASE_IDLE_CONNECTION_ERROR');
  });
});
