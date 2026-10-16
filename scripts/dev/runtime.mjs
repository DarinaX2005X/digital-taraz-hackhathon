import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.mjs";

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function runtimePaths(root) {
  const directory = path.join(root, ".local-data", "dev");
  return { directory, file: path.join(directory, "runtime.json"), lock: path.join(directory, "start.lock") };
}

export async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await usingFile(temporary, async (handle) => {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
      await handle.sync();
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function usingFile(file, callback) {
  const handle = await open(file, "wx", 0o600);
  try { await callback(handle); } finally { await handle.close(); }
}

export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

function validLockOwner(value) {
  return Number.isSafeInteger(value?.ownerPid) && value.ownerPid > 0 && /^[a-f0-9-]{36}$/.test(value.nonce ?? "");
}

export async function readRuntime(root, projectId) {
  let data;
  try {
    data = JSON.parse(await readFile(runtimePaths(root).file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new CliError("RUNTIME_INVALID", "Cannot read the local runtime identity.", "Preserve .local-data/dev/runtime.json and inspect its format before retrying.");
  }
  const mode = data.mode ?? "development";
  const distDir = data.distDir ?? ".next";
  const buildId = data.buildId ?? null;
  const inputHash = data.inputHash ?? null;
  if (data.version !== 1 || data.projectId !== projectId || data.root !== root
    || data.composeProject !== `tirlik-${projectId}`
    || !/^[a-f0-9-]{36}$/.test(data.instanceId ?? "")
    || !/^[a-f0-9]{64}$/.test(data.token ?? "")
    || !["starting", "ready", "stopping", "stopped", "failed"].includes(data.status)
    || [data.appPort, data.databasePort, data.smtpPort, data.mailPort].some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
    || (data.controlPort !== null && (!Number.isInteger(data.controlPort) || data.controlPort < 1024 || data.controlPort > 65535))
    || !["development", "production"].includes(mode)
    || (mode === "development" && (distDir !== ".next" || buildId !== null || inputHash !== null))
    || (mode === "production" && (distDir !== ".local-data/build" || !/^[A-Za-z0-9_-]{1,128}$/.test(buildId ?? "") || !/^[a-f0-9]{64}$/.test(inputHash ?? "")))) {
    throw new CliError("RUNTIME_IDENTITY_MISMATCH", "The saved runtime does not match this checkout.", "Inspect .local-data/dev/runtime.json; no process or volume has been stopped.");
  }
  return { ...data, mode, distDir, buildId, inputHash };
}

export function newRuntime(identity, ports, lockHash, application = {}) {
  const mode = application.mode ?? "development";
  const distDir = application.distDir ?? (mode === "production" ? ".local-data/build" : ".next");
  const buildId = application.buildId ?? null;
  const inputHash = application.inputHash ?? null;
  return {
    version: 1, root: identity.root, projectId: identity.id, composeProject: identity.composeProject,
    instanceId: randomUUID(), token: randomBytes(32).toString("hex"), status: "starting",
    appPort: ports.app, databasePort: ports.database, smtpPort: ports.smtp, mailPort: ports.mail,
    controlPort: null, supervisorPid: null, appPid: null, lockHash, mode, distDir, buildId, inputHash, startedAt: new Date().toISOString(),
  };
}

export async function controlRequest(runtime, operation = "status") {
  if (!runtime?.controlPort) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.controlPort}/${operation}`, {
      method: operation === "status" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${runtime.token}`, Connection: "close" },
      signal: AbortSignal.timeout(2_000), redirect: "error",
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.projectId !== runtime.projectId || result.instanceId !== runtime.instanceId) return null;
    return result;
  } catch { return null; }
}

export async function acquireStartLock(root, { timeoutMs = 360_000 } = {}) {
  const { directory, lock } = runtimePaths(root);
  await mkdir(directory, { recursive: true });
  const nonce = randomUUID();
  const deadline = Date.now() + timeoutMs;
  let waiting = false;
  while (true) {
    let handle;
    try {
      handle = await open(lock, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ ownerPid: process.pid, nonce, createdAt: new Date().toISOString() }));
      await handle.close();
      return async () => {
        const current = JSON.parse(await readFile(lock, "utf8"));
        if (current.nonce !== nonce) throw new CliError("START_LOCK_CHANGED", "The startup lock owner changed.", "Inspect .local-data/dev/start.lock.");
        await unlink(lock);
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      let existing;
      try { existing = JSON.parse(await readFile(lock, "utf8")); } catch (readError) {
        if (readError.code === "ENOENT" || readError instanceof SyntaxError) {
          if (Date.now() < deadline) { await delay(100); continue; }
        }
        throw new CliError("START_LOCK_INVALID", "Cannot verify the startup lock owner.", "Inspect .local-data/dev/start.lock before retrying.");
      }
      if (!validLockOwner(existing)) throw new CliError("START_LOCK_INVALID", "Cannot verify the startup lock owner.", "Inspect .local-data/dev/start.lock; it has been preserved.");
      if (!isProcessAlive(existing.ownerPid)) {
        throw new CliError("STALE_START_LOCK", "A previous startup was interrupted.", "Run node scripts/dev/stop.mjs --recover-lock, then node scripts/dev/start.mjs.");
      }
      if (Date.now() >= deadline) throw new CliError("START_BUSY", "Another startup is still in progress.", "Wait for that command to finish, then run node scripts/dev/start.mjs again.");
      if (!waiting) { console.log("Another local start is in progress; waiting for its result..."); waiting = true; }
      await delay(500);
    }
  }
}

export async function recoverStartLock(root) {
  const { lock } = runtimePaths(root);
  let existing;
  try { existing = JSON.parse(await readFile(lock, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new CliError("START_LOCK_INVALID", "Cannot verify the startup lock owner.", "Inspect .local-data/dev/start.lock; it has been preserved.");
  }
  if (!validLockOwner(existing)) throw new CliError("START_LOCK_INVALID", "Cannot verify the startup lock owner.", "Inspect .local-data/dev/start.lock; it has been preserved.");
  if (isProcessAlive(existing.ownerPid)) throw new CliError("START_BUSY", "The recorded startup process is still running.", "Wait for it to finish. No process has been stopped.");
  await unlink(lock);
  return true;
}
