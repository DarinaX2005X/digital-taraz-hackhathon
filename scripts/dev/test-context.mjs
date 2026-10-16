import { randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { projectIdentity, localDatabaseUrl } from "./environment.mjs";
import { selectAvailablePorts } from "./ports.mjs";

export async function createTestContext(root, inherited = process.env) {
  const identity = await projectIdentity(root);
  const runId = randomUUID().replaceAll("-", "");
  const directory = path.join(identity.root, ".local-data", "tests", runId);
  const ports = await selectAvailablePorts({ database: {}, smtp: {}, mail: {}, app: {} });
  await mkdir(directory, { recursive: true });
  const composeProject = `tirlik-test-${identity.id}-${runId}`;
  return {
    runId,
    directory,
    composeProject,
    ports,
    env: {
      ...inherited,
      NODE_ENV: "test",
      DATABASE_URL: localDatabaseUrl(ports.database),
      TIRLIK_DB_PORT: String(ports.database),
      TIRLIK_SMTP_PORT: String(ports.smtp),
      TIRLIK_MAIL_UI_PORT: String(ports.mail),
      TIRLIK_DATA_DIR: path.join(directory, "files"),
      NEXT_DIST_DIR: path.relative(identity.root, path.join(directory, "next")).split(path.sep).join("/"),
      TIRLIK_TEST_NAMESPACE: runId,
      TIRLIK_TEST_COMPOSE_PROJECT: composeProject,
      TIRLIK_TEST_APP_PORT: String(ports.app),
      OPENROUTER_API_KEY: "",
      BREVO_API_KEY: "",
      BREVO_SMTP_KEY: "",
      BLOB_READ_WRITE_TOKEN: "",
      TIRLIK_STORAGE_DRIVER: "local",
      R2_ACCOUNT_ID: "",
      R2_BUCKET_NAME: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      VERCEL: "",
      VERCEL_ENV: "",
      VERCEL_DEPLOYMENT_ID: "",
      VERCEL_OIDC_TOKEN: "",
      VERCEL_TOKEN: "",
      WORKFLOW_TARGET_WORLD: "local",
      WORKFLOW_LOCAL_DATA_DIR: path.join(directory, "workflow"),
      PREFLIGHT_HOSTING_ENABLED: "0",
      PREFLIGHT_HOSTING_TOKEN: "",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(ports.smtp),
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMTP_REQUIRE_TLS: "false",
      SMTP_FROM: "Tirlik tests <no-reply@tirlik.invalid>",
      BETTER_AUTH_URL: `http://127.0.0.1:${ports.app}`,
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    },
  };
}

const generatedNames = ["next", "files", "workflow"];

async function completedRun(root, identity, runId, directory) {
  const logPath = path.join(directory, "integration.log");
  let info;
  try { info = await stat(logPath); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!info.isFile() || info.size > 32 * 1024 * 1024) return false;
  const log = await readFile(logPath, "utf8");
  const project = `tirlik-test-${identity.id}-${runId}`;
  return /Test Files\s+\d+ passed \(\d+\)/.test(log)
    && !/Test Files\s+\d+ failed \(\d+\)/.test(log)
    && log.includes("[Isolated test cleanup]")
    && log.includes(`Volume ${project}_postgres-data Removed`)
    && log.includes(`Network ${project}_default Removed`);
}

/** Removes only generated output from completed, fully cleaned isolated runs. Logs stay available. */
export async function pruneCompletedTestOutputs(root) {
  const identity = await projectIdentity(root), testsRoot = path.join(identity.root, ".local-data", "tests");
  await mkdir(testsRoot, { recursive: true });
  const canonicalTestsRoot = await realpath(testsRoot);
  let removed = 0, bytes = 0;
  for (const entry of await readdir(canonicalTestsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
    const directory = path.join(canonicalTestsRoot, entry.name), canonicalDirectory = await realpath(directory);
    if (path.dirname(canonicalDirectory) !== canonicalTestsRoot || path.basename(canonicalDirectory) !== entry.name) throw new Error("TEST_OUTPUT_CLEANUP_REFUSED");
    if (!await completedRun(identity.root, identity, entry.name, canonicalDirectory)) continue;
    for (const name of generatedNames) {
      const target = path.join(canonicalDirectory, name);
      let targetInfo;
      try { targetInfo = await lstat(target); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new Error("TEST_OUTPUT_CLEANUP_REFUSED");
      const canonicalTarget = await realpath(target);
      if (path.dirname(canonicalTarget) !== canonicalDirectory || path.basename(canonicalTarget) !== name) throw new Error("TEST_OUTPUT_CLEANUP_REFUSED");
      const size = await directoryBytes(canonicalTarget);
      await rm(canonicalTarget, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
      removed++; bytes += size;
    }
  }
  return { removed, bytes };
}

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("TEST_OUTPUT_CLEANUP_REFUSED");
    if (entry.isDirectory()) total += await directoryBytes(item);
    else if (entry.isFile()) total += (await stat(item)).size;
    else throw new Error("TEST_OUTPUT_CLEANUP_REFUSED");
  }
  return total;
}
