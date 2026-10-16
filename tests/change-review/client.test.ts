import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeSet } from '../../src/contracts/dependencies';
import { createChangeReviewClient, ReviewError } from '../../src/features/change-review/client';

function fixture(): { viewer: { userId: string; workspaceId: string; authzVersion: number }; projectId: string; changeset: ChangeSet } {
  const userId = randomUUID(), workspaceId = randomUUID(), projectId = randomUUID();
  return { viewer: { userId, workspaceId, authzVersion: 3 }, projectId, changeset: { id: randomUUID(), workspaceId, projectId, createdBy: userId, createdAt: '2026-10-17T00:00:00.000Z', revision: 0, state: 'ready', proposal: { preparedAt: '2026-10-17T00:00:00.000Z', graphRevision: 1, expectedArtifactRevisions: {}, expectedSourceRevisions: {}, sourceRefs: [], changes: [] }, acceptedGroupIds: [], rejectedGroupIds: [] } };
}

describe('change review project list client', () => {
  it('keeps the list inside the current workspace and project', async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => Response.json({ changesets: [f.changeset], nextAfter: null, authzVersion: 3 }));
    const result = await createChangeReviewClient(f.viewer, f.projectId, fetcher as typeof fetch).list();
    expect(result.changesets.map((item) => item.id)).toEqual([f.changeset.id]);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/api/changesets?workspaceId=${f.viewer.workspaceId}`), expect.objectContaining({ cache: 'no-store' }));
  });

  it('rejects a valid-looking response from another project', async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => Response.json({ changesets: [{ ...f.changeset, projectId: randomUUID() }], nextAfter: null, authzVersion: 3 }));
    await expect(createChangeReviewClient(f.viewer, f.projectId, fetcher as typeof fetch).list()).rejects.toBeInstanceOf(ReviewError);
  });
});
