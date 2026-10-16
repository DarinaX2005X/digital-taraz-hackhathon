import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';
import { createOnboardingHandler } from '@/features/onboarding/server/handlers';
import { TOUR_VERSION } from '@/features/onboarding/contracts';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
const origin = 'http://127.0.0.1:59676';

describe('account-scoped optional onboarding', () => {
  it('has no viewing effect, persists skip/resume/replay and rejects stale cross-tab overwrites', async () => {
    const f = await artifactFixture(pool);
    const handler = createOnboardingHandler({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId, name: 'Tour tester', email: 'tour@example.test', emailVerified: true, locale: 'ru' }, session: { id: f.owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) } }) });
    const request = (body?: unknown, actor = f.owner.userId, requestOrigin = origin) => new Request(`${origin}/api/onboarding`, { method: body ? 'POST' : 'GET', headers: { 'X-Tirlik-User-Id': actor, Origin: requestOrigin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(await (await handler(request())).json()).toMatchObject({ revision: 0, state: 'available' });
    expect((await pool.query('SELECT user_id FROM onboarding_progress WHERE user_id=$1', [f.owner.userId])).rowCount).toBe(0);
    const skipped = { version: TOUR_VERSION, expectedRevision: 0, state: 'skipped', completedSteps: [] };
    expect((await handler(request(skipped, f.owner.userId, 'http://foreign.invalid'))).status).toBe(403);
    expect((await handler(request(skipped, f.member.userId))).status).toBe(409);
    expect(await (await handler(request(skipped))).json()).toMatchObject({ revision: 1, state: 'skipped' });
    expect(await (await handler(request(skipped))).json()).toMatchObject({ revision: 1, state: 'skipped' });
    expect(await (await handler(request({ ...skipped, expectedRevision: 1, state: 'active', completedSteps: ['start'] }))).json()).toMatchObject({ revision: 2, state: 'active', completedSteps: ['start'] });
    expect((await handler(request({ ...skipped, expectedRevision: 1 }))).status).toBe(409);
    expect(await (await handler(request({ ...skipped, expectedRevision: 2, state: 'active', completedSteps: ['start'] }))).json()).toMatchObject({ revision: 3, state: 'active', completedSteps: ['start'] });
    expect(await (await handler(request({ ...skipped, expectedRevision: 3, state: 'active' }))).json()).toMatchObject({ revision: 4, completedSteps: [] });
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    expect((await pool.query('SELECT id FROM projects WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
  });
});
