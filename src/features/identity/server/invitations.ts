import { createHmac, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { INVITATION_TTL_SECONDS, type AccessScope, type CreateInvitationSchema, type IdentityLocale, type InvitationDeliverySchema, type InvitationMutationSchema, type InvitationPreview, type MembershipRole } from '../contracts';
import { canGrant } from '../domain/policy';
import { assertAuthzVersion, identityTransaction, lockIdentityActor, lockWorkspaceAccess, type MembershipRow, type SessionPrincipal, type WorkspaceAccess, type WorkspaceRow } from './access';
import type { IdentityOptions } from './auth';
import { digest, IdentityError } from './http';
import { identityOperation } from './operations';
import { incrementAuthzVersion, membershipDto, requireGrant } from './workspaces';

type Delivery = z.infer<typeof InvitationDeliverySchema>;
interface InvitationRow {
  id: string; workspace_id: string; created_by: string; email: string; role: MembershipRole; scopes: AccessScope[]; locale: IdentityLocale;
  token_nonce: string; expires_at: Date; status: 'pending' | 'accepted' | 'revoked'; accepted_by: string | null;
  delivery_id: string; delivery_state: Delivery; send_epoch: number; unexpired: boolean; leased: boolean;
}
interface DeliveryReceipt { workspaceId: string; authzVersion: number; invitationId: string; deliveryId: string }
const invitationColumns = "*,expires_at>now() AS unexpired,send_lease_until>now() AS leased";

export function createInvitationService(options: IdentityOptions) {
  const { pool, secret, mailer, origin } = options;
  const tokenFor = (id: string, nonce: string) => createHmac('sha256', secret).update(`invitation:${id}:${nonce}`).digest('hex');
  async function inviterCanGrant(transaction: PoolClient, invitation: InvitationRow) {
    const member = (await transaction.query<MembershipRow>("SELECT m.* FROM identity_memberships m JOIN identity_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.state='active' AND u.deletion_requested_at IS NULL AND u.email_verified=true", [invitation.workspace_id, invitation.created_by])).rows[0];
    return !!member && canGrant(member, invitation);
  }
  async function mutation(principal: SessionPrincipal, workspaceId: string, key: string, kind: string, body: { expectedAuthzVersion: number }, effect: (transaction: PoolClient, access: WorkspaceAccess) => Promise<{ invitationId: string; deliveryId: string }>): Promise<DeliveryReceipt> {
    return identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const access = await lockWorkspaceAccess(transaction, principal.userId, workspaceId, true);
      if (!access.membership.scopes.includes('manage-members')) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      return identityOperation(transaction, { secret, actorId: principal.userId, workspaceId, key, kind, body }, async () => {
        assertAuthzVersion(access, body.expectedAuthzVersion);
        const result = await effect(transaction, access);
        return { ...result, workspaceId, authzVersion: await incrementAuthzVersion(transaction, workspaceId) };
      });
    });
  }
  async function deliver(principal: SessionPrincipal, receipt: DeliveryReceipt) {
    const claim = await identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const access = await lockWorkspaceAccess(transaction, principal.userId, receipt.workspaceId, true);
      const row = (await transaction.query<InvitationRow>(`SELECT ${invitationColumns} FROM identity_invitations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [receipt.invitationId, receipt.workspaceId])).rows[0];
      if (!row || !canGrant(access.membership, row)) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      if (row.delivery_id !== receipt.deliveryId || row.status !== 'pending' || !row.unexpired || row.delivery_state === 'sent' || (row.delivery_state === 'sending' && row.leased)) return { delivery: row.delivery_state };
      if (!await inviterCanGrant(transaction, row)) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      const epoch = row.send_epoch + 1;
      await transaction.query("UPDATE identity_invitations SET delivery_state='sending',send_epoch=$2,send_lease_until=now()+interval '1 minute',updated_at=now() WHERE id=$1", [row.id, epoch]);
      return { row, epoch, workspaceName: access.workspace.name };
    });
    if ('delivery' in claim) return { workspaceId: receipt.workspaceId, authzVersion: receipt.authzVersion, invitationId: receipt.invitationId, delivery: claim.delivery };
    let delivery: Delivery = 'sent';
    try {
      await mailer.send(claim.row.email, { kind: 'invite', locale: claim.row.locale, workspaceName: claim.workspaceName, url: new URL(`/settings/invitations/${tokenFor(claim.row.id, claim.row.token_nonce)}`, origin).href });
    } catch { delivery = 'uncertain'; }
    const updated = await pool.query<{ delivery_state: Delivery }>('UPDATE identity_invitations SET delivery_state=$4,send_lease_until=NULL,updated_at=now() WHERE id=$1 AND delivery_id=$2 AND send_epoch=$3 RETURNING delivery_state', [claim.row.id, receipt.deliveryId, claim.epoch, delivery]);
    return { workspaceId: receipt.workspaceId, authzVersion: receipt.authzVersion, invitationId: receipt.invitationId, delivery: updated.rows[0]?.delivery_state ?? 'uncertain' as Delivery };
  }
  async function create(principal: SessionPrincipal, workspaceId: string, key: string, body: z.infer<typeof CreateInvitationSchema>) {
    mailer.assertReady();
    const receipt = await mutation(principal, workspaceId, key, 'invitation:create', body, async (transaction, access) => {
      const scopes = requireGrant(access.membership, body.role, body.scopes);
      const existing = await transaction.query("SELECT m.id FROM identity_memberships m JOIN identity_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.email=$2 AND m.state='active'", [workspaceId, body.email]);
      if (existing.rowCount) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      await transaction.query("UPDATE identity_invitations SET status='revoked',updated_at=now() WHERE workspace_id=$1 AND email=$2 AND status='pending' AND expires_at<=now()", [workspaceId, body.email]);
      if ((await transaction.query("SELECT id FROM identity_invitations WHERE workspace_id=$1 AND email=$2 AND status='pending'", [workspaceId, body.email])).rowCount) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const id = randomUUID();
      const nonce = randomUUID();
      const deliveryId = randomUUID();
      await transaction.query('INSERT INTO identity_invitations(id,workspace_id,created_by,email,role,scopes,locale,token_hash,token_nonce,expires_at,delivery_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+$10*interval \'1 second\',$11)', [id, workspaceId, principal.userId, body.email, body.role, scopes, body.locale, digest(tokenFor(id, nonce)), nonce, INVITATION_TTL_SECONDS, deliveryId]);
      return { invitationId: id, deliveryId };
    });
    return deliver(principal, receipt);
  }
  async function resend(principal: SessionPrincipal, workspaceId: string, invitationId: string, key: string, body: z.infer<typeof InvitationMutationSchema>) {
    mailer.assertReady();
    const receipt = await mutation(principal, workspaceId, key, `invitation:resend:${invitationId}`, body, async (transaction, access) => {
      const row = (await transaction.query<InvitationRow>(`SELECT ${invitationColumns} FROM identity_invitations WHERE id=$1 AND workspace_id=$2 AND status='pending' FOR UPDATE`, [invitationId, workspaceId])).rows[0];
      if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      requireGrant(access.membership, row.role, row.scopes);
      if (row.delivery_state === 'sending' && row.leased) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const nonce = row.unexpired ? row.token_nonce : randomUUID();
      const deliveryId = randomUUID();
      await transaction.query("UPDATE identity_invitations SET created_by=$2,token_nonce=$3,token_hash=$4,expires_at=CASE WHEN expires_at<=now() THEN now()+$5*interval '1 second' ELSE expires_at END,delivery_id=$6,delivery_state='pending',send_lease_until=NULL,updated_at=now() WHERE id=$1", [row.id, principal.userId, nonce, digest(tokenFor(row.id, nonce)), INVITATION_TTL_SECONDS, deliveryId]);
      return { invitationId: row.id, deliveryId };
    });
    return deliver(principal, receipt);
  }
  async function revoke(principal: SessionPrincipal, workspaceId: string, invitationId: string, key: string, body: z.infer<typeof InvitationMutationSchema>) {
    const result = await mutation(principal, workspaceId, key, `invitation:revoke:${invitationId}`, body, async (transaction, access) => {
      const row = (await transaction.query<InvitationRow>(`SELECT ${invitationColumns} FROM identity_invitations WHERE id=$1 AND workspace_id=$2 AND status='pending' FOR UPDATE`, [invitationId, workspaceId])).rows[0];
      if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      requireGrant(access.membership, row.role, row.scopes);
      await transaction.query("UPDATE identity_invitations SET status='revoked',updated_at=now() WHERE id=$1", [row.id]);
      return { invitationId: row.id, deliveryId: row.delivery_id };
    });
    return { workspaceId: result.workspaceId, authzVersion: result.authzVersion };
  }
  async function inspect(transaction: PoolClient, principal: SessionPrincipal, token: string, exclusive: boolean) {
    const user = await lockIdentityActor(transaction, principal);
    const locator = (await transaction.query<{ workspace_id: string }>('SELECT workspace_id FROM identity_invitations WHERE token_hash=$1', [digest(token)])).rows[0];
    if (!locator) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    const workspace = (await transaction.query<WorkspaceRow>(`SELECT id,name,authz_version,created_at,status FROM identity_workspaces WHERE id=$1 AND status='active' FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [locator.workspace_id])).rows[0];
    const invitation = (await transaction.query<InvitationRow>(`SELECT ${invitationColumns} FROM identity_invitations WHERE token_hash=$1 FOR SHARE`, [digest(token)])).rows[0];
    if (!workspace || !invitation || invitation.email !== user.email) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    return { workspace, invitation };
  }
  async function preview(principal: SessionPrincipal, token: string): Promise<InvitationPreview> {
    return identityTransaction(pool, async (transaction) => {
      const { workspace, invitation } = await inspect(transaction, principal, token, false);
      if (invitation.status !== 'pending' || !invitation.unexpired || !await inviterCanGrant(transaction, invitation)) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      return { status: 'pending', workspaceName: workspace.name, role: invitation.role, scopes: invitation.scopes, expiresAt: invitation.expires_at.toISOString() };
    });
  }
  async function accept(principal: SessionPrincipal, token: string, key: string) {
    return identityTransaction(pool, async (transaction) => {
      const { workspace, invitation } = await inspect(transaction, principal, token, true);
      const acceptedBefore = invitation.status === 'accepted' && invitation.accepted_by === principal.userId;
      if (acceptedBefore) await lockWorkspaceAccess(transaction, principal.userId, workspace.id);
      else if (invitation.status !== 'pending' || !invitation.unexpired || !await inviterCanGrant(transaction, invitation)) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      await identityOperation(transaction, { secret, actorId: principal.userId, workspaceId: workspace.id, key, kind: `invitation:accept:${invitation.id}`, body: {} }, async () => {
        if (acceptedBefore) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
        const current = (await transaction.query<MembershipRow>('SELECT * FROM identity_memberships WHERE workspace_id=$1 AND user_id=$2', [workspace.id, principal.userId])).rows[0];
        if (current?.state === 'active') throw new IdentityError('CONFLICT', 'identity.errors.conflict');
        await transaction.query("INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,scopes=EXCLUDED.scopes,state='active',revoked_at=NULL,created_at=now(),updated_at=now()", [randomUUID(), workspace.id, principal.userId, invitation.role, invitation.scopes]);
        await transaction.query("UPDATE identity_invitations SET status='accepted',accepted_by=$2,accepted_at=now(),updated_at=now() WHERE id=$1", [invitation.id, principal.userId]);
        await incrementAuthzVersion(transaction, workspace.id);
        return { workspaceId: workspace.id };
      });
      return { workspace: membershipDto(await lockWorkspaceAccess(transaction, principal.userId, workspace.id)) };
    });
  }
  return { create, resend, revoke, preview, accept };
}
