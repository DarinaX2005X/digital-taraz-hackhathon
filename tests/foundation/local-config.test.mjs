import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalConfig } from "../../scripts/dev/local-config.mjs";
import { reserveLoopbackPort } from "../../scripts/dev/ports.mjs";

const directories = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-local-config-test-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local startup configuration", () => {
  it("uses verified owned service ports while preserving persistent file storage", async () => {
    const root = await fixture();
    const occupied = await reserveLoopbackPort();
    try {
      const config = await resolveLocalConfig(root, {}, undefined, { postgres: { running: true, ports: { "5432/tcp": occupied.port } } });
      expect(config.ports.database).toBe(occupied.port);
      expect(config.env.DATABASE_URL).toContain(`127.0.0.1:${occupied.port}`);
      expect(config.env.TIRLIK_DATA_DIR).toBe(path.join(root, ".local-data", "files"));
      expect(config.env.BETTER_AUTH_URL).toBe(`http://127.0.0.1:${config.ports.app}`);
    } finally { await occupied.release(); }
  });

  it("refuses an explicit busy application port without affecting its owner", async () => {
    const root = await fixture();
    const occupied = await reserveLoopbackPort();
    try {
      await expect(resolveLocalConfig(root, {}, undefined, {}, String(occupied.port))).rejects.toMatchObject({ code: "PORT_UNAVAILABLE" });
      await expect(reserveLoopbackPort(occupied.port)).rejects.toMatchObject({ code: "PORT_UNAVAILABLE" });
    } finally { await occupied.release(); }
  });

  it("refuses remote databases and file directories outside .local-data", async () => {
    const root = await fixture();
    await expect(resolveLocalConfig(root, { DATABASE_URL: "postgresql://user:secret@remote.example/real" }, undefined, {}))
      .rejects.toMatchObject({ code: "DATABASE_NOT_LOCAL_COMPOSE" });
    await expect(resolveLocalConfig(root, { TIRLIK_DATA_DIR: "../foreign-data" }, undefined, {}))
      .rejects.toMatchObject({ code: "DATA_DIRECTORY_OUTSIDE_LOCAL_ROOT" });
  });
});
