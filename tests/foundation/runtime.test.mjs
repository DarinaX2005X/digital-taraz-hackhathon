import { randomUUID } from "node:crypto";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectIdentity } from "../../scripts/dev/environment.mjs";
import { acquireStartLock, controlRequest, newRuntime, readRuntime, recoverStartLock, runtimePaths, writeJsonAtomic } from "../../scripts/dev/runtime.mjs";

const directories = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-runtime-test-"));
  directories.push(root);
  return projectIdentity(root);
}
const ports = { app: 3000, database: 54329, smtp: 10259, mail: 8029 };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("owned runtime identity", () => {
  it("persists only this checkout's identity and rejects a foreign runtime", async () => {
    const identity = await fixture();
    const record = newRuntime(identity, ports, "lock-hash");
    const file = runtimePaths(identity.root).file;
    await writeJsonAtomic(file, record);
    expect(await readRuntime(identity.root, identity.id)).toEqual(record);
    await writeJsonAtomic(file, { ...record, projectId: "foreign-project" });
    await expect(readRuntime(identity.root, identity.id)).rejects.toMatchObject({ code: "RUNTIME_IDENTITY_MISMATCH" });
  });

  it("binds a production process identity to its verified build", async () => {
    const identity = await fixture();
    const record = newRuntime(identity, ports, "lock-hash", { mode: "production", distDir: ".local-data/build", buildId: "build_123", inputHash: "a".repeat(64) });
    const file = runtimePaths(identity.root).file;
    await writeJsonAtomic(file, record);
    expect(await readRuntime(identity.root, identity.id)).toMatchObject({ mode: "production", distDir: ".local-data/build", buildId: "build_123", inputHash: "a".repeat(64) });
    await writeJsonAtomic(file, { ...record, inputHash: null });
    await expect(readRuntime(identity.root, identity.id)).rejects.toMatchObject({ code: "RUNTIME_IDENTITY_MISMATCH" });
  });

  it("keeps the prior state when serializing an invalid replacement fails", async () => {
    const identity = await fixture();
    const file = runtimePaths(identity.root).file;
    await writeJsonAtomic(file, { preserved: "saved" });
    await expect(writeJsonAtomic(file, { invalid: 1n })).rejects.toThrow();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ preserved: "saved" });
  });

  it("sends the control token only in a header and verifies returned instance identity", async () => {
    const identity = await fixture();
    const record = newRuntime(identity, ports, "lock-hash");
    let foreign = false;
    const server = http.createServer((request, response) => {
      expect(request.url).toBe("/status");
      expect(request.headers.authorization).toBe(`Bearer ${record.token}`);
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ projectId: record.projectId, instanceId: foreign ? randomUUID() : record.instanceId, status: "ready" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    record.controlPort = server.address().port;
    try {
      expect(await controlRequest(record)).toMatchObject({ status: "ready" });
      foreign = true;
      expect(await controlRequest(record)).toBeNull();
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});

describe("startup lock recovery", () => {
  it("serializes starters and refuses to recover a live owner's lock", async () => {
    const identity = await fixture();
    const release = await acquireStartLock(identity.root);
    try {
      await expect(acquireStartLock(identity.root, { timeoutMs: 50 })).rejects.toMatchObject({ code: "START_BUSY" });
      await expect(recoverStartLock(identity.root)).rejects.toMatchObject({ code: "START_BUSY" });
    } finally { await release(); }
    const nextRelease = await acquireStartLock(identity.root);
    await nextRelease();
  });

  it("requires explicit recovery after an interrupted starter and preserves unverifiable locks", async () => {
    const identity = await fixture();
    const file = runtimePaths(identity.root).lock;
    await writeJsonAtomic(file, { ownerPid: 2_000_000_000, nonce: randomUUID() });
    await expect(acquireStartLock(identity.root)).rejects.toMatchObject({ code: "STALE_START_LOCK" });
    expect(await recoverStartLock(identity.root)).toBe(true);
    await writeJsonAtomic(file, {});
    await expect(recoverStartLock(identity.root)).rejects.toMatchObject({ code: "START_LOCK_INVALID" });
    expect(await readFile(file, "utf8")).toContain("{}");
  });
});
