import { describe, expect, it } from 'vitest';
import type { SourceSummary } from '@/contracts/sources';
import { addComposerFile, matchesComposerFile, readyComposerSources, restoreComposerAttachments, sourceUploadInput } from '@/features/workspace/domain/composer-attachments';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const attachmentId = '00000000-0000-4000-8000-000000000005';
const operationKey = '00000000-0000-4000-8000-000000000006';

describe('own-data-first composer attachments', () => {
  it('accepts bounded supported files and derives an immutable upload request', () => {
    const attachment = addComposerFile({ name: 'prices.xlsx', size: 1024 }, attachmentId, operationKey)!;
    expect(attachment).toMatchObject({ id: attachmentId, operationKey, fileName: 'prices.xlsx', format: 'xlsx', state: 'local' });
    expect(sourceUploadInput(attachment, workspaceId, projectId)).toEqual({
      workspaceId, projectId, expectedRevision: 0, title: 'prices.xlsx', fileName: 'prices.xlsx', size: 1024,
      format: 'xlsx', accessClass: 'internal', options: { encoding: 'utf-8' },
    });
    expect(addComposerFile({ name: 'script.exe', size: 10 }, attachmentId, operationKey)).toBeUndefined();
  });

  it('requires only unfinished local files to be reselected and preserves a retryable stored original after refresh', () => {
    const local = addComposerFile({ name: 'request.docx', size: 40 }, attachmentId, operationKey)!;
    const ready = { ...local, id: sourceId, state: 'ready' as const, sourceId, currentVersionId: versionId, revision: 1 };
    const review = { ...local, id: projectId, state: 'needs-review' as const, sourceId };
    const retry = { ...local, id: operationKey, state: 'failed' as const, sourceId, uploadId: projectId };
    const restored = restoreComposerAttachments([local, ready, review, retry]);
    expect(restored.map((item) => item.state)).toEqual(['needs-file', 'ready', 'needs-review', 'retry-processing']);
    expect(matchesComposerFile(restored[0]!, { name: 'request.docx', size: 40 })).toBe(true);
    expect(matchesComposerFile(restored[0]!, { name: 'request.docx', size: 41 })).toBe(false);
  });

  it('allows a run only from the exact ready source revision', () => {
    const attachment = { ...addComposerFile({ name: 'prices.xlsx', size: 1024 }, attachmentId, operationKey)!, state: 'ready' as const, sourceId, currentVersionId: versionId, revision: 3 };
    const source: SourceSummary = { id: sourceId, workspaceId, projectId, title: 'Prices', accessClass: 'internal', revision: 3, currentVersionId: versionId, metadataRevision: 1, lifecycleState: 'active', trashedAt: null, status: 'ready', format: 'xlsx', fileName: 'prices.xlsx', byteSize: 1024, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' };
    expect(readyComposerSources([attachment], [source])).toEqual([source]);
    expect(() => readyComposerSources([{ ...attachment, state: 'failed' }], [source])).toThrow('composer-source-not-ready');
    expect(() => readyComposerSources([attachment], [{ ...source, revision: 4 }])).toThrow('composer-source-changed');
  });
});
