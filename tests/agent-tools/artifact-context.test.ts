import { describe, expect, it } from 'vitest';
import { excerptArtifact } from '../../src/features/agent-tools/server/artifact-context';

const ids = {
  artifact: '00000000-0000-4000-8000-000000000001',
  textSource: '00000000-0000-4000-8000-000000000002', textVersion: '00000000-0000-4000-8000-000000000012',
  fillSource: '00000000-0000-4000-8000-000000000003', fillVersion: '00000000-0000-4000-8000-000000000013',
};

describe('assistant artifact context provenance', () => {
  it('projects the text binding for displayed design text and never picks the fill binding by array order', () => {
    const excerpt = excerptArtifact({
      artifactId: ids.artifact, revision: 3, title: 'Offer card', sourceRefs: [], lockedIds: [],
      content: { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 1000, height: 1000, unit: 'px', background: '#fff', layers: [{ id: 'price', type: 'text', transform: { x: 0, y: 0, width: 200, height: 60, rotation: 0 }, style: { fill: '#000' }, text: '2 500 KZT' }] }] },
      bindings: [
        { targetElementId: 'price', targetProperty: 'fill', sourceRef: { sourceId: ids.fillSource, sourceVersionId: ids.fillVersion, revision: 1 }, transformId: 'brand-fill', updateMode: 'propose' },
        { targetElementId: 'price', targetProperty: 'text', sourceRef: { sourceId: ids.textSource, sourceVersionId: ids.textVersion, revision: 1 }, transformId: 'money-format', updateMode: 'deterministic' },
      ],
    });
    expect(excerpt.targets[0]).toMatchObject({ targetId: 'price', targetProperty: 'text', text: '2 500 KZT', sourceRef: { sourceId: ids.textSource } });
  });

  it('uses plan text provenance rather than an unrelated value binding', () => {
    const excerpt = excerptArtifact({
      artifactId: ids.artifact, revision: 1, title: 'Delivery plan', sourceRefs: [], lockedIds: [],
      content: { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{ id: 'prepare', title: 'Prepare order', status: 'todo', resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [] }] },
      bindings: [
        { targetElementId: 'prepare', targetProperty: 'value', sourceRef: { sourceId: ids.fillSource, sourceVersionId: ids.fillVersion, revision: 1 }, transformId: 'quantity', updateMode: 'propose' },
        { targetElementId: 'prepare', targetProperty: 'text', sourceRef: { sourceId: ids.textSource, sourceVersionId: ids.textVersion, revision: 1 }, transformId: 'source-text', updateMode: 'propose' },
      ],
    });
    expect(excerpt.targets[0]).toMatchObject({ targetId: 'prepare', targetProperty: 'text', sourceRef: { sourceId: ids.textSource } });
  });
});
