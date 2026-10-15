import { describe, expect, it } from 'vitest';

import { buildAiPlan } from '@/features/operations/ai-plan';

const sourceId = '00000000-0000-4000-8000-000000000020';
const sourceVersionId = '00000000-0000-4000-8000-000000000021';
const fragmentId = '00000000-0000-4000-8000-000000000022';
const artifactId = '00000000-0000-4000-8000-000000000023';
let sequence = 100;
const context = () => ({
  goal: 'Prepare the launch by 10 February 2026 and review it.',
  defaultTimezone: 'Asia/Qyzylorda',
  sources: [{ sourceRef: { sourceId, sourceVersionId, revision: 2 }, fragments: [{ id: fragmentId, evidenceText: 'Approved effort is 2 person-hours.' }] }],
  linkedArtifactIds: [artifactId],
  makeId: () => `item_${sequence++}`,
});

describe('typed AI plan construction', () => {
  it('creates canonical stable dependencies and pinned provenance', () => {
    const result = buildAiPlan({ title: 'Launch', tasks: [
      { key: 'prepare', title: 'Prepare', schedule: { kind: 'date', startDate: '2026-02-10', endDate: '2026-02-10', basis: { kind: 'goal', detail: '10 February 2026' } }, duration: { minutes: 60, basis: { kind: 'assumption', note: 'Assumption: allow one hour for preparation.' } }, effort: { decimal: '2', unit: 'person-hours', basis: { kind: 'source', sourceId, fragmentId, detail: '2 person-hours' } }, dependencies: [], checklist: ['Collect inputs'], linkedArtifactIds: [artifactId], evidence: [] },
      { key: 'review', title: 'Review', dependencies: ['prepare'], checklist: [], linkedArtifactIds: [], evidence: [{ kind: 'goal', detail: 'review it' }] },
    ] }, context());
    expect(result.content.entries[1]?.dependencies).toEqual([result.content.entries[0]?.id]);
    expect(result.content.entries[0]?.notes).toContain('Assumption: allow one hour');
    expect(result.content.entries[0]?.linkedArtifactIds).toEqual([artifactId]);
    expect(result.sourceRefs).toEqual([{ sourceId, sourceVersionId, revision: 2, fragmentId }]);
  });

  it('rejects unseen evidence and dependency cycles', () => {
    expect(() => buildAiPlan({ title: 'Bad', tasks: [{ key: 'one', title: 'One', dependencies: [], checklist: [], linkedArtifactIds: [], evidence: [{ kind: 'source', sourceId, fragmentId, detail: 'not in the fragment' }] }] }, context())).toThrow('AI_PLAN_SOURCE_NOT_IN_CONTEXT');
    expect(() => buildAiPlan({ title: 'Cycle', tasks: [
      { key: 'one', title: 'One', dependencies: ['two'], checklist: [], linkedArtifactIds: [], evidence: [] },
      { key: 'two', title: 'Two', dependencies: ['one'], checklist: [], linkedArtifactIds: [], evidence: [] },
    ] }, context())).toThrow('cyclic-plan-dependency');
  });
});
