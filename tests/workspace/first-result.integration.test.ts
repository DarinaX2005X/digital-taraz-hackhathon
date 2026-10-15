import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool, testDocument } from '../artifacts/server/test-fixture';
import { createArtifactService } from '@/features/artifacts/server/service';
import { documentCommand } from '@/features/documents/domain/commands';
import { readDocument } from '@/features/documents/domain/document';
import { createProjectViews } from '@/features/workspace/server/project-views';
import { suggestedProjectName } from '@/features/workspace/domain/project-name';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('own work to editable saved result', () => {
  it('preserves the actual goal and document edit through a fresh read and return-to-work selection', async () => {
    const f = await artifactFixture(pool);
    const goal = 'Предложение на 20 стульев. Доставку указать отдельно.';
    const project = await f.projects.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, title: suggestedProjectName(goal, 'Новая работа'), goal, expectedAuthzVersion: 1 });
    const body = { workspaceId: f.workspaceId, projectId: project.project.id, expectedAuthzVersion: 1, title: 'Предложение клиенту', content: testDocument('20 стульев по согласованному прайсу', 'Срок доставки согласуем лично.') };
    const createKey = randomUUID();
    const initial = await f.service.create(f.owner, createKey, body);
    expect((await f.service.create(f.owner, createKey, body)).artifact.id).toBe(initial.artifact.id);
    const desired = readDocument(testDocument('24 стула по согласованному прайсу', 'Срок доставки согласуем лично.'));
    const opened = await f.service.read(f.owner, { workspaceId: f.workspaceId, artifactId: initial.artifact.id });
    const draft = await documentCommand(opened, desired, 'Уточнить количество');
    expect(draft).not.toBeNull();
    const group = { ...draft!, commandGroupId: randomUUID(), commands: draft!.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    const request = { workspaceId: f.workspaceId, expectedAuthzVersion: 1, group };
    const receipt = await f.service.apply(f.owner, request);
    expect(await f.service.apply(f.owner, request)).toEqual(receipt);
    await createProjectViews(pool).record(f.owner, project.project.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, selectedArtifactId: initial.artifact.id });
    const selected = await createProjectViews(pool).read(f.owner, f.workspaceId, project.project.id);
    const reopened = await createArtifactService(pool).readRoute(f.owner, { projectId: selected.projectId, artifactId: selected.selectedArtifactId! });
    expect(reopened.content).toEqual(desired);
    expect(reopened.artifact.currentRevision).toBe(initial.artifact.currentRevision + 1);
    expect((await f.projects.readRoute(f.owner, project.project.id)).project.goal).toBe(goal);
    expect((await f.service.list(f.owner, { workspaceId: f.workspaceId, projectId: project.project.id })).artifacts.map((artifact) => artifact.id)).toEqual([initial.artifact.id]);
  });
});
