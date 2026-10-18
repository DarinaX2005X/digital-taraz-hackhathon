import { z } from "zod";
import { ErrorEnvelopeSchema } from "@/contracts/errors";
import {
  ChangePasswordSchema, IdentityViewerSchema, IntentRestoredSchema, IntentSavedSchema,
  ProfileResultSchema, ProfileUpdateSchema, RequestMailSchema, ResetPasswordSchema,
  RestoreIntentSchema, RevokeSessionResultSchema, SaveIntentSchema, SessionsResultSchema,
  SignInSchema, SignUpSchema,
  AcceptInvitationSchema, AccountDeletionPreviewSchema, AccountDeletionResultSchema,
  CreateInvitationSchema, CreateWorkspaceSchema, DeleteAccountSchema, InvitationMutationSchema,
  InvitationMutationResultSchema, InvitationPreviewSchema, InvitationTokenSchema,
  RevokeMemberSchema, TeamMutationResultSchema, TeamResultSchema, TransferOwnershipSchema,
  UpdateMemberSchema, WorkspaceResultSchema, WorkspacesResultSchema,
} from "../contracts";
import { ru } from "../locales/ru";
import type { IdentityMessageKey } from "../locales";

export type IdentityFailure = {
  messageKey: IdentityMessageKey;
  fieldErrors: Readonly<Record<string, IdentityMessageKey>>;
  status: number;
  retryAfterSeconds?: number;
};

export class IdentityTransportError extends Error {
  constructor(readonly failure: IdentityFailure) {
    super(failure.messageKey);
    this.name = "IdentityTransportError";
  }
}

const errorKeys = new Set(Object.keys(ru.identity.errors).filter((key) => key !== "retryAfter").map((key) => `identity.errors.${key}`));
function safeErrorKey(key: string): IdentityMessageKey {
  return errorKeys.has(key) ? key as IdentityMessageKey : "identity.errors.unexpected";
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : undefined;
}

function failure(messageKey: IdentityMessageKey, status = 0): IdentityTransportError {
  return new IdentityTransportError({ messageKey, status, fieldErrors: {} });
}

export function asIdentityFailure(error: unknown): IdentityFailure {
  return error instanceof IdentityTransportError ? error.failure : failure("identity.errors.unexpected").failure;
}

export type RequestOptions = { signal?: AbortSignal; expectedUserId?: string };
type ClientOptions = { fetch?: typeof fetch; timeoutMs?: number };
const statusResult = <T extends string>(status: T) => z.strictObject({ status: z.literal(status), returnTo: z.string().optional() });

