import { describe, expect, it } from "vitest";
import { createIdentityWriteIntent } from "@/features/identity/ui/write-intent";

const makeIntent = () => {
  let sequence = 0;
  return createIdentityWriteIntent(() => `request-${++sequence}`);
};

describe("identity mutation retry identity", () => {
  it("reuses the same request key after an uncertain response, but not after edited input", async () => {
    const intent = makeIntent();
    const payload = { userId: "one", workspaceId: "space", body: { name: "Team" } };
    expect(await intent.keyFor(payload)).toBe("request-1");
    expect(await intent.keyFor(structuredClone(payload))).toBe("request-1");
    expect(await intent.keyFor({ ...payload, body: { name: "Changed" } })).toBe("request-2");
  });

  it("distinguishes account, target, security revision and password changes", async () => {
    const intent = makeIntent();
    const input = { userId: "one", workspaceId: "first", expectedAuthzVersion: 1, password: "test-password-a" };
    const initial = await intent.keyFor(input);
    expect(await intent.keyFor({ ...input, userId: "two" })).not.toBe(initial);
    expect(await intent.keyFor({ ...input, workspaceId: "second" })).not.toBe(initial);
    expect(await intent.keyFor({ ...input, expectedAuthzVersion: 2 })).not.toBe(initial);
    expect(await intent.keyFor({ ...input, password: "test-password-b" })).not.toBe(initial);
  });

  it("clears an acknowledged operation so a later explicit action is not mistaken for its retry", async () => {
    const intent = makeIntent();
    expect(await intent.keyFor({ operation: "resend" })).toBe("request-1");
    intent.clear();
    expect(await intent.keyFor({ operation: "resend" })).toBe("request-2");
  });

  it("does not dispatch when cancellation arrives while preparing a request", async () => {
    const intent = makeIntent();
    const controller = new AbortController();
    const pending = intent.keyFor({ password: "test-only" }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const cleared = intent.keyFor({ name: "Test" });
    intent.clear();
    await expect(cleared).rejects.toMatchObject({ name: "AbortError" });
  });
});
