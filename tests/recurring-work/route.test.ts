import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    getRunRuntime: vi.fn(() => { order.push('runtime'); }),
    handler: vi.fn(async () => { order.push('handler'); return Response.json({ ok: true }); }),
  };
});

vi.mock('@/features/runs/server/runtime', () => ({ getRunRuntime: mocks.getRunRuntime }));
vi.mock('@/features/recurring-work/server', () => ({ getWorkRulesHandler: () => mocks.handler }));

import { GET, POST } from '../../src/app/api/work-rules/[[...path]]/route';

describe('work-rules route runtime bridge', () => {
  beforeEach(() => {
    mocks.order.length = 0;
    vi.clearAllMocks();
  });

  it.each([GET, POST])('initializes the canonical run runtime before dispatching a request', async (route) => {
    const response = await route(new Request('http://localhost/api/work-rules'));

    expect(response.status).toBe(200);
    expect(mocks.getRunRuntime).toHaveBeenCalledOnce();
    expect(mocks.handler).toHaveBeenCalledOnce();
    expect(mocks.order).toEqual(['runtime', 'handler']);
  });
});
