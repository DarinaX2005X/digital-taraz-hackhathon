import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/features/identity/server/auth', () => ({ createIdentityAuth: () => ({ handler: async () => Response.json({ code: 'INVALID_PASSWORD', message: 'Untrusted provider message' }, { status: 400 }) }) }));
import { createIdentityHandlers } from '../../../src/features/identity/server/handlers';

describe('account mutation failure semantics', () => {
  it('keeps a valid session when the current password needs correction', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: 1 }] });
    const handlers = createIdentityHandlers({ pool: { query } as unknown as Pool, origin: 'http://127.0.0.1:3000', secret: 'synthetic-secret-that-is-at-least-32-characters', mailer: { assertReady() {}, async send() {} } });
    const response = await handlers.auth(new Request('http://127.0.0.1:3000/api/auth/change-password', { method: 'POST', headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: 'incorrect password', newPassword: 'new synthetic password' }) }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', messageKey: 'identity.errors.invalidPassword', fieldErrors: { currentPassword: ['identity.errors.invalidPassword'] } });
  });
});
