import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ArtifactContentSchema, ArtifactSnapshotSchema, CommandReceiptSchema, SourceFreshnessSchema, type CommandReceipt } from '../../../src/features/artifacts/contracts';
import { decodeWorkspaceCursor, encodeWorkspaceCursor } from '../../../src/features/artifacts/server/workspace-events';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { artifacts, artifactVersionPins, artifactVersions } from '../../../src/server/db/artifact-schema';
import { identityProjectGrants } from '../../../src/server/db/identity-schema';
import { projects } from '../../../src/server/db/project-schema';

function receipt(): CommandReceipt {
  const artifactId = randomUUID();
  const groupId = randomUUID();
  const vector = { [artifactId]: 3 };
  return {
    commandGroupId: groupId, committedRevisionVector: vector,
    artifacts: [{ artifactId, revision: 3, versionId: randomUUID(), contentRef: { id: randomUUID(), hash: 'a'.repeat(64) } }],
    cursor: encodeWorkspaceCursor({ workspaceId: randomUUID(), authzVersion: 2, position: '9' }),
    historyGroup: { commandGroupId: groupId, actorId: randomUUID(), reason: 'Synthetic confirmed price update', origin: 'human', createdAt: '2026-10-14T00:00:00.000Z', state: 'active', committedRevisionVector: vector,
      artifacts: [{ artifactId, title: 'Synthetic proposal', kind: 'document', committedRevision: 3, currentRevision: 3 }], hasUnavailableArtifacts: false, canUndo: true, canRedo: false },
  };
}

describe('artifact transport contracts', () => {
  it('accepts a compact acknowledgement and rejects contradictory group/vector identities', () => {
    const good = receipt();
    expect(CommandReceiptSchema.parse(good)).toEqual(good);
    expect(CommandReceiptSchema.safeParse({ ...good, commandGroupId: randomUUID() }).success).toBe(false);
    expect(CommandReceiptSchema.safeParse({ ...good, committedRevisionVector: {} }).success).toBe(false);
    expect(CommandReceiptSchema.safeParse({ ...good, artifacts: [...good.artifacts, good.artifacts[0]] }).success).toBe(false);
    expect(CommandReceiptSchema.safeParse({ ...good, historyGroup: { ...good.historyGroup, hasUnavailableArtifacts: true } }).success).toBe(false);
    expect(CommandReceiptSchema.safeParse({ ...good, historyGroup: { ...good.historyGroup, canRedo: true } }).success).toBe(false);
  });

  it('preserves the realistic manual text in a typed ProseMirror snapshot and rejects a foreign viewer scope', async () => {
    const fixture = JSON.parse(await readFile(new URL('../../../fixtures/business/changes/homegoods/manual-edit.json', import.meta.url), 'utf8')) as { manualField: { value: string; fieldId: string } };
    const ack = receipt(); const item = ack.artifacts[0]!; const actorId = ack.historyGroup.actorId; const workspaceId = randomUUID();
    const content = { kind: 'document' as const, schemaVersion: 1 as const, document: { type: 'doc' as const, attrs: { id: 'document' }, content: [{ type: 'paragraph' as const, attrs: { id: fixture.manualField.fieldId }, content: [{ type: 'text' as const, text: fixture.manualField.value }] }] } };
    const snapshot = {
      viewer: { userId: actorId, workspaceId, authzVersion: 2 },
      artifact: { id: item.artifactId, workspaceId, projectId: randomUUID(), kind: 'document', schemaVersion: 1, currentRevision: 3, title: 'Synthetic proposal', status: 'draft', contentRef: item.contentRef, sourceRefs: [], bindings: [], createdBy: actorId, updatedAt: ack.historyGroup.createdAt },
      content, version: { id: item.versionId, artifactId: item.artifactId, revision: 3, parentRevision: 2, contentRef: item.contentRef, snapshotHash: 'b'.repeat(64), title: 'Synthetic proposal', reason: ack.historyGroup.reason, authorId: actorId, createdAt: ack.historyGroup.createdAt, inputRevisions: {} },
      permissions: { edit: true, rename: true, duplicate: true, move: true, archive: true, trash: true, restore: true, purge: false }, sourceFreshness: [], history: [ack.historyGroup], cursor: ack.cursor,
    };
    expect(ArtifactSnapshotSchema.parse(snapshot).content).toEqual(content);
    expect(ArtifactSnapshotSchema.safeParse({ ...snapshot, viewer: { ...snapshot.viewer, workspaceId: randomUUID() } }).success).toBe(false);
    expect(ArtifactSnapshotSchema.safeParse({ ...snapshot, version: { ...snapshot.version, revision: 2 } }).success).toBe(false);
    expect(ArtifactContentSchema.safeParse({ kind: 'document', schemaVersion: 999, document: content.document }).success).toBe(false);
    expect(ArtifactContentSchema.safeParse({ kind: 'document', schemaVersion: 1, html: '<script>unsupported</script>' }).success).toBe(false);
  });

  it('keeps unauthorized or unresolved source dimensions unknown without disclosing a head', () => {
    const sourceRef = { sourceId: randomUUID(), sourceVersionId: randomUUID(), revision: 1 };
    expect(SourceFreshnessSchema.safeParse({ sourceRef, status: 'unknown', sourceStatus: 'unknown' }).success).toBe(true);
    expect(SourceFreshnessSchema.safeParse({ sourceRef, status: 'unknown', sourceStatus: 'unknown', currentVersionId: randomUUID() }).success).toBe(false);
    expect(SourceFreshnessSchema.safeParse({ sourceRef, status: 'current', sourceStatus: 'current', factStatus: 'unknown' }).success).toBe(false);
  });

  it('roundtrips scoped bigint cursors and rejects alternate encodings and overflow', () => {
    const value = { workspaceId: randomUUID(), authzVersion: 3, position: '9007199254740993' };
    const encoded = encodeWorkspaceCursor(value);
    expect(decodeWorkspaceCursor(encoded)).toEqual(value);
    expect(decodeWorkspaceCursor(`${encoded}=`)).toBeUndefined();
    expect(decodeWorkspaceCursor(Buffer.from(JSON.stringify({ ...value, position: '9999999999999999999' })).toString('base64url'))).toBeUndefined();
    expect(decodeWorkspaceCursor(Buffer.from(JSON.stringify({ ...value, workspaceId: 'other' })).toString('base64url'))).toBeUndefined();
  });

  it('keeps canonical project FKs and version validation in the registered Drizzle declarations', () => {
    expect(getTableConfig(projects).uniqueConstraints.map((constraint) => constraint.name)).toContain('projects_workspace_id_id_key');
    expect(getTableConfig(identityProjectGrants).foreignKeys.map((key) => key.getName())).toContain('identity_project_grants_project_fk');
    expect(getTableConfig(artifacts).foreignKeys.map((key) => key.getName())).toContain('artifacts_project_fk');
    expect(getTableConfig(artifactVersions).checks.map((check) => check.name)).toEqual(expect.arrayContaining(['artifact_versions_title_check', 'artifact_versions_status_check', 'artifact_versions_schema_version_check']));
    expect(getTableConfig(artifactVersionPins).foreignKeys.map((key) => key.getName())).toContain('artifact_version_pins_version_fk');
  });
});
