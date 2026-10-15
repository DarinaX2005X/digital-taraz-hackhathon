import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { createRedactor } from "./environment.mjs";
import { delay } from "./runtime.mjs";

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function startAppProcess(root, { port, env, logFile, mode = "development" }) {
  if (!["development", "production"].includes(mode)) throw new CliError("APP_MODE_INVALID", "Unsupported local application mode.", "Use development or a previously compiled production build.");
  await mkdir(path.dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  const redact = createRedactor(env);
  let tail = "";
  let closed = false;
  let spawnError;
  let logError;
  let logBytes = 0;
  const command = mode === "production" ? ["start", root] : ["dev", root, "--webpack"];
  const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), ...command, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, env: { ...env, NODE_ENV: mode }, windowsHide: true, shell: false,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  log.on("error", () => { logError = true; });
  const write = (text) => {
    const safe = redact(text);
    tail = `${tail}${safe}`.slice(-8_000);
    logBytes += Buffer.byteLength(safe);
    if (!logError && logBytes <= 16 * 1024 * 1024) log.write(safe);
  };
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      pending += chunk;
      const boundary = pending.lastIndexOf("\n");
      if (boundary !== -1) { write(pending.slice(0, boundary + 1)); pending = pending.slice(boundary + 1); }
      if (pending.length > 1024 * 1024) { write("[Oversized diagnostic line omitted.]\n"); pending = ""; }
    });
    stream.on("end", () => { if (pending) write(pending); });
  }
  child.once("error", () => { spawnError = true; });
  const completion = new Promise((resolve) => child.once("close", (code, signal) => {
    closed = true;
    log.end(() => resolve({ code, signal, output: tail, spawnError, logError }));
  }));
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (closed) return completion;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32") {
          await new Promise((resolve) => {
            const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
            killer.once("error", () => { child.kill(); resolve(); });
            killer.once("close", resolve);
          });
        } else {
          try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") child.kill("SIGTERM"); }
          const stopped = await within(completion, 5_000);
          if (!stopped) {
            try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL"); }
          }
        }
      }
      const result = await within(completion, 10_000);
      if (!result) throw new CliError("APP_STOP_TIMEOUT", "The owned application did not stop within its deadline.", "Inspect its local logs. No unrelated process has been stopped.");
      return result;
    })();
    return stopping;
  };
  return { pid: child.pid, completion, stop, get closed() { return closed; }, get output() { return tail; } };
}

export async function waitForAppHealth(port, { timeoutMs = 120_000, process: appProcess, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new CliError("APP_START_CANCELLED", "Application startup was cancelled.", "Run node scripts/dev/start.mjs to start again.");
    if (appProcess?.closed) throw new CliError("APP_EXITED", "The owned application exited before becoming healthy.", "Inspect the application log and retry.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3_000), redirect: "error", headers: { Connection: "close" } });
      const data = await response.json();
      if (response.status === 200 && data.status === "ok" && data.service === "tirlik" && data.database === "ready") return data;
    } catch { /* Compilation and database readiness are bounded by the outer deadline. */ }
    await delay(400);
  }
  throw new CliError("APP_NOT_READY", "The application did not report a ready database before the startup deadline.", "Inspect the local startup and application logs, then retry.");
}

export async function finishOwnedShutdown({ persist, app, control, failed = false }) {
  let failure;
  try { await persist({ status: "stopping" }); } catch (error) { failure = error; }
  try { await (await app)?.stop(); } catch (error) { failure ??= error; }
  try {
    await new Promise((resolve) => {
      if (!control?.listening) { resolve(); return; }
      control.close(resolve);
      control.closeAllConnections();
    });
  } catch (error) { failure ??= error; }
  try {
    await persist({ status: failed ? "failed" : "stopped", controlPort: null, appPid: null, stoppedAt: new Date().toISOString() });
  } catch (error) { failure ??= error; }
  if (failure) throw new CliError("SHUTDOWN_INCOMPLETE", "The owned shutdown encountered a process or runtime-state error.", "Inspect the local logs before starting again; database and files were preserved.");
}
