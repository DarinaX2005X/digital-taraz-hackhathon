import { describe, expect, it, vi } from "vitest";
import { createIdentityOperation } from "@/features/identity/ui/operation";
import { IdentityTransportError } from "@/features/identity/ui/transport";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("identity operation state", () => {
  it("locks synchronously so duplicate submissions cannot pass between React renders", async () => {
    const first = deferred<string>();
    const action = vi.fn(() => first.promise);
    const operation = createIdentityOperation<string>();
    const pending = operation.run(action);
    expect(operation.getSnapshot()).toEqual({ pending: true });
    await expect(operation.run(action)).resolves.toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);
    first.resolve("saved");
    await expect(pending).resolves.toBe("saved");
    expect(operation.getSnapshot()).toEqual({ pending: false, result: "saved" });
  });

  it("invalidates an old response after close and a fresh request", async () => {
    const first = deferred<string>();
    const operation = createIdentityOperation<string>();
    let oldSignal!: AbortSignal;
    const old = operation.run((signal) => { oldSignal = signal; return first.promise; });
    operation.cancel();
    expect(oldSignal.aborted).toBe(true);
    await operation.run(async () => "new-account");
    first.resolve("old-account");
    await expect(old).resolves.toBeUndefined();
    expect(operation.getSnapshot()).toEqual({ pending: false, result: "new-account" });
  });

  it("does not display a cancelled rejection as a user error", async () => {
    const first = deferred<string>();
    const operation = createIdentityOperation<string>();
    const old = operation.run(() => first.promise);
    operation.cancel();
    first.reject(new Error("private-network-message"));
    await old;
    expect(operation.getSnapshot()).toEqual({ pending: false });
  });

  it("retains only safe typed failure data", async () => {
    const operation = createIdentityOperation<string>();
    const error = new IdentityTransportError({ messageKey: "identity.errors.invalidCredentials", status: 422, fieldErrors: {} });
    await operation.run(async () => { throw error; });
    expect(operation.getSnapshot()).toEqual({ pending: false, failure: error.failure });
    operation.clear();
    expect(operation.getSnapshot()).toEqual({ pending: false });
    await operation.run(async () => { throw new Error("private-value"); });
    expect(operation.getSnapshot().failure?.messageKey).toBe("identity.errors.unexpected");
  });

  it("does not unlock a pending write when clearing field feedback", async () => {
    const result = deferred<string>();
    const operation = createIdentityOperation<string>();
    const pending = operation.run(() => result.promise);
    operation.clear();
    expect(operation.getSnapshot().pending).toBe(true);
    result.resolve("ok");
    await pending;
  });

  it("publishes state changes and releases subscribers", async () => {
    const operation = createIdentityOperation<string>();
    const listener = vi.fn();
    const unsubscribe = operation.subscribe(listener);
    await operation.run(async () => "ok");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    operation.clear();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
