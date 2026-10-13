import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeRow } from '@/server/preflight/store';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), getHookByToken: vi.fn(), getRun: vi.fn(), resumeHook: vi.fn(),
  admitProbe: vi.fn(), associateRun: vi.fn(), claimResume: vi.fn(), markProbeCleaned: vi.fn(), readProbe: vi.fn(),
  deleteProbeFile: vi.fn(), readProbeFile: vi.fn(),
}));
vi.mock('workflow/api', () => mocks);
vi.mock('@/server/preflight/store', () => mocks);
vi.mock('@/server/preflight/blob', () => mocks);
vi.mock('@/server/preflight/workflow', () => ({ hostingProbeWorkflow: vi.fn() }));
import { hostingOperations } from '@/server/preflight/service';

const probeId = '10000000-0000-4000-8000-000000000001';
function row(overrides: Partial<ProbeRow> = {}): ProbeRow {
  return {
    probe_id: probeId, workflow_run_id: 'wrun_test', state: 'waiting',
    start_deployment_id: 'dpl_before', resume_deployment_id: null,
    before_count: 1, after_count: 0, blob_path: `preflight/hosting/${probeId}/payload.json`,
    blob_sha256: 'a'.repeat(64), ...overrides,
  };
}

describe('hosting operation idempotency and cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readProbe.mockResolvedValue(row());
    mocks.getHookByToken.mockResolvedValue({ runId: 'wrun_test' });
    mocks.getRun.mockReturnValue({ status: Promise.resolve('running') });
  });

  it('dispatches only the newly admitted run in the selected region', async () => {
    mocks.admitProbe.mockResolvedValue({ created: true, row: row({ workflow_run_id: null }) });
    mocks.start.mockResolvedValue({ runId: 'wrun_test' });
    expect(await hostingOperations.start(probeId, 'dpl_before')).toEqual({ runId: 'wrun_test' });
    expect(mocks.start).toHaveBeenCalledWith(expect.any(Function), [probeId], { region: 'fra1' });
    expect(mocks.associateRun).toHaveBeenCalledExactlyOnceWith(probeId, 'wrun_test');
  });

  it('never redispatches after an ambiguous start receipt', async () => {
    mocks.admitProbe.mockResolvedValueOnce({ created: true, row: row({ workflow_run_id: null }) });
    mocks.start.mockRejectedValueOnce(new Error('response lost'));
    await expect(hostingOperations.start(probeId, 'dpl_before')).rejects.toThrow('response lost');
    mocks.admitProbe.mockResolvedValue({ created: false, row: row({ workflow_run_id: null }) });
    await expect(hostingOperations.start(probeId, 'dpl_before')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('reconciles a duplicate start using the stored run without dispatch', async () => {
    mocks.admitProbe.mockResolvedValue({ created: false, row: row() });
    expect(await hostingOperations.start(probeId, 'dpl_after')).toEqual({ runId: 'wrun_test' });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('does not repeat resume delivery after a lost response', async () => {
    mocks.claimResume.mockResolvedValueOnce(true);
    mocks.resumeHook.mockRejectedValueOnce(new Error('response lost'));
    await expect(hostingOperations.resume(probeId, 'dpl_after')).rejects.toThrow('response lost');
    mocks.readProbe.mockResolvedValue(row({ resume_deployment_id: 'dpl_after' }));
    expect(await hostingOperations.resume(probeId, 'dpl_after')).toEqual({ runId: 'wrun_test' });
    expect(mocks.resumeHook).toHaveBeenCalledExactlyOnceWith(`tirlik:preflight:${probeId}`, { resumeDeploymentId: 'dpl_after' });
  });

  it('rejects a hook belonging to another run and only allows the resume claim winner', async () => {
    mocks.getHookByToken.mockResolvedValueOnce({ runId: 'wrun_foreign' });
    await expect(hostingOperations.resume(probeId, 'dpl_after')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.claimResume).not.toHaveBeenCalled();
    mocks.claimResume.mockResolvedValue(false);
    await hostingOperations.resume(probeId, 'dpl_after');
    expect(mocks.resumeHook).not.toHaveBeenCalled();
  });

  it('reports database durability even when provider observability has expired', async () => {
    mocks.getRun.mockImplementation(() => { throw new Error('expired'); });
    const status = await hostingOperations.status(probeId, 'dpl_after');
    expect(status).toMatchObject({ beforeCount: 1, afterCount: 0, startDeploymentId: 'dpl_before', deploymentId: 'dpl_after', workflowStatus: 'unavailable-or-expired' });
  });

  it('refuses cleanup of a nonterminal run', async () => {
    await expect(hostingOperations.remove(probeId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.deleteProbeFile).not.toHaveBeenCalled();
    expect(mocks.markProbeCleaned).not.toHaveBeenCalled();
  });

  it('removes only the exact synthetic file after terminal status and retains the receipt', async () => {
    mocks.getRun.mockReturnValue({ status: Promise.resolve('completed') });
    await hostingOperations.remove(probeId);
    expect(mocks.deleteProbeFile).toHaveBeenCalledExactlyOnceWith(probeId);
    expect(mocks.markProbeCleaned).toHaveBeenCalledExactlyOnceWith(probeId, false);
    mocks.readProbe.mockResolvedValue(row({ blob_path: null, state: 'completed' }));
    await expect(hostingOperations.file(probeId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.readProbeFile).not.toHaveBeenCalled();
  });
});
