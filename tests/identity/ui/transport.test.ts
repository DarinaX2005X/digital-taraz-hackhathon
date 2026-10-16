import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityClient, IdentityTransportError, retryAfterSeconds } from "@/features/identity/ui/transport";

const userId = "e05249af-70de-4c74-948d-9e01c88a06c3";
const requestId = "96933c28-cf03-4f2f-a059-b107c757f193";
const secret = "test-only-password-never-in-url";
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const envelope = (messageKey: string, extras = {}) => ({ code: "VALIDATION_FAILED", messageKey, retryable: false, requestId, ...extras });
const setup = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body, status, headers));
  return { client: createIdentityClient({ fetch: fetcher }), fetcher };
};

afterEach(() => vi.useRealTimers());

describe("identity HTTP client", () => {
  it("sends credentials only in a same-origin POST body and validates the response", async () => {
    const { client, fetcher } = setup({ status: "signed-in", returnTo: "/settings" });
    await expect(client.signIn({ email: "USER@example.test", password: secret })).resolves.toEqual({ status: "signed-in", returnTo: "/settings" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/auth/sign-in/email");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    expect(JSON.parse(String(init?.body))).toEqual({ email: "user@example.test", password: secret });
    expect(init?.headers).toMatchObject({ Accept: "application/json", "Content-Type": "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves opaque destination state, without attaching the original goal to auth requests", async () => {
    const { client, fetcher } = setup({ status: "signed-in", returnTo: "/app" });
    const intentToken = "a".repeat(64);
    await client.signUp({ name: " Person ", email: "person@example.test", password: secret, locale: "kk", returnTo: "/app", intentToken });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ name: "Person", email: "person@example.test", password: secret, locale: "kk", returnTo: "/app", intentToken });
  });

  it("requires an explicit idempotency key for intent creation", async () => {
    const { client, fetcher } = setup({ intentToken: "b".repeat(64), expiresAt: "2026-10-13T12:00:00.000Z" });
    await client.saveIntent({ goal: "Сравнить план", returnTo: "/app" }, requestId);
    expect(fetcher.mock.calls[0]![0]).toBe("/api/identity/intents");
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ "Idempotency-Key": requestId });
    expect(() => client.saveIntent({ goal: "x" }, "bad")).toThrow(IdentityTransportError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends the expected account guard on authenticated reads and writes", async () => {
    const { client, fetcher } = setup({ sessions: [] });
    await client.sessions({ expectedUserId: userId });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "GET", headers: { "X-Tirlik-User-Id": userId } });
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
    await expect(client.sessions({ expectedUserId: "wrong" })).rejects.toMatchObject({ failure: { messageKey: "identity.errors.validationFailed" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not send invalid input or use arbitrary session paths", () => {
    const { client, fetcher } = setup({ status: "signed-in" });
    expect(() => client.signIn({ email: "wrong", password: secret })).toThrow(IdentityTransportError);
    expect(() => client.signUp({ name: "x", email: "ok@example.test", password: "short" })).toThrow(IdentityTransportError);
    expect(() => client.revokeSession("../me")).toThrow(IdentityTransportError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a valid but wrong operation result", async () => {
    const { client } = setup({ status: "accepted" });
    await expect(client.signUp({ name: "Person", email: "p@example.test", password: secret })).rejects.toMatchObject({ failure: { messageKey: "identity.errors.unexpected" } });
  });

  it("rejects uncontracted data instead of exposing secret fields to UI", async () => {
    const { client } = setup({ status: "signed-in", sessionToken: "must-not-leave-transport" });
    await expect(client.signIn({ email: "p@example.test", password: secret })).rejects.toMatchObject({ failure: { messageKey: "identity.errors.unexpected" } });
  });

  it("only accepts known local message keys from a typed server error", async () => {
    const { client } = setup(envelope("identity.errors.invalidCredentials", { fieldErrors: { email: ["identity.errors.validationFailed"], password: ["<script>leak</script>"] } }), 422);
    await expect(client.signIn({ email: "p@example.test", password: secret })).rejects.toMatchObject({ failure: { status: 422, messageKey: "identity.errors.invalidCredentials", fieldErrors: { email: "identity.errors.validationFailed", password: "identity.errors.unexpected" } } });
  });

  it.each(["other.module.key", "identity.errors.retryAfter"])("does not trust an unrenderable error key %s", async (key) => {
    const { client } = setup(envelope(key), 422);
    await expect(client.signIn({ email: "p@example.test", password: secret })).rejects.toMatchObject({ failure: { messageKey: "identity.errors.unexpected" } });
  });

  it("retains a bounded Retry-After hint but never retries a mutation", async () => {
    const { client, fetcher } = setup(envelope("identity.errors.rateLimited", { code: "RATE_LIMITED", retryable: true }), 429, { "Retry-After": "30" });
    await expect(client.signIn({ email: "p@example.test", password: secret })).rejects.toMatchObject({ failure: { retryAfterSeconds: 30 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not surface raw HTML, network errors or malformed envelopes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("<html>internal-secret</html>", { status: 500 })).mockRejectedValueOnce(new Error("password=internal-secret"));
    const client = createIdentityClient({ fetch: fetcher });
    await expect(client.signOut()).rejects.toMatchObject({ message: "identity.errors.unexpected" });
    await expect(client.signOut()).rejects.toMatchObject({ message: "identity.errors.network" });
  });

  it("preserves 401 semantics even for a proxy-generated non-JSON response", async () => {
    const { client } = setup(null, 401);
    await expect(client.me()).rejects.toMatchObject({ failure: { status: 401, messageKey: "identity.errors.unauthenticated" } });
  });

  it("does not dispatch an already-cancelled request", async () => {
    const { client, fetcher } = setup({ status: "signed-out" });
    const controller = new AbortController();
    controller.abort();
    await expect(client.signOut({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts timed-out requests and reports an uncertain outcome, without resubmission", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    const client = createIdentityClient({ fetch: fetcher, timeoutMs: 50 });
    const assertion = expect(client.signOut()).rejects.toMatchObject({ failure: { messageKey: "identity.errors.timeout" } });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it("ignores a response received after cancellation even if a fetch adapter ignores abort", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const client = createIdentityClient({ fetch: fetcher });
    const controller = new AbortController();
    const assertion = expect(client.signOut({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    resolve(response({ status: "signed-out" }));
    await assertion;
  });
});

describe("Retry-After parsing", () => {
  it("handles seconds and dates while rejecting invalid or elapsed hints", () => {
    const now = Date.parse("2026-10-13T10:00:00.000Z");
    expect(retryAfterSeconds("90", now)).toBe(90);
    expect(retryAfterSeconds("Tue, 13 Oct 2026 10:00:30 GMT", now)).toBe(30);
    expect(retryAfterSeconds("99999999", now)).toBe(3600);
    expect(retryAfterSeconds("0", now)).toBeUndefined();
    expect(retryAfterSeconds("bad", now)).toBeUndefined();
    expect(retryAfterSeconds(null, now)).toBeUndefined();
  });
});
