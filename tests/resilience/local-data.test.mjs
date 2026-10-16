import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalBackup, restoreLocalBackup, verifyLocalBackup } from "../../scripts/ops/local-data-core.mjs";
import { assertLocalApplicationStopped } from "../../scripts/ops/local-data-runtime.mjs";

const directories = [];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-local-data-test-"));
  directories.push(root);
  const dataDir = path.join(root, ".local-data", "files");
  const workflowDir = path.join(root, ".local-data", "workflow");
  const migrationsDir = path.join(root, "migrations");
  await Promise.all([dataDir, workflowDir, migrationsDir].map((directory) => mkdir(directory, { recursive: true })));
  const migration = "CREATE TABLE example(id text primary key);\n";
  await writeFile(path.join(migrationsDir, "0001_example.sql"), migration);
  await mkdir(path.join(dataDir, "sources"));
  await writeFile(path.join(dataDir, "sources", "бриф.txt"), "исходные данные\n");
  await writeFile(path.join(dataDir, "binary.dat"), Buffer.from([0, 1, 2, 255]));
  await mkdir(path.join(workflowDir, "build-a"));
  await writeFile(path.join(workflowDir, "build-a", "state.json"), "{\"step\":1}\n");
  const state = { value: "database-before" };
  const applied = [{ name: "0001_example.sql", hash: sha256(migration) }];
  const database = {
    async migrationHistory() { return applied; },
    async dump(output) { await writeFile(output, state.value); },
    async restore(input) { state.value = await readFile(input, "utf8"); },
  };
  return { root, dataDir, workflowDir, migrationsDir, state, database };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local data continuity", () => {
  it("round-trips the database, uploaded/exported files, and workflow state while preserving a safety backup", async () => {
    const context = await fixture();
    const sourceDirectory = path.join(context.root, ".local-data", "backups", "source");
    const safetyDirectory = path.join(context.root, ".local-data", "backups", "pre-restore");
    await createLocalBackup({ ...context, sourceDirectory: undefined, outputDirectory: sourceDirectory });

    context.state.value = "database-after";
    await writeFile(path.join(context.dataDir, "sources", "бриф.txt"), "изменено\n");
    await writeFile(path.join(context.workflowDir, "build-a", "state.json"), "{\"step\":2}\n");

    const restored = await restoreLocalBackup({ ...context, sourceDirectory, safetyDirectory });
    expect(context.state.value).toBe("database-before");
    await expect(readFile(path.join(context.dataDir, "sources", "бриф.txt"), "utf8")).resolves.toBe("исходные данные\n");
    await expect(readFile(path.join(context.dataDir, "binary.dat"))).resolves.toEqual(Buffer.from([0, 1, 2, 255]));
    await expect(readFile(path.join(context.workflowDir, "build-a", "state.json"), "utf8")).resolves.toBe("{\"step\":1}\n");
    expect(restored.safetyDirectory).toBe(safetyDirectory);
    await expect(verifyLocalBackup({ ...context, sourceDirectory: safetyDirectory })).resolves.toMatchObject({ directory: safetyDirectory });
    expect(context.state.value).toBe("database-before");
  });

  it("rejects a tampered backup before changing the isolated target", async () => {
    const context = await fixture();
    const sourceDirectory = path.join(context.root, ".local-data", "backups", "source");
    const safetyDirectory = path.join(context.root, ".local-data", "backups", "pre-restore");
    await createLocalBackup({ ...context, outputDirectory: sourceDirectory });
    await writeFile(path.join(sourceDirectory, "files", "sources", "бриф.txt"), "tampered\n");
    context.state.value = "database-current";
    await writeFile(path.join(context.dataDir, "sources", "бриф.txt"), "current\n");

    await expect(restoreLocalBackup({ ...context, sourceDirectory, safetyDirectory })).rejects.toMatchObject({ code: "BACKUP_CONTENT_MISMATCH" });
    expect(context.state.value).toBe("database-current");
    await expect(readFile(path.join(context.dataDir, "sources", "бриф.txt"), "utf8")).resolves.toBe("current\n");
    await expect(readFile(path.join(safetyDirectory, "manifest.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves current files and a verified safety backup when the transactional database restore fails", async () => {
    const context = await fixture();
    const sourceDirectory = path.join(context.root, ".local-data", "backups", "source");
    const safetyDirectory = path.join(context.root, ".local-data", "backups", "pre-restore");
    await createLocalBackup({ ...context, outputDirectory: sourceDirectory });
    context.state.value = "database-current";
    await writeFile(path.join(context.dataDir, "sources", "бриф.txt"), "current\n");
    const database = { ...context.database, async restore() { throw new Error("synthetic transactional refusal"); } };

    await expect(restoreLocalBackup({ ...context, database, sourceDirectory, safetyDirectory })).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(context.state.value).toBe("database-current");
    await expect(readFile(path.join(context.dataDir, "sources", "бриф.txt"), "utf8")).resolves.toBe("current\n");
    await expect(verifyLocalBackup({ ...context, sourceDirectory: safetyDirectory })).resolves.toMatchObject({ directory: safetyDirectory });
  });

  it("refuses a restore when the checkout no longer contains the applied migration history", async () => {
    const context = await fixture();
    const sourceDirectory = path.join(context.root, ".local-data", "backups", "source");
    await createLocalBackup({ ...context, outputDirectory: sourceDirectory });
    await writeFile(path.join(context.migrationsDir, "0001_example.sql"), "CREATE TABLE changed(id text primary key);\n");
    await expect(verifyLocalBackup({ ...context, sourceDirectory })).rejects.toMatchObject({ code: "BACKUP_MIGRATION_MISMATCH" });
  });

  it("requires the owned application to be terminal before backup or restore", async () => {
    const identity = { root: "C:/fixture", id: "abc", composeProject: "tirlik-abc" };
    const ready = { mode: "production", status: "ready" };
    await expect(assertLocalApplicationStopped(identity.root, {
      identity,
      readRuntime: async () => ready,
      controlRequest: async () => ({ status: "ready" }),
    })).rejects.toMatchObject({ code: "LOCAL_APP_ACTIVE" });
    await expect(assertLocalApplicationStopped(identity.root, {
      identity,
      readRuntime: async () => ({ ...ready, status: "stopped" }),
      controlRequest: async () => null,
    })).resolves.toMatchObject({ status: "stopped" });
  });
});
