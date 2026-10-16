import 'server-only';
export { getIdentityHandlers } from '@/server/identity-runtime';
export { getLocalMailInbox } from '@/server/local-mail';
export { createIdentityHandlers } from './handlers';
export { createIdentityMailer } from './mail';
export type { IdentityActor } from './handlers';
export { withWorkspaceAccess, lockProjectAccess } from './access';
export type { IdentityPrincipal, SessionPrincipal, JobPrincipal, WorkspaceAccess, AccessRequest } from './access';
