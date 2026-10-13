import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext } from "../../scripts/dev/test-context.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("isolated integration context", () => {
  it("replaces inherited database and storage targets and isolates simultaneous runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-foundation-context-"));
    directories.push(root);
    const inherited = { DATABASE_URL: "postgresql://someone:secret@remote.example/production", TIRLIK_DATA_DIR: "foreign-files", NEXT_DIST_DIR: "foreign-build" };
    const first = await createTestContext(root, inherited);
    const second = await createTestContext(root, inherited);
    expect(first.composeProject).not.toBe(second.composeProject);
    expect(first.composeProject).toMatch(/^tirlik-test-[a-f0-9]{12}-[a-f0-9]{32}$/);
    expect(first.directory).not.toBe(second.directory);
    expect(first.env.DATABASE_URL).toContain(`127.0.0.1:${first.ports.database}/tirlik`);
    expect(first.env.DATABASE_URL).not.toContain("remote.example");
    expect(first.env.TIRLIK_DATA_DIR).toBe(path.join(first.directory, "files"));
    expect(first.env.NEXT_DIST_DIR).toBe(`.local-data/tests/${first.runId}/next`);
    expect(first.env.TIRLIK_TEST_NAMESPACE).toBe(first.runId);
    expect(inherited.TIRLIK_DATA_DIR).toBe("foreign-files");
  });
});
