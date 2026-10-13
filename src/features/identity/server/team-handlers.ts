import { z } from 'zod';
import { AcceptInvitationSchema, CreateInvitationSchema, CreateWorkspaceSchema, DeleteAccountSchema, InvitationMutationSchema, InvitationTokenSchema, RevokeMemberSchema, TransferOwnershipSchema, UpdateMemberSchema } from '../contracts';
import type { SessionPrincipal } from './access';
import type { IdentityOptions } from './auth';
import { createDeletionService } from './deletion';
import { json, limit, readJson, validate } from './http';
import { createInvitationService } from './invitations';
import { idempotencyKey } from './operations';
import { createWorkspaceService } from './workspaces';

export function createTeamHandlers(options: IdentityOptions) {
  const workspaces = createWorkspaceService(options.pool, options.secret);
  const invitations = createInvitationService(options);
  const deletion = createDeletionService(options.pool, options.secret);
  async function handle(request: Request, path: string, principal: SessionPrincipal): Promise<Response | undefined> {
    const method = request.method;
    if (path === '/workspaces' && method === 'GET') return json(await workspaces.list(principal));
    if (path === '/workspaces' && method === 'POST') {
      await limit(options.pool, `identity:workspace:create:${principal.userId}`, 20, 3600);
      return json(await workspaces.create(principal, idempotencyKey(request), validate(CreateWorkspaceSchema, await readJson(request))), 201);
    }
    const team = path.match(/^\/workspaces\/([^/]+)\/team$/);
    if (team && method === 'GET') return json(await workspaces.team(principal, validate(z.uuid(), team[1])));
    const member = path.match(/^\/workspaces\/([^/]+)\/members\/([^/]+)$/);
    if (member && ['PATCH', 'DELETE'].includes(method)) {
      const workspaceId = validate(z.uuid(), member[1]);
      const targetUserId = validate(z.uuid(), member[2]);
      const key = idempotencyKey(request);
      const input = await readJson(request);
      await limit(options.pool, `identity:team:${principal.userId}`, 120, 60);
      return json(method === 'PATCH'
        ? await workspaces.updateMember(principal, workspaceId, targetUserId, key, validate(UpdateMemberSchema, input))
        : await workspaces.revokeMember(principal, workspaceId, targetUserId, key, validate(RevokeMemberSchema, input)));
    }
    const transfer = path.match(/^\/workspaces\/([^/]+)\/transfer$/);
    if (transfer && method === 'POST') return json(await workspaces.transfer(principal, validate(z.uuid(), transfer[1]), idempotencyKey(request), validate(TransferOwnershipSchema, await readJson(request))));
    const invite = path.match(/^\/workspaces\/([^/]+)\/invitations$/);
    if (invite && method === 'POST') {
      const workspaceId = validate(z.uuid(), invite[1]);
      await limit(options.pool, `identity:invite:${principal.userId}:${workspaceId}`, 20, 3600);
      return json(await invitations.create(principal, workspaceId, idempotencyKey(request), validate(CreateInvitationSchema, await readJson(request))), 201);
    }
    const existingInvite = path.match(/^\/workspaces\/([^/]+)\/invitations\/([^/]+)(\/resend)?$/);
    if (existingInvite && ((method === 'POST' && existingInvite[3]) || (method === 'DELETE' && !existingInvite[3]))) {
      const workspaceId = validate(z.uuid(), existingInvite[1]);
      const invitationId = validate(z.uuid(), existingInvite[2]);
      const key = idempotencyKey(request);
      const body = validate(InvitationMutationSchema, await readJson(request));
      await limit(options.pool, `identity:invite:${principal.userId}:${workspaceId}`, 20, 3600);
      return json(method === 'POST' ? await invitations.resend(principal, workspaceId, invitationId, key, body) : await invitations.revoke(principal, workspaceId, invitationId, key, body));
    }
    const receivedInvite = path.match(/^\/invitations\/([a-f0-9]{64})(\/accept)?$/);
    if (receivedInvite && method === 'GET' && !receivedInvite[2]) return json(await invitations.preview(principal, validate(InvitationTokenSchema, receivedInvite[1])));
    if (receivedInvite && method === 'POST' && receivedInvite[2]) {
      validate(AcceptInvitationSchema, await readJson(request));
      return json(await invitations.accept(principal, validate(InvitationTokenSchema, receivedInvite[1]), idempotencyKey(request)));
    }
    if (path === '/account/deletion' && method === 'GET') return json(await deletion.preview(principal));
    if (path === '/account/deletion' && method === 'POST') {
      await limit(options.pool, `identity:delete:${principal.userId}`, 5, 900);
      return json(await deletion.remove(principal, idempotencyKey(request), validate(DeleteAccountSchema, await readJson(request))));
    }
    return undefined;
  }
  return { handle, listWorkspaces: workspaces.list };
}
