import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { createArtifactState } from '@/features/artifacts/domain/content-state';
import type { DesignContent, DesignLayer } from '@/features/designs/domain/model';

export const ids = { user: '6d19d182-564b-4e56-9564-eab4e874a07d', workspace: '734caa52-d305-4c86-a32c-adccac33ed68', project: 'a385515e-8688-46a0-84b8-fdb230e7cdca', artifact: 'c3f06d90-d2a7-4ba5-b09e-c8396d9f971c', version: '04ef1150-0c23-4c56-be7a-8ce4b5f41f13', content: '507b9a02-a56e-4387-9f34-c084d1faadbb', image: '90ad0867-3fb5-4003-b5ab-598b9658f6c1' };
export const at = '2026-10-14T12:00:00.000Z';
export function textLayer(id: string, x = 10, y = 20): DesignLayer { return { id, type: 'text', text: `Қазақша ${id}`, transform: { x, y, width: 200, height: 50, rotation: 0 }, style: { fill: '#202624', fontFamily: 'Noto Sans', fontSize: 24 } }; }
export function content(): DesignContent { return { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 1080, height: 1080, unit: 'px', background: '#ffffff', layers: [textLayer('title'), { id: 'photo', type: 'image', assetId: ids.image, transform: { x: 300, y: 400, width: 240, height: 180, rotation: 0 }, style: { opacity: 1 } }, textLayer('price', 600, 100)] }] }; }
export function state() { return createArtifactState(content()); }
export function snapshot(): ArtifactSnapshot {
  const contentRef = { id: ids.content, hash: '1'.repeat(64) };
  return {
    viewer: { userId: ids.user, workspaceId: ids.workspace, authzVersion: 1 },
    artifact: { id: ids.artifact, workspaceId: ids.workspace, projectId: ids.project, kind: 'design', schemaVersion: 1, currentRevision: 1, title: 'Жаңа ұсыныс', status: 'draft', contentRef, sourceRefs: [], bindings: [], createdBy: ids.user, updatedAt: at },
    version: { id: ids.version, artifactId: ids.artifact, revision: 1, parentRevision: null, contentRef, snapshotHash: '2'.repeat(64), title: 'Жаңа ұсыныс', reason: 'Created', authorId: ids.user, createdAt: at, inputRevisions: {} },
    content: content(), permissions: { edit: true, rename: true, duplicate: true, move: true, archive: true, trash: true, restore: true, purge: true }, sourceFreshness: [], history: [], cursor: '0',
  };
}
