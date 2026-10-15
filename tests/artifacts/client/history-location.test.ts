import { describe, expect, it } from 'vitest';
import { artifactHistoryHref, confirmedHistoryMove } from '@/features/artifacts/client/history-location';
import { buildArtifactOperation, createActionDraft } from '@/features/artifacts/ui/action-dialog';
import { ids, snapshot } from './fixtures';

describe('history move location', () => {
  it('uses the confirmed destination for a move and its replay, never an uncertain request', () => {
    const initial = snapshot(), action = { kind: 'move' as const, snapshot: initial };
    const operation = buildArtifactOperation(action, { ...createActionDraft(action), projectId: ids.otherArtifact });
    const result = { viewer: initial.viewer, artifact: { ...initial.artifact, projectId: ids.otherArtifact, currentRevision: 2 }, version: { ...initial.version, revision: 2 }, cursor: '2' };
    expect(confirmedHistoryMove(operation, undefined)).toBeNull();
    expect(confirmedHistoryMove(operation, result)).toEqual({ projectId: ids.otherArtifact, href: artifactHistoryHref(ids.otherArtifact, ids.artifact), revision: 2 });
    expect(confirmedHistoryMove({ ...operation, state: 'uncertain' }, result)).toEqual(confirmedHistoryMove(operation, result));
    expect(confirmedHistoryMove(operation, { ...result, artifact: { ...result.artifact, projectId: ids.project } })).toBeNull();
    expect(confirmedHistoryMove(undefined, result)).toBeNull();
  });
});
