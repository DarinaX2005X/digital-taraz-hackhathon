import { describe, expect, it, vi } from "vitest";
import { createIdentityClient, IdentityTransportError, type IdentityClient } from "@/features/identity/ui/transport";
import type { WorkspaceMembership } from "@/features/identity/contracts";

const actor = "a794d439-c64b-4864-a97b-b8a3c8427b45";
const workspaceId = "e6f21c0e-33a6-4f98-bf99-a7fc2c47e9ab";
const memberId = "489123c2-f7c3-44c1-a2c6-4807cd980638";
const invitationId = "07c8976c-f67c-4c90-b58b-102c3a938cfc";
const key = "36967b95-e187-40f2-9e50-5c45712b245d";
const token = "e".repeat(64);
const opts = { expectedUserId: actor };
const workspace: WorkspaceMembership = { workspaceId, name: "Test space", role: "owner", scopes: ["read", "edit", "approve", "export", "manage-members", "read-confidential"], authzVersion: 8 };
const mutation = { workspaceId, authzVersion: 9 };
const invitation = { ...mutation, invitationId, delivery: "uncertain" };
const grant = { role: "reviewer" as const, scopes: ["read", "approve"] as const, expectedAuthzVersion: 8 };
const body = { role: grant.role, scopes: [...grant.scopes], expectedAuthzVersion: 8 };
const version = { expectedAuthzVersion: 8 };
const deletion = { password: "test-only-current-password", confirmation: "DELETE_ACCOUNT" as const, workspaces: [{ workspaceId, expectedAuthzVersion: 8, action: "transfer" as const, targetUserId: memberId }] };
const deleted = { status: "deletion-requested", requestId: key, requestedAt: "2026-10-14T01:00:00.000Z", cleanupAfter: "2026-11-13T01:00:00.000Z" };