export function createIdentityClient(options: ClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("Expected a positive identity request timeout");

  async function request<T>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", schema: z.ZodType<T>, body?: unknown, opts: RequestOptions & { idempotencyKey?: string } = {}): Promise<T> {
    if (!/^\/api\/(?:auth|identity)\/[a-z0-9/-]+$/.test(path)) throw failure("identity.errors.unexpected");
    if (opts.expectedUserId && !z.uuid().safeParse(opts.expectedUserId).success) throw failure("identity.errors.validationFailed");
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    opts.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetcher(path, {
        method, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}), ...(opts.expectedUserId ? { "X-Tirlik-User-Id": opts.expectedUserId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!response.ok) {
        const envelope = ErrorEnvelopeSchema.safeParse(data);
        if (!envelope.success) throw failure(response.status === 401 ? "identity.errors.unauthenticated" : "identity.errors.unexpected", response.status);
        const fields: Record<string, IdentityMessageKey> = {};
        for (const [name, messages] of Object.entries(envelope.data.fieldErrors ?? {})) {
          if (messages[0]) fields[name] = safeErrorKey(messages[0]);
        }
        throw new IdentityTransportError({ messageKey: safeErrorKey(envelope.data.messageKey), fieldErrors: fields, status: response.status, retryAfterSeconds: retryAfterSeconds(response.headers.get("Retry-After")) });
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw failure("identity.errors.unexpected", response.status);
      return parsed.data;
    } catch (error) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (timedOut) throw failure("identity.errors.timeout");
      if (error instanceof IdentityTransportError) throw error;
      throw failure("identity.errors.network");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
    }
  }

  function validate<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw failure("identity.errors.validationFailed");
    return result.data;
  }

  return {
    signIn: (input: z.input<typeof SignInSchema>, opts?: RequestOptions) => request("/api/auth/sign-in/email", "POST", statusResult("signed-in"), validate(SignInSchema, input), opts),
    signUp: (input: z.input<typeof SignUpSchema>, opts?: RequestOptions) => request("/api/auth/sign-up/email", "POST", statusResult("account-checked"), validate(SignUpSchema, input), opts),
    requestPasswordReset: (input: z.input<typeof RequestMailSchema>, opts?: RequestOptions) => request("/api/auth/request-password-reset", "POST", statusResult("accepted"), validate(RequestMailSchema, input), opts),
    resetPassword: (input: z.input<typeof ResetPasswordSchema>, opts?: RequestOptions) => request("/api/auth/reset-password", "POST", statusResult("password-reset"), validate(ResetPasswordSchema, input), opts),
    changePassword: (input: z.input<typeof ChangePasswordSchema>, opts?: RequestOptions) => request("/api/auth/change-password", "POST", statusResult("password-changed"), validate(ChangePasswordSchema, input), opts),
    signOut: (opts?: RequestOptions) => request("/api/auth/sign-out", "POST", statusResult("signed-out"), {}, opts),
    me: (opts?: RequestOptions) => request("/api/identity/me", "GET", IdentityViewerSchema, undefined, opts),
    updateProfile: (input: z.input<typeof ProfileUpdateSchema>, opts?: RequestOptions) => request("/api/identity/profile", "PATCH", ProfileResultSchema, validate(ProfileUpdateSchema, input), opts),
    sessions: (opts?: RequestOptions) => request("/api/identity/sessions", "GET", SessionsResultSchema, undefined, opts),
    revokeSession: (id: string, opts?: RequestOptions) => request(`/api/identity/sessions/${validate(z.uuid(), id)}`, "DELETE", RevokeSessionResultSchema, {}, opts),
    saveIntent: (input: z.input<typeof SaveIntentSchema>, idempotencyKey: string, opts?: RequestOptions) => request("/api/identity/intents", "POST", IntentSavedSchema, validate(SaveIntentSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), idempotencyKey) }),
    restoreIntent: (input: z.input<typeof RestoreIntentSchema>, opts?: RequestOptions) => request("/api/identity/intents/restore", "POST", IntentRestoredSchema, validate(RestoreIntentSchema, input), opts),
    workspaces: (opts?: RequestOptions) => request("/api/identity/workspaces", "GET", WorkspacesResultSchema, undefined, opts),
    createWorkspace: (input: z.input<typeof CreateWorkspaceSchema>, key: string, opts?: RequestOptions) => request("/api/identity/workspaces", "POST", WorkspaceResultSchema, validate(CreateWorkspaceSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    team: (workspaceId: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/team`, "GET", TeamResultSchema, undefined, opts),
    updateMember: (workspaceId: string, userId: string, input: z.input<typeof UpdateMemberSchema>, key: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/members/${validate(z.uuid(), userId)}`, "PATCH", TeamMutationResultSchema, validate(UpdateMemberSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    revokeMember: (workspaceId: string, userId: string, input: z.input<typeof RevokeMemberSchema>, key: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/members/${validate(z.uuid(), userId)}`, "DELETE", TeamMutationResultSchema, validate(RevokeMemberSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    transferOwnership: (workspaceId: string, input: z.input<typeof TransferOwnershipSchema>, key: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/transfer`, "POST", TeamMutationResultSchema, validate(TransferOwnershipSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    createInvitation: (workspaceId: string, input: z.input<typeof CreateInvitationSchema>, key: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/invitations`, "POST", InvitationMutationResultSchema, validate(CreateInvitationSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    resendInvitation: (workspaceId: string, invitationId: string, input: z.input<typeof InvitationMutationSchema>, key: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/invitations/${validate(z.uuid(), invitationId)}/resend`, "POST", InvitationMutationResultSchema, validate(InvitationMutationSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    revokeInvitation: (workspaceId: string, invitationId: string, input: z.input<typeof InvitationMutationSchema>, key: string, opts?: RequestOptions) => request(`/api/identity/workspaces/${validate(z.uuid(), workspaceId)}/invitations/${validate(z.uuid(), invitationId)}`, "DELETE", TeamMutationResultSchema, validate(InvitationMutationSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    invitation: (token: string, opts?: RequestOptions) => request(`/api/identity/invitations/${validate(InvitationTokenSchema, token)}`, "GET", InvitationPreviewSchema, undefined, opts),
    acceptInvitation: (token: string, key: string, opts?: RequestOptions) => request(`/api/identity/invitations/${validate(InvitationTokenSchema, token)}/accept`, "POST", WorkspaceResultSchema, validate(AcceptInvitationSchema, {}), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
    deletionPreview: (opts?: RequestOptions) => request("/api/identity/account/deletion", "GET", AccountDeletionPreviewSchema, undefined, opts),
    deleteAccount: (input: z.input<typeof DeleteAccountSchema>, key: string, opts?: RequestOptions) => request("/api/identity/account/deletion", "POST", AccountDeletionResultSchema, validate(DeleteAccountSchema, input), { ...opts, idempotencyKey: validate(z.uuid(), key) }),
  };
}

export const identityClient = createIdentityClient();
export type IdentityClient = ReturnType<typeof createIdentityClient>;
