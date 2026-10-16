import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BuildCampaignWorkInput, WorkExecutionContext } from '@/contracts/business-work';
import { InitSourceUploadSchema } from '@/contracts/sources';
import { createCampaignWorkService } from '@/features/campaigns/server/build-campaign-work';
import { renderDesignFiles } from '@/features/design-export/server/render';
import { createOperationsService } from '@/features/operations/server/service';
import { createSourceService } from '@/features/sources/server/service';
import { LocalSourceStorage } from '@/features/sources/server/storage';
import { artifactFixture, artifactTestPool, currentArtifactAuthz, testDocument } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('campaign work durable bundle', () => {
  it('atomically creates two editable directions, a source brief and a checked plan, then replays the same operation', async () => {
    const fixture = await artifactFixture(pool), operationId = randomUUID();
    const authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const sources = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'campaign-source-tests', randomUUID())));
    const sourceBytes = Buffer.from('condition,value\nprice,2500000 KZT\nrelease-date,2026-11-16\nminimum-order,100 places');
    const sourceUpload = await sources.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({
      workspaceId: fixture.workspaceId, projectId: fixture.projectId, title: 'Confirmed campaign conditions', fileName: 'campaign-conditions.csv', format: 'csv', size: sourceBytes.length,
    }));
    await sources.put(fixture.owner, fixture.workspaceId, sourceUpload.upload.id, sourceUpload.token!, new Blob([new Uint8Array(sourceBytes)]).stream());
    const finalizedSource = (await sources.finalize(fixture.owner, fixture.workspaceId, sourceUpload.upload.id)).upload;
    const sourceRef = { sourceId: finalizedSource.sourceId, sourceVersionId: finalizedSource.versionId!, revision: 1 };
    const imageBytes = await readFile('fixtures/business/services/product-photo.jpg');
    const imageUpload = await sources.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({
      workspaceId: fixture.workspaceId, projectId: fixture.projectId, title: 'Campaign photo with unconfirmed rights', fileName: 'campaign-photo.jpg', format: 'jpeg', size: imageBytes.length,
      options: { encoding: 'utf-8', purpose: 'visual' },
    }));
    await sources.put(fixture.owner, fixture.workspaceId, imageUpload.upload.id, imageUpload.token!, new Blob([new Uint8Array(imageBytes)]).stream());
    const finalizedImage = (await sources.finalize(fixture.owner, fixture.workspaceId, imageUpload.upload.id)).upload;
    const imageSourceRef = { sourceId: finalizedImage.sourceId, sourceVersionId: finalizedImage.versionId!, revision: 1 };
    const budget = await fixture.create(testDocument('Confirmed campaign budget: 2 500 000 KZT.', 'Release remains subject to direction approval.'), 'Campaign budget');
    const operations = createOperationsService(pool);
    const resource = await operations.create(fixture.owner, randomUUID(), {
      workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, displayName: 'Campaign specialist', kind: 'person', timezone: 'Asia/Qyzylorda', accessClass: 'internal',
    });
    const availability = await operations.createAvailability(fixture.owner, randomUUID(), resource.resource.id, {
      workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, expectedResourceRevision: resource.resource.revision, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null,
      weekdays: [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }], exceptions: [], sourceRefs: [], verifiedAt: '2026-10-16T00:00:00.000Z',
    });
    const context: WorkExecutionContext = {
      authority: { kind: 'user', userId: fixture.owner.userId },
      operationId,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      expectedAuthzVersion: authzVersion,
      allowedInputRefs: [{ kind: 'source', id: sourceRef.sourceId, revision: sourceRef.revision }, { kind: 'source', id: imageSourceRef.sourceId, revision: imageSourceRef.revision }, { kind: 'artifact', id: budget.artifact.id, revision: budget.version.revision }],
      inputRevisionVector: { [sourceRef.sourceId]: sourceRef.revision, [imageSourceRef.sourceId]: imageSourceRef.revision, [budget.artifact.id]: budget.version.revision },
      cancelEpoch: 0,
      locale: 'ru',
    };
    const input: BuildCampaignWorkInput = {
      brief: 'Подготовить комплект для новой услуги без выдуманных скидок и обещаний результата.',
      sourceRefs: [sourceRef, imageSourceRef],
      assetRefs: [finalizedImage.id],
      brandRef: null,
      conditions: [
        { id: 'price', kind: 'price', value: { currency: 'KZT', minorUnits: '250000000' }, sourceRef },
        { id: 'release-date', kind: 'date', value: '2026-11-16', sourceRef },
        { id: 'minimum-order', kind: 'quantity', value: { decimal: '100', unit: 'places' }, sourceRef },
      ],
      formats: [
        { id: 'square-ru', width: 1080, height: 1080, unit: 'px', locale: 'ru' },
        { id: 'story-kk', width: 1080, height: 1920, unit: 'px', locale: 'kk' },
      ],
      budgetRef: { artifactId: budget.artifact.id, revision: budget.version.revision },
      planInput: {
        plan: { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{ id: 'prepare', title: 'Prepare selected campaign direction', status: 'todo', durationMinutes: 60, effort: { decimal: '1', unit: 'person-hours' }, resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] }] },
        resourceRefs: [{ id: availability.resource.id, revision: availability.resource.revision, availabilityVersionId: availability.version.id }],
        window: { start: '2026-11-01T03:00:00.000Z', end: '2026-11-30T13:00:00.000Z' },
        lockedEntryIds: [],
        materialConstraints: [],
        objective: 'least-change',
      },
    };
    const build = createCampaignWorkService({ pool });
    const result = await build(input, context);
    expect(result.artifacts.map((item) => item.artifact.kind)).toEqual(['document', 'design', 'design', 'plan']);
    expect(result.decision).toMatchObject({ id: 'campaign-direction', requiresConsent: true });
    expect(result.decision?.options).toHaveLength(2);
    expect(result.checks.find((check) => check.code === 'campaign.plan.feasible')?.status).toBe('passed');
    expect(result.checks.find((check) => check.code === 'campaign.budget.linked')?.status).toBe('passed');
    expect(result.checks.find((check) => check.code === 'campaign.assets.export-rights')?.status).toBe('unknown');
    expect(result.inputRevisionVector).toMatchObject({ [budget.artifact.id]: budget.version.revision, [availability.resource.id]: availability.resource.revision, [availability.version.id]: availability.version.revision });
    expect(result.unresolved.map((item) => item.code)).toContain('campaign.brand.missing');
    expect(result.unresolved.map((item) => item.code)).toContain('campaign.asset.export-rights');
    expect(result.unresolved.map((item) => item.code)).not.toContain('campaign.budget.missing');
    const design = await fixture.service.read(fixture.owner, { workspaceId: fixture.workspaceId, artifactId: result.artifacts[1]!.artifact.id });
    expect(design.content.kind).toBe('design');
    if (design.content.kind !== 'design') throw new Error('design expected');
    expect(design.content.pages).toHaveLength(2);
    expect(design.content.pages.every((page) => page.layers.some((layer) => layer.type === 'text'))).toBe(true);
    expect(design.artifact.sourceRefs).toHaveLength(2);
    expect(design.artifact.sourceRefs).toEqual(expect.arrayContaining([sourceRef, imageSourceRef]));
    expect(design.artifact.bindings).toHaveLength(6);
    expect(design.content.pages.every((page) => page.layers.every((layer) => layer.type !== 'image'))).toBe(true);
    const release = await renderDesignFiles({
      content: design.content, title: design.artifact.title, locale: 'ru', format: 'png',
      assets: { image: async () => { throw new Error('unexpected image'); }, font: async () => { throw new Error('unexpected font'); } },
      provenance: { sourceRefs: design.artifact.sourceRefs, bindings: design.artifact.bindings },
    });
    expect(release.files).toHaveLength(2);
    expect(Buffer.from(release.files[0]!.bytes).subarray(1, 4).toString()).toBe('PNG');
    const savedPlan = await fixture.service.read(fixture.owner, { workspaceId: fixture.workspaceId, artifactId: result.artifacts[3]!.artifact.id });
    expect(savedPlan.content.kind).toBe('plan');
    if (savedPlan.content.kind !== 'plan') throw new Error('plan expected');
    expect(savedPlan.content.entries[0]).toMatchObject({ id: 'prepare', linkedArtifactIds: [...result.artifacts.slice(0, 3).map((item) => item.artifact.id), budget.artifact.id] });

    const replay = await build(input, context);
    expect(replay.artifacts.map((item) => item.artifact.id)).toEqual(result.artifacts.map((item) => item.artifact.id));
    expect(replay.decision).toEqual(result.decision);
  });

  it('rejects source revisions that were not selected by the trusted execution context', async () => {
    const fixture = await artifactFixture(pool), build = createCampaignWorkService({ pool });
    const ref = { sourceId: randomUUID(), sourceVersionId: randomUUID(), revision: 1 };
    const context: WorkExecutionContext = {
      authority: { kind: 'user', userId: fixture.owner.userId }, operationId: randomUUID(), workspaceId: fixture.workspaceId, projectId: fixture.projectId,
      expectedAuthzVersion: 1, allowedInputRefs: [], inputRevisionVector: {}, cancelEpoch: 0, locale: 'en',
    };
    await expect(build({ brief: 'Use a private price.', sourceRefs: [ref], assetRefs: [], brandRef: null, conditions: [{ id: 'price', kind: 'price', value: { currency: 'KZT', minorUnits: '10000' }, sourceRef: ref }], formats: [{ id: 'square', width: 1080, height: 1080, unit: 'px', locale: 'en' }], budgetRef: null, planInput: null }, context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps demo authority unavailable by default and accepts only an explicitly injected isolated principal', async () => {
    const fixture = await artifactFixture(pool), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const context: WorkExecutionContext = {
      authority: { kind: 'demo', sessionId: randomUUID(), userId: fixture.owner.userId, expiresAt: '2026-10-17T00:00:00.000Z' },
      operationId: randomUUID(), workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion,
      allowedInputRefs: [], inputRevisionVector: {}, cancelEpoch: 0, locale: 'kk',
    };
    const input: BuildCampaignWorkInput = {
      brief: 'Таңдалған бағытты өңделетін макет ретінде сақтау.', sourceRefs: [], assetRefs: [], brandRef: null, conditions: [],
      formats: [{ id: 'square-kk', width: 1080, height: 1080, unit: 'px', locale: 'kk' }], budgetRef: null, planInput: null,
    };
    await expect(createCampaignWorkService({ pool })(input, context)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const injected = createCampaignWorkService({
      pool,
      principalForContext: (trusted) => ({ kind: 'job', userId: trusted.authority.userId, authzVersion: trusted.expectedAuthzVersion }),
    });
    const result = await injected(input, context);
    expect(result.artifacts.map((item) => item.artifact.kind)).toEqual(['document', 'design', 'design']);
    expect(result.decision?.options).toHaveLength(2);
  });
});