type Case = { name: string; invoke: (client: IdentityClient, requestKey: string) => Promise<unknown>; method: string; path: string; input: unknown; output: unknown };
const cases: Case[] = [
  { name: "create workspace", invoke: (client, id) => client.createWorkspace({ name: " Test space " }, id, opts), method: "POST", path: "/workspaces", input: { name: "Test space" }, output: { workspace } },
  { name: "update member", invoke: (client, id) => client.updateMember(workspaceId, memberId, body, id, opts), method: "PATCH", path: `/workspaces/${workspaceId}/members/${memberId}`, input: body, output: mutation },
  { name: "revoke member", invoke: (client, id) => client.revokeMember(workspaceId, memberId, version, id, opts), method: "DELETE", path: `/workspaces/${workspaceId}/members/${memberId}`, input: version, output: mutation },
  { name: "transfer ownership", invoke: (client, id) => client.transferOwnership(workspaceId, { ...version, targetUserId: memberId }, id, opts), method: "POST", path: `/workspaces/${workspaceId}/transfer`, input: { ...version, targetUserId: memberId }, output: mutation },
  { name: "create invitation", invoke: (client, id) => client.createInvitation(workspaceId, { ...body, email: "MEMBER@example.test", locale: "kk" }, id, opts), method: "POST", path: `/workspaces/${workspaceId}/invitations`, input: { ...body, email: "member@example.test", locale: "kk" }, output: invitation },
  { name: "resend invitation", invoke: (client, id) => client.resendInvitation(workspaceId, invitationId, version, id, opts), method: "POST", path: `/workspaces/${workspaceId}/invitations/${invitationId}/resend`, input: version, output: invitation },
  { name: "revoke invitation", invoke: (client, id) => client.revokeInvitation(workspaceId, invitationId, version, id, opts), method: "DELETE", path: `/workspaces/${workspaceId}/invitations/${invitationId}`, input: version, output: mutation },
  { name: "accept invitation", invoke: (client, id) => client.acceptInvitation(token, id, opts), method: "POST", path: `/invitations/${token}/accept`, input: {}, output: { workspace } },
  { name: "delete account", invoke: (client, id) => client.deleteAccount(deletion, id, opts), method: "POST", path: "/account/deletion", input: deletion, output: deleted },
];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("team, invitations and deletion HTTP contracts", () => {
  it.each(cases)("validates and guards $name as one explicit write", async (entry) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(entry.output));
    const client = createIdentityClient({ fetch: fetcher });
    await expect(entry.invoke(client, key)).resolves.toEqual(entry.output);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`/api/identity${entry.path}`);
    expect(init).toMatchObject({ method: entry.method, credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error", headers: { "Idempotency-Key": key, "X-Tirlik-User-Id": actor } });
    expect(JSON.parse(String(init?.body))).toEqual(entry.input);
  });
  it.each(cases)("requires a valid idempotency key for $name", (entry) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => entry.invoke(createIdentityClient({ fetch: fetcher }), "not-a-key")).toThrow(IdentityTransportError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("only reads an invitation preview until accept is explicitly requested", async () => {
    const output = { status: "pending", workspaceName: "Test space", role: "reviewer", scopes: ["read", "approve"], expiresAt: "2026-10-21T01:00:00.000Z" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(output));
    const client = createIdentityClient({ fetch: fetcher });
    await expect(client.invitation(token, opts)).resolves.toEqual(output);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/identity/invitations/${token}`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", headers: { "X-Tirlik-User-Id": actor } });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it("rejects extra private recipient data in a preview instead of displaying it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ status: "pending", workspaceName: "Secret", role: "reviewer", scopes: ["read"], expiresAt: "2026-10-21T01:00:00.000Z", email: "other@example.test" }));
    await expect(createIdentityClient({ fetch: fetcher }).invitation(token, opts)).rejects.toMatchObject({ failure: { messageKey: "identity.errors.unexpected" } });
  });
  it("does not dispatch malformed target IDs, tokens, revisions or deletion confirmation", () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createIdentityClient({ fetch: fetcher });
    expect(() => client.team("../secret", opts)).toThrow(IdentityTransportError);
    expect(() => client.invitation("?email=secret@example.test", opts)).toThrow(IdentityTransportError);
    expect(() => client.acceptInvitation("" , key, opts)).toThrow(IdentityTransportError);
    expect(() => client.revokeMember(workspaceId, memberId, { expectedAuthzVersion: 0 }, key, opts)).toThrow(IdentityTransportError);
    expect(() => client.deleteAccount({ ...deletion, confirmation: "DELETE" as "DELETE_ACCOUNT" }, key, opts)).toThrow(IdentityTransportError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not retry a stale-security-revision conflict or expose raw server text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ code: "CONFLICT", messageKey: "identity.errors.conflict", retryable: false, requestId: key, currentRevision: 9 }, 409));
    await expect(createIdentityClient({ fetch: fetcher }).revokeMember(workspaceId, memberId, version, key, opts)).rejects.toMatchObject({ failure: { status: 409, messageKey: "identity.errors.conflict" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires the full deletion acknowledgment, not a bare status string", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ status: "deletion-requested" }));
    await expect(createIdentityClient({ fetch: fetcher }).deleteAccount(deletion, key, opts)).rejects.toMatchObject({ failure: { messageKey: "identity.errors.unexpected" } });
  });
  it("uses protected GETs for workspaces and deletion consequences", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ workspaces: [workspace] })).mockResolvedValueOnce(response({ ownedWorkspaces: [], otherWorkspaceCount: 1, retentionDays: 30 }));
    const client = createIdentityClient({ fetch: fetcher });
    await expect(client.workspaces(opts)).resolves.toEqual({ workspaces: [workspace] });
    await expect(client.deletionPreview(opts)).resolves.toEqual({ ownedWorkspaces: [], otherWorkspaceCount: 1, retentionDays: 30 });
    for (const [, init] of fetcher.mock.calls) { expect(init?.method).toBe("GET"); expect(init?.headers).toMatchObject({ "X-Tirlik-User-Id": actor }); }
  });
});
