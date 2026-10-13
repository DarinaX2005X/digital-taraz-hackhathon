import { describe, expect, it } from "vitest";
import { ErrorEnvelopeSchema } from "../../src/contracts/errors.ts";
import { inspectOwnedServices, runCompose, startCompose } from "../../scripts/dev/compose.mjs";
import { waitForAppHealth } from "../../scripts/dev/app-process.mjs";

function context() {
  const namespace = process.env.TIRLIK_TEST_NAMESPACE;
  const project = process.env.TIRLIK_TEST_COMPOSE_PROJECT;
  const port = Number(process.env.TIRLIK_TEST_APP_PORT);
  if (!/^[a-f0-9]{32}$/.test(namespace ?? "") || !new RegExp(`^tirlik-test-[a-f0-9]{12}-${namespace}$`).test(project ?? "") || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("ISOLATED_HTTP_TEST_CONTEXT_REQUIRED");
  }
  return { project, port, options: { cwd: process.cwd(), env: process.env } };
}

describe("real HTTP and PostgreSQL availability", () => {
  it("reports database readiness without caching the health response", async () => {
    const { port } = context();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10_000) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", service: "tirlik", database: "ready" });
  });

  it("returns a typed 503 during a real database outage and recovers afterward", async () => {
    const { project, port, options } = context();
    await inspectOwnedServices(process.cwd(), project, options);
    try {
      await runCompose(process.cwd(), project, ["stop", "--timeout", "5", "postgres"], { ...options, label: "Isolated database outage", timeoutMs: 30_000 });
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10_000) });
      expect(response.status).toBe(503);
      const envelope = ErrorEnvelopeSchema.parse(await response.json());
      expect(envelope).toMatchObject({ code: "UNAVAILABLE", messageKey: "errors.unavailable", retryable: true, recovery: "retry" });
      expect(Object.keys(envelope)).not.toContain("stack");
    } finally {
      await startCompose(process.cwd(), project, options);
    }
    await expect(waitForAppHealth(port, { timeoutMs: 15_000 })).resolves.toMatchObject({ database: "ready" });
  }, 60_000);
});
