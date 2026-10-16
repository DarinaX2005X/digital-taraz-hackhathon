import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectResultSchema } from '@/features/workspace/contracts';
import { SourceInitResultSchema, SourceUploadResultSchema } from '@/contracts/sources';
import { RunSchema } from '@/contracts/runs';
import { createWorkspaceHandlers } from '@/features/workspace/server/handlers';
import { createSourceHandlers } from '@/features/sources/server/handlers';
import { LocalSourceStorage } from '@/features/sources/server/storage';
import { createRunHandlers } from '@/features/runs/server/handlers';
import { createRunRegistry } from '@/features/runs/server/registry';
import { createRunService } from '@/features/runs/server/service';
import { runtimeFixture } from '@/features/runs/server/fixture';
import { documentCommand } from '@/features/documents/domain/commands';
import { readDocument } from '@/features/documents/domain/document';
import { createProjectViews } from '@/features/workspace/server/project-views';
import { artifactFixture, artifactTestPool, testDocument } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('own files to a reopened editable result', () => {
  it('creates one project, pins two ready sources, starts one run, and preserves an edited result across retries', async () => {
    const fixture = await artifactFixture(pool);
    const origin = 'http://localhost:3000';
    const actor = async () => ({
      user: { id: fixture.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', emailVerified: true, locale: 'ru' as const },
      session: { id: fixture.owner.sessionId, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date() },
    });
    const headers = (operationId = randomUUID()) => ({ Origin: origin, 'X-Tirlik-User-Id': fixture.owner.userId, 'Content-Type': 'application/json', 'Idempotency-Key': operationId });
    const projects = createWorkspaceHandlers({ pool, origin, getActor: actor });
    const projectKey = randomUUID();
    const projectBody = { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, title: 'Предложение для клиента', goal: 'Собрать предложение по прайсу и условиям доставки' };
    const projectRequest = () => new Request(`${origin}/api/projects`, { method: 'POST', headers: headers(projectKey), body: JSON.stringify(projectBody) });
    const projectResponse = await projects(projectRequest());
    expect(projectResponse.status).toBe(201);
    const project = ProjectResultSchema.parse(await projectResponse.json()).project;
    expect(ProjectResultSchema.parse(await (await projects(projectRequest())).json()).project.id).toBe(project.id);

    const storage = new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'own-work-tests', randomUUID()));
    const sources = createSourceHandlers({ pool, origin, getActor: actor, storage });
    async function upload(title: string, fileName: string, format: 'csv' | 'text', bytes: Uint8Array) {
      const key = randomUUID();
      const body = { workspaceId: fixture.workspaceId, projectId: project.id, title, fileName, format, size: bytes.byteLength };
      const init = () => sources(new Request(`${origin}/api/sources/uploads/init`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) }));
      const first = SourceInitResultSchema.parse(await (await init()).json());
      const initialized = SourceInitResultSchema.parse(await (await init()).json());
      expect(initialized.upload.id).toBe(first.upload.id);
      const uploadBody = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(uploadBody).set(bytes);
      const put = await sources(new Request(`${origin}/api/sources/uploads/${initialized.upload.id}?workspaceId=${fixture.workspaceId}`, { method: 'PUT', headers: { Origin: origin, 'X-Tirlik-User-Id': fixture.owner.userId, 'X-Upload-Token': initialized.token!, 'Content-Type': 'application/octet-stream' }, body: new Blob([uploadBody]) }));
      expect(put.status).toBe(200);
      const finalize = () => sources(new Request(`${origin}/api/sources/uploads/${initialized.upload.id}/finalize`, { method: 'POST', headers: headers(), body: JSON.stringify({ workspaceId: fixture.workspaceId }) }));
      const ready = SourceUploadResultSchema.parse(await (await finalize()).json());
      expect(ready.upload.status).toBe('ready');
      expect(SourceUploadResultSchema.parse(await (await finalize()).json()).upload.versionId).toBe(ready.upload.versionId);
      return { ...ready.upload, revision: 1 as const };
    }
    const price = await upload('Прайс', 'prices.csv', 'csv', new TextEncoder().encode('SKU,price\nCHAIR,45000\n'));
    const terms = await upload('Условия доставки', 'delivery.txt', 'text', new TextEncoder().encode('Доставка занимает пять рабочих дней.'));

    const runtime = runtimeFixture(true);
    const registry = createRunRegistry([runtime.capability], runtime.tools);
    const runService = createRunService(pool, registry);
    const runs = createRunHandlers({ pool, service: runService, registry, origin, getActor: actor, wake: async () => undefined });
    const runKey = randomUUID();
    const runBody = {
      workspaceId: fixture.workspaceId, projectId: project.id, capabilityId: runtime.capability.id, capabilityVersion: 1,
      goal: projectBody.goal, locale: 'ru', inputRefs: [price, terms].map((source) => ({ kind: 'source' as const, id: source.sourceId, revision: source.revision })),
    };
    const runRequest = () => new Request(`${origin}/api/runs`, { method: 'POST', headers: headers(runKey), body: JSON.stringify(runBody) });
    const runResponse = await runs(runRequest());
    expect(runResponse.status).toBe(202);
    const run = RunSchema.parse(await runResponse.json());
    expect(RunSchema.parse(await (await runs(runRequest())).json()).id).toBe(run.id);
    expect((await pool.query<{ input_refs: unknown[] }>('SELECT input_refs FROM agent_runs WHERE id=$1', [run.id])).rows[0]!.input_refs).toEqual(runBody.inputRefs);

    const created = await fixture.service.create(fixture.owner, randomUUID(), {
      workspaceId: fixture.workspaceId, projectId: project.id, expectedAuthzVersion: 1, title: 'Предложение клиенту',
      content: testDocument('20 стульев по прайсу', 'Доставка — отдельной строкой.'),
      sourceRefs: runBody.inputRefs.map((source) => ({ sourceId: source.id, sourceVersionId: source.id === price.sourceId ? price.versionId! : terms.versionId!, revision: source.revision })),
    });
    const opened = await fixture.service.read(fixture.owner, { workspaceId: fixture.workspaceId, artifactId: created.artifact.id });
    const edited = readDocument(testDocument('24 стула по прайсу', 'Доставка — отдельной строкой, срок пять рабочих дней.'));
    const prepared = await documentCommand(opened, edited, 'Уточнить количество и срок доставки');
    expect(prepared).not.toBeNull();
    const group = { ...prepared!, commandGroupId: randomUUID(), commands: prepared!.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    const receipt = await fixture.service.apply(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, group });
    expect(await fixture.service.apply(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, group })).toEqual(receipt);
    await createProjectViews(pool).record(fixture.owner, project.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, selectedArtifactId: created.artifact.id });
    const selected = await createProjectViews(pool).read(fixture.owner, fixture.workspaceId, project.id);
    const reopened = await fixture.service.readRoute(fixture.owner, { projectId: project.id, artifactId: selected.selectedArtifactId! });
    expect(reopened.content).toEqual(edited);
    expect(reopened.artifact.sourceRefs).toHaveLength(2);
    expect(reopened.artifact.currentRevision).toBe(created.artifact.currentRevision + 1);
  }, 120_000);
});
