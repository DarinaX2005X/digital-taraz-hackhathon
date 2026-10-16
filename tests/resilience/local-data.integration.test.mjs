import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalBackup, restoreLocalBackup, verifyLocalBackup } from "../../scripts/ops/local-data-core.mjs";
import { postgresDatabaseAdapter } from "../../scripts/ops/postgres-backup.mjs";

let context;

beforeAll(async () => {
  const namespace = process.env.TIRLIK_TEST_NAMESPACE ?? "";
  const project = process.env.TIRLIK_TEST_COMPOSE_PROJECT ?? "";
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  const dataDir = path.resolve(process.env.TIRLIK_DATA_DIR ?? "");
  const workflowDir = path.resolve(process.env.WORKFLOW_LOCAL_DATA_DIR ?? "");
  if (!/^[a-f0-9]{32}$/.test(namespace) || !new RegExp(`^tirlik-test-[a-f0-9]{12}-${namespace}$`).test(project)
    || databaseUrl.hostname !== "127.0.0.1" || databaseUrl.pathname !== "/tirlik") throw new Error("ISOLATED_BACKUP_DATABASE_REQUIRED");
  const runDirectory = path.dirname(dataDir);
  if (path.dirname(workflowDir) !== runDirectory || path.basename(dataDir) !== "files" || path.basename(workflowDir) !== "workflow") throw new Error("ISOLATED_BACKUP_FILES_REQUIRED");
  const table = `backup_probe_${namespace}`;
  const sourceDirectory = path.join(runDirectory, "local-backup-source");
  const safetyDirectory = path.join(runDirectory, "local-backup-safety");
  await Promise.all([dataDir, workflowDir].map((directory) => mkdir(directory, { recursive: true })));
  const pool = new Pool({ connectionString: databaseUrl.href });
  await pool.query(`CREATE TABLE ${table}(value text NOT NULL)`);
  await pool.query(`INSERT INTO ${table}(value) VALUES('database-before')`);
  await pool.end();
  await writeFile(path.join(dataDir, "backup-probe.txt"), "files-before\n");
  await writeFile(path.join(workflowDir, "backup-probe.json"), "{\"state\":\"before\"}\n");
  context = {
    root: process.cwd(), dataDir, workflowDir, migrationsDir: path.join(process.cwd(), "migrations"),
    sourceDirectory, safetyDirectory, table, databaseUrl,
    database: postgresDatabaseAdapter({ root: process.cwd(), project, env: process.env, logFile: path.join(runDirectory, "local-backup.log") }),
  };
});

afterAll(async () => {
  if (!context) return;
  const pool = new Pool({ connectionString: context.databaseUrl.href });
  await pool.query(`DROP TABLE IF EXISTS ${context.table}`);
  await pool.end();
  await Promise.all([context.sourceDirectory, context.safetyDirectory].map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("isolated PostgreSQL and filesystem backup", () => {
  it("restores a transactionally replaced database with its matching files and workflow state", async () => {
    await createLocalBackup({ ...context, outputDirectory: context.sourceDirectory });
    const pool = new Pool({ connectionString: context.databaseUrl.href });
    await pool.query(`UPDATE ${context.table} SET value='database-after'`);
    await pool.end();
    await writeFile(path.join(context.dataDir, "backup-probe.txt"), "files-after\n");
    await writeFile(path.join(context.workflowDir, "backup-probe.json"), "{\"state\":\"after\"}\n");

    const restored = await restoreLocalBackup(context);
    const verifiedPool = new Pool({ connectionString: context.databaseUrl.href });
    const result = await verifiedPool.query(`SELECT value FROM ${context.table}`);
    await verifiedPool.end();
    expect(result.rows).toEqual([{ value: "database-before" }]);
    await expect(readFile(path.join(context.dataDir, "backup-probe.txt"), "utf8")).resolves.toBe("files-before\n");
    await expect(readFile(path.join(context.workflowDir, "backup-probe.json"), "utf8")).resolves.toBe("{\"state\":\"before\"}\n");
    expect(restored.safetyDirectory).toBe(context.safetyDirectory);
    await expect(verifyLocalBackup({ ...context, sourceDirectory: context.safetyDirectory })).resolves.toMatchObject({ directory: context.safetyDirectory });
  });
});
