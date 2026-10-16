import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BuildCampaignWorkInputSchema,
  BusinessWorkResultSchema,
  type BuildCampaignWorkInput,
  type BusinessWorkToolDescriptor,
} from '../../src/contracts/business-work';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { businessRegistration } from '../../src/features/agent-tools/server/business';
import { businessWorkToolExtension } from '../../src/features/agent-tools/server/business-work-adapter';
import { createArtifactService } from '../../src/features/artifacts/server/service';
import { createCampaignWorkService } from '../../src/features/campaigns/server/build-campaign-work';
import type { ModelOutput, ModelRequest } from '../../src/features/runs/server/gateway';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;

beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

const call = (name: string, args: unknown): ModelOutput => ({
  content: null,
  toolCalls: [{ id: `${name}_${randomUUID()}`, name, arguments: JSON.stringify(args) }],
});

function modelContext(request: ModelRequest) {
  return JSON.parse(request.messages[1]!.content!) as {
    sources: {
      sourceRef: { sourceId: string; sourceVersionId: string; revision: number };
      title: string;
    }[];
    savedResults: { id: string; title: string }[];
    selectedOptionId: string | null;
    workDecision: { id: string; options: { id: string; artifactIds: string[] }[] } | null;
  };
}

describe('real campaign producer through the durable business runtime', () => {
  it('uses a pinned source, pauses for a human direction, persists editable results, and completes without publishing', async () => {
    const fixture = await artifactFixture(pool);
    const sources = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'campaign-runtime-journey', randomUUID())));
    const sourceBytes = Buffer.from('Confirmed price: 2 500 000 KZT. Release date: 2026-11-16. No advertising uplift has been promised.');
    const initialized = await sources.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      title: 'Confirmed campaign terms',
      fileName: 'campaign-terms.txt',
      format: 'text',
      size: sourceBytes.length,
    }));
    await sources.put(fixture.owner, fixture.workspaceId, initialized.upload.id, initialized.token!, new Blob([new Uint8Array(sourceBytes)]).stream());
    const finalized = (await sources.finalize(fixture.owner, fixture.workspaceId, initialized.upload.id)).upload;
    const inputRef = { kind: 'source' as const, id: finalized.sourceId, revision: 1 };

    const executeCampaign = createCampaignWorkService({ pool });
    const campaignDescriptor: BusinessWorkToolDescriptor<BuildCampaignWorkInput> = {
      name: 'campaign.build-work',
      version: 1,
      purpose: 'Build two evidence-bound editable campaign directions without publishing them.',
      inputSchema: BuildCampaignWorkInputSchema,
      outputSchema: BusinessWorkResultSchema,
      policy: 'edit',
      costClass: 'local',
      deadlineMs: 30_000,
      idempotency: 'operation-receipt',
      execute: (input, context) => executeCampaign(BuildCampaignWorkInputSchema.parse(input), context),
    };
    const complete = vi.fn(async (request: ModelRequest): Promise<ModelOutput> => {
      if (request.jsonSchema) return { content: JSON.stringify({ verdict: 'ready', findings: [] }), toolCalls: [] };
      const context = modelContext(request);
      if (!context.savedResults.length) {
        expect(request.tools?.map((tool) => tool.name)).toContain('campaign_build_work');
        const sourceRef = context.sources.find((source) => source.title === 'Confirmed campaign terms')?.sourceRef;
        if (!sourceRef) throw new Error('PINNED_CAMPAIGN_SOURCE_MISSING');
        return call('campaign_build_work', {
          brief: 'Подготовить RU/KK комплект о подтверждённых условиях без выдуманных скидок, отзывов и обещаний результата.',
          sourceRefs: [sourceRef],
          assetRefs: [],
          brandRef: null,
          conditions: [
            { id: 'price', kind: 'price', value: { currency: 'KZT', minorUnits: '250000000' }, sourceRef },
            { id: 'release-date', kind: 'date', value: '2026-11-16', sourceRef },
          ],
          formats: [
            { id: 'square-ru', width: 1080, height: 1080, unit: 'px', locale: 'ru' },
            { id: 'story-kk', width: 1080, height: 1920, unit: 'px', locale: 'kk' },
          ],
          budgetRef: null,
          planInput: null,
        });
      }
      expect(context.workDecision).toMatchObject({ id: 'campaign-direction' });
      expect(context.selectedOptionId).toBe('editorial');
      return call('finish_work', { summary: 'The human-selected editable campaign direction is ready for review and remains unpublished.' });
    });

    const registration = businessRegistration(pool, {
      gateway: { complete },
      extensions: [businessWorkToolExtension([campaignDescriptor])],
    });
    const registry = createRunRegistry([registration.capability], registration.tools);
    const service = createRunService(pool, registry);
    const created = await service.create(fixture.owner, {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      capabilityId: 'business.goal',
      capabilityVersion: 1,
      goal: 'Подготовить два редактируемых варианта кампании на русском и казахском по подтверждённым условиям.',
      locale: 'ru',
      inputRefs: [inputRef],
    }, randomUUID());

    const drain = async (runId: string) => {
      const claim = await service.claim();
      expect(claim?.runId).toBe(runId);
      for (let index = 0; index < 20; index++) {
        if (await service.executeStep(claim!) === 'stopped') return service.read(fixture.owner, runId);
      }
      throw new Error('CAMPAIGN_RUNTIME_STEP_BOUND');
    };

    const waiting = await drain(created.id);
    expect(waiting).toMatchObject({
      state: 'waiting_input',
      failure: null,
      progress: {
        workDecision: {
          id: 'campaign-direction',
          selectedOptionId: null,
          options: [{ id: 'editorial' }, { id: 'split' }],
        },
      },
      budget: { requestCount: 0, reservedUsd: '0.000000000000', spentUsd: '0.000000000000' },
    });
    expect(waiting.progress.results).toHaveLength(3);
    const artifactService = createArtifactService(pool);
    const snapshots = await Promise.all(waiting.progress.results.map((result) => artifactService.read(fixture.owner, {
      workspaceId: fixture.workspaceId,
      artifactId: result.id,
      expectedProjectId: fixture.projectId,
    })));
    expect(snapshots.map((snapshot) => snapshot.artifact.kind)).toEqual(['document', 'design', 'design']);
    expect(snapshots.every((snapshot) => snapshot.artifact.currentRevision === 0)).toBe(true);
    expect(snapshots.every((snapshot) => snapshot.artifact.sourceRefs.some((ref) => ref.sourceId === finalized.sourceId))).toBe(true);
    const designSnapshots = snapshots.filter((snapshot) => snapshot.content.kind === 'design');
    expect(designSnapshots).toHaveLength(2);
    expect(designSnapshots.every((snapshot) => snapshot.content.kind === 'design' && snapshot.content.pages.length === 2)).toBe(true);

    const selected = await service.resume(fixture.owner, created.id, {
      expectedEpoch: waiting.epoch,
      selectedOptionId: 'editorial',
    }, randomUUID());
    const completed = await drain(selected.id);
    expect(completed).toMatchObject({ state: 'completed', failure: null, progress: { workDecision: { selectedOptionId: 'editorial' } } });
    expect(completed.progress.results.map((result) => result.id)).toEqual(waiting.progress.results.map((result) => result.id));
    const campaignStep = completed.steps.find((step) => step.toolName === 'business.campaign_build_work');
    expect(campaignStep).toMatchObject({ state: 'succeeded', resultRefs: expect.arrayContaining(waiting.progress.results.map((result) => expect.objectContaining({ id: result.id }))) });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_tool_receipts WHERE run_id=$1 AND step_id=$2', [completed.id, campaignStep!.id])).rows[0]).toEqual({ count: 1 });
    expect((await pool.query('SELECT count(*)::int AS count FROM export_jobs WHERE workspace_id=$1', [fixture.workspaceId])).rows[0]).toEqual({ count: 0 });
  }, 180_000);
});
