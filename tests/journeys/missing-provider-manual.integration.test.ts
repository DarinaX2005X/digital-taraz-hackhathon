import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { RunSchema, type Run } from '../../src/contracts/runs';
import { ArtifactSnapshotSchema, CommandReceiptSchema } from '../../src/features/artifacts/contracts';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { DemoRunStartedSchema, DemoSessionSchema, DemoStartedSchema } from '../../src/features/demo/contracts';
import { demoCopy } from '../../src/features/demo/locales';

let origin: string;

class Client {
  cookies = new Map<string, string>();

  async request(path: string, method = 'GET', body?: unknown, key?: string) {
    const headers = new Headers();
    if (method !== 'GET') {
      headers.set('origin', origin);
      headers.set('content-type', 'application/json');
    }
    if (key) headers.set('idempotency-key', key);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]!;
      const split = first.indexOf('=');
      const name = first.slice(0, split);
      const value = first.slice(split + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }
}

async function waitForConfigurationFailure(client: Client, sessionId: string, runId: string): Promise<Run> {
  const deadline = Date.now() + 120_000;
  let run: Run | undefined;
  while (Date.now() < deadline) {
    const response = await client.request(`/api/demo/sessions/${sessionId}/runs/${runId}`);
    expect(response.status).toBe(200);
    run = RunSchema.parse(await response.json());
    if (run.state === 'waiting_input' && run.failure === 'configuration') return run;
    if (run.failure || ['completed', 'failed', 'cancelled'].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`MISSING_PROVIDER_STATE_${run?.state ?? 'missing'}_${run?.failure ?? 'no-failure'}`);
}

beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  if (new URL(origin).hostname !== '127.0.0.1') throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  const forbidden = [
    'OPENROUTER_API_KEY',
    'BLOB_READ_WRITE_TOKEN',
    'R2_ACCOUNT_ID',
    'R2_BUCKET_NAME',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ].filter((name) => process.env[name]);
  if (forbidden.length || (process.env.TIRLIK_STORAGE_DRIVER ?? 'local') !== 'local') {
    throw new Error(`LOCAL_KEYLESS_RUNTIME_REQUIRED:${forbidden.join(',') || 'storage-driver'}`);
  }
});

