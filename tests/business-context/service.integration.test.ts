import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';
import { createBusinessContextService } from '../../src/features/business-context/server/service';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('business context service in PostgreSQL', () => {
  it('keeps versions immutable, applies explicit overrides, and restores archived owner data', async () => {
    const fixture = await artifactFixture(pool), service = createBusinessContextService(pool);
    const item = { id: 'legal-name', category: 'profile' as const, label: 'Legal name', value: { kind: 'text' as const, value: 'Tirlik LLP' }, sourceRefs: [], confirmed: true, ownerId: fixture.owner.userId };
    const brandKit = { assetRefs: [], colors: ['#112233'], fontFamilies: ['Inter'], voiceRules: ['Plain language'] };
    const created = await service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, scope: 'project', expectedAuthzVersion: await currentArtifactAuthz(pool, fixture.workspaceId), title: 'Company facts', items: [item], brandKit, reason: 'Initial verified facts' });
    const updated = await service.update(fixture.owner, randomUUID(), created.context.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: created.authzVersion, expectedRevision: 1, title: 'Company facts', items: [{ ...item, value: { kind: 'text', value: 'Tirlik Group LLP' } }], brandKit, reason: 'Registered name changed' });

    expect((await service.read(fixture.owner, fixture.workspaceId, created.context.id, 1)).version.items[0]?.value).toEqual({ kind: 'text', value: 'Tirlik LLP' });
    expect(updated.version.revision).toBe(2);
    const used = await service.use(fixture.owner, { workspaceId: fixture.workspaceId, selection: { contextId: created.context.id, revision: 1, itemIds: [item.id] }, overrides: [{ itemId: item.id, value: { kind: 'text', value: 'One-run trading name' } }] });
    expect(used.context.items[0]?.value).toEqual({ kind: 'text', value: 'Tirlik LLP' });
    expect(used.effectiveItems[0]?.value).toEqual({ kind: 'text', value: 'One-run trading name' });

    const archived = await service.setStatus(fixture.owner, randomUUID(), created.context.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: updated.authzVersion, expectedRevision: 2, status: 'archived' });
    expect(archived.context).toMatchObject({ status: 'archived', permissions: { edit: false, archive: true } });
    const restored = await service.setStatus(fixture.owner, randomUUID(), created.context.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: archived.authzVersion, expectedRevision: 2, status: 'active' });
    expect(restored.context).toMatchObject({ status: 'active', permissions: { edit: true, archive: true } });
  });

  it('honors project-scoped read grants without allowing edits or confirmations', async () => {
    const fixture = await artifactFixture(pool), service = createBusinessContextService(pool);
    const created = await service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, scope: 'project', expectedAuthzVersion: await currentArtifactAuthz(pool, fixture.workspaceId), title: 'Restricted facts', items: [], brandKit: { assetRefs: [], colors: [], fontFamilies: [], voiceRules: [] }, reason: 'Access test' });
    await fixture.projects.setGrant(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, userId: fixture.member.userId, scopes: ['read'], expectedAuthzVersion: await currentArtifactAuthz(pool, fixture.workspaceId) });
    const memberView = await service.read(fixture.member, fixture.workspaceId, created.context.id);
    expect(memberView.context.permissions).toMatchObject({ read: true, edit: false, confirm: false, archive: false });
    await expect(service.update(fixture.member, randomUUID(), created.context.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: memberView.authzVersion, expectedRevision: 1, title: 'Forbidden', items: [], brandKit: memberView.version.brandKit, reason: 'Must fail' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
