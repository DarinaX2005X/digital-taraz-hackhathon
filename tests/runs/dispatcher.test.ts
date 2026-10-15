import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createQueueDispatcher } from '../../src/features/runs/server/dispatcher';
vi.mock('workflow/api', () => ({ start: vi.fn() }));
vi.mock('../../src/features/runs/server/workflow', () => ({ executeRunWorkflow: vi.fn() }));
const claim = { runId: randomUUID(), epoch: 2, leaseOwner: randomUUID() };
describe('runtime queue dispatch', () => {
  it('coalesces simultaneous wakeups and records the workflow identifier', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const claimNext = vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null);
    const enqueue = vi.fn().mockResolvedValue({ runId: 'workflow-test' });
    const recoverExpired = vi.fn().mockResolvedValue([]);
    const dispatcher = createQueueDispatcher({ pool: { query } as unknown as Pool, service: { claim: claimNext }, ledger: { recoverExpired }, enqueue });
    const first = dispatcher.tick(), second = dispatcher.tick();
    expect(first).toBe(second);
    expect(await first).toBe(1);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(recoverExpired).toHaveBeenCalledWith(40);
    expect(query.mock.calls[1]?.[1]).toEqual([claim.runId, 2, claim.leaseOwner, 'workflow-test']);
  });
  it('preserves an uncertain workflow start instead of immediately repeating it', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const enqueue = vi.fn().mockRejectedValue(new Error('unknown delivery'));
    const dispatcher = createQueueDispatcher({ pool: { query } as unknown as Pool, service: { claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null) }, ledger: { recoverExpired: vi.fn().mockResolvedValue([]) }, enqueue });
    expect(await dispatcher.tick()).toBe(0);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(query.mock.calls[1]?.[0]).toContain("workflow_state='uncertain'");
  });
});
