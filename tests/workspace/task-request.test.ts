import { describe, expect, it } from 'vitest';
import type { SourceSummary } from '@/contracts/sources';
import { prepareTaskRequest, readTaskRequest, selectedSourceRefs, taskRequestKey } from '@/features/workspace/domain/task-request';
import { readEntryDraft } from '@/features/workspace/domain/entry-draft';
import { suggestedProjectName } from '@/features/workspace/domain/project-name';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const key = '00000000-0000-4000-8000-000000000005';
const source: SourceSummary = { id: sourceId, workspaceId, projectId, title: 'Own price list', accessClass: 'internal', revision: 7, currentVersionId: versionId, status: 'ready', format: 'csv', fileName: 'prices.csv', byteSize: 100, createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' };

describe('own-task request continuity', () => {
  it('pins the selected source revision and retains the exact request through a lost response and reload', () => {
    const request = prepareTaskRequest({ workspaceId, projectId, goal: '  Prepare my offer  ', locale: 'ru', sources: [source], selected: [sourceId] }, key, 1);
    expect(request.input.inputRefs).toEqual([{ kind: 'source', id: sourceId, revision: 7 }]);
    expect(request.input.goal).toBe('Prepare my offer');
    expect(readTaskRequest(JSON.stringify(request), workspaceId, projectId, 10_000_000_000)).toEqual(request);
    // A pending business action must not be silently discarded because a day passed.
    expect(request.key).toBe(key);
  });
  it('rejects mismatched project context and keeps account storage keys separate', () => {
    const request = prepareTaskRequest({ workspaceId, projectId, goal: 'Offer', locale: 'kk', sources: [], selected: [] }, key, 1);
    expect(readTaskRequest(JSON.stringify(request), workspaceId, sourceId, 2)).toBeUndefined();
    expect(taskRequestKey('owner-one', projectId)).not.toBe(taskRequestKey('owner-two', projectId));
  });
  it('does not replace missing or incomplete selected inputs with other files', () => {
    expect(() => selectedSourceRefs([], [sourceId])).toThrow('source-unavailable');
    expect(() => selectedSourceRefs([{ ...source, status: 'partial' }], [sourceId])).toThrow('source-unavailable');
    expect(selectedSourceRefs([source], [sourceId, sourceId])).toHaveLength(1);
    expect(selectedSourceRefs([{ ...source, revision: 9 }], [sourceId], [{ kind: 'source', id: sourceId, revision: 7 }])).toEqual([{ kind: 'source', id: sourceId, revision: 7 }]);
  });
  it('supports a real user text task with no source files', () => {
    expect(prepareTaskRequest({ workspaceId, projectId, goal: 'Draft a client question list', locale: 'en', sources: [], selected: [] }, key, 1).input.inputRefs).toEqual([]);
  });
});

describe('first-work recovery', () => {
  it('restores an immutable project create attempt with its original authority', () => {
    const draft = { title: '', goal: 'My client request', workspaceName: '', selectedWorkspace: workspaceId, projectRequest: { key, intent: 'original', input: { workspaceId, title: 'Client request', goal: 'My client request', expectedAuthzVersion: 8 } } };
    expect(readEntryDraft(JSON.stringify(draft))).toEqual(draft);
    expect(readEntryDraft(JSON.stringify({ ...draft, projectRequest: { ...draft.projectRequest, key: 'invalid' } }))).toBeUndefined();
  });
  it('makes a useful bounded name without requesting another mandatory input', () => {
    expect(suggestedProjectName('  Proposal for Darina\nInclude delivery', 'New work')).toBe('Proposal for Darina');
    expect(suggestedProjectName('a'.repeat(200), 'New work')).toHaveLength(78);
    expect(suggestedProjectName(' ', 'Жаңа жұмыс')).toBe('Жаңа жұмыс');
  });
});
