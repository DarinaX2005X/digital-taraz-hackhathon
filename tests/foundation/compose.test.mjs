import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupTestCompose, runCompose, waitForMailpit } from "../../scripts/dev/compose.mjs";

describe("dependency readiness and ownership", () => {
  it("accepts Mailpit's documented empty-body HTTP 200 readiness response", async () => {
    const server = http.createServer((request, response) => {
      expect(request.url).toBe("/readyz");
      response.writeHead(200).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await expect(waitForMailpit(server.address().port, 2_000)).resolves.toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects an unhealthy dependency within a bounded deadline", async () => {
    const server = http.createServer((request, response) => response.writeHead(503).end());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await expect(waitForMailpit(server.address().port, 100)).rejects.toMatchObject({ code: "MAIL_NOT_READY" });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("refuses another project's Compose identity before running Docker", () => {
    expect(() => runCompose(process.cwd(), "another-project", ["down"])).toThrow();
  });

  it("refuses test cleanup when the namespace is not this checkout's generated project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-foundation-cleanup-"));
    try {
      await expect(cleanupTestCompose(root, { runId: "a".repeat(32), composeProject: "foreign-project" }, "unknown", {}))
        .rejects.toMatchObject({ code: "TEST_CLEANUP_REFUSED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
