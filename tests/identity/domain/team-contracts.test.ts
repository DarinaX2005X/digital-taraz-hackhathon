import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CreateInvitationSchema, DeleteAccountSchema, ScopeListSchema } from '../../../src/features/identity/contracts';

describe('identity team request contracts', () => {
  it('requires explicit, unique and readable grants', () => {
    expect(ScopeListSchema.safeParse(['edit']).success).toBe(false);
    expect(ScopeListSchema.safeParse(['read', 'read']).success).toBe(false);
    expect(ScopeListSchema.safeParse(['read', 'approve', 'export']).success).toBe(true);
    expect(CreateInvitationSchema.safeParse({ email: 'member@example.test', role: 'reviewer', locale: 'ru' }).success).toBe(false);
  });
  it('requires complete, unique ownership decisions without password storage fields', () => {
    const workspaceId = randomUUID();
    const choice = { workspaceId, action: 'delete', confirmationName: 'Synthetic workspace', expectedAuthzVersion: 1 };
    const body = { password: 'synthetic-password', confirmation: 'DELETE_ACCOUNT', workspaces: [choice] };
    expect(DeleteAccountSchema.safeParse(body).success).toBe(true);
    expect(DeleteAccountSchema.safeParse({ ...body, workspaces: [choice, choice] }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ ...body, workspaces: [{ ...choice, confirmationName: undefined }] }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ ...body, workspaces: [{ workspaceId, action: 'transfer', expectedAuthzVersion: 1 }] }).success).toBe(false);
  });
});