describe('keyless mounted journey keeps manual work durable', () => {
  it('fails only the AI action, then exports and reopens the saved edit over HTTP', async () => {
    const client = new Client();
    const startResponse = await client.request('/api/demo/sessions', 'POST', { locale: 'ru' }, randomUUID());
    expect(startResponse.status).toBe(201);
    const started = DemoStartedSchema.parse(await startResponse.json());
    const initial = DemoSessionSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}`)).json());
    const documentRef = initial.inputRefs[0]!;

    const documentResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/${documentRef.id}?workspaceId=${initial.workspaceId}`);
    expect(documentResponse.status).toBe(200);
    const document = ArtifactSnapshotSchema.parse(await documentResponse.json());
    const target = createArtifactTargetResolver(document.content)('fact-7');
    expect(target).toBeDefined();
    const savedText = 'Сохранённая ручная правка: подготовить первую очередь и не отправлять клиенту без подтверждения.';
    const commandGroupId = randomUUID();
    const commandResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/commands`, 'POST', {
      workspaceId: initial.workspaceId,
      expectedAuthzVersion: 1,
      group: {
        commandGroupId,
        expectedArtifactRevisions: { [documentRef.id]: document.artifact.currentRevision },
        expectedSourceRevisions: {},
        commands: [{
          commandId: randomUUID(),
          artifactId: documentRef.id,
          baseRevision: document.artifact.currentRevision,
          kind: 'document',
          expectedSourceRevisions: {},
          reason: 'Prove manual work survives an unavailable AI provider',
          operations: [{
            targetId: 'fact-7',
            op: 'set',
            beforeHash: target!.hash,
            value: { type: 'paragraph', attrs: { id: 'fact-7' }, content: [{ type: 'text', text: savedText }] },
          }],
        }],
      },
    }, commandGroupId);
    expect(commandResponse.status).toBe(200);
    expect(CommandReceiptSchema.parse(await commandResponse.json()).committedRevisionVector[documentRef.id]).toBe(1);

    const edited = DemoSessionSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}`)).json());
    expect(edited.inputRefs).toContainEqual({ kind: 'artifact', id: documentRef.id, revision: 1 });
    const runResponse = await client.request(`/api/demo/sessions/${started.sessionId}/runs`, 'POST', {
      goal: demoCopy.ru.goal,
      inputRefs: edited.inputRefs,
      expectedRevision: edited.revision,
    }, randomUUID());
    expect(runResponse.status).toBe(202);
    const runStarted = DemoRunStartedSchema.parse(await runResponse.json());
    const stopped = await waitForConfigurationFailure(client, started.sessionId, runStarted.runId);
    expect(stopped).toMatchObject({
      state: 'waiting_input',
      failure: 'configuration',
      budget: { requestCount: 0, reservedUsd: '0.000000000000', spentUsd: '0.000000000000' },
      actions: { resume: true },
    });

    const preservedResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/${documentRef.id}?workspaceId=${initial.workspaceId}`);
    expect(preservedResponse.status).toBe(200);
    const preserved = ArtifactSnapshotSchema.parse(await preservedResponse.json());
    expect(preserved.artifact.currentRevision).toBe(1);
    expect(JSON.stringify(preserved.content)).toContain(savedText);

    const exportResponse = await client.request(`/api/demo/sessions/${started.sessionId}/exports`, 'POST', {
      workspaceId: initial.workspaceId,
      expectedAuthzVersion: 1,
      locale: 'ru',
      items: [{ artifactId: documentRef.id, revision: 1, formats: ['pdf'] }],
    }, randomUUID());
    expect(exportResponse.status).toBe(201);
    const createdExport = await exportResponse.json() as { id: string };
    const renderResponse = await client.request(`/api/demo/sessions/${started.sessionId}/exports/${createdExport.id}/render`, 'POST', {
      workspaceId: initial.workspaceId,
      expectedAuthzVersion: 1,
    });
    expect(renderResponse.status).toBe(200);
    const rendered = await renderResponse.json() as { status: string; files: { id: string; status: string; format: string }[] };
    expect(rendered).toMatchObject({ status: 'ready', files: [expect.objectContaining({ status: 'ready', format: 'pdf' })] });

    const reopened = new Client();
    reopened.cookies = new Map(client.cookies);
    const reopenedSessionResponse = await reopened.request(`/api/demo/sessions/${started.sessionId}`);
    expect(reopenedSessionResponse.status).toBe(200);
    const reopenedSession = DemoSessionSchema.parse(await reopenedSessionResponse.json());
    expect(reopenedSession.runIds).toContain(runStarted.runId);
    expect(reopenedSession.inputRefs).toContainEqual({ kind: 'artifact', id: documentRef.id, revision: 1 });
    const reopenedArtifactResponse = await reopened.request(`/api/demo/sessions/${started.sessionId}/artifacts/${documentRef.id}?workspaceId=${initial.workspaceId}`);
    expect(reopenedArtifactResponse.status).toBe(200);
    const reopenedArtifact = ArtifactSnapshotSchema.parse(await reopenedArtifactResponse.json());
    expect(reopenedArtifact.artifact.currentRevision).toBe(1);
    expect(JSON.stringify(reopenedArtifact.content)).toContain(savedText);
    const reopenedExportResponse = await reopened.request(`/api/demo/sessions/${started.sessionId}/exports/${createdExport.id}?workspaceId=${initial.workspaceId}`);
    expect(reopenedExportResponse.status).toBe(200);
    const reopenedExport = await reopenedExportResponse.json() as { status: string; files: { id: string; status: string; format: string }[] };
    expect(reopenedExport).toMatchObject({ status: 'ready', files: [expect.objectContaining({ status: 'ready', format: 'pdf' })] });
    const download = await reopened.request(`/api/demo/sessions/${started.sessionId}/exports/${createdExport.id}/files/${reopenedExport.files[0]!.id}?workspaceId=${initial.workspaceId}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(500);
  }, 220_000);
});
