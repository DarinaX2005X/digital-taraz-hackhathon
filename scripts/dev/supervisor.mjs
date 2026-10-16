import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { projectIdentity } from "./environment.mjs";
import { CliError, reportCliError } from "./errors.mjs";
import { readRuntime, runtimePaths, writeJsonAtomic } from "./runtime.mjs";
import { finishOwnedShutdown, startAppProcess, waitForAppHealth } from "./app-process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let record;
let app;
let launching;
let control;
let stopping;
let persistence = Promise.resolve();
let authorized = false;
const startup = new AbortController();

const publicState = () => ({ projectId: record.projectId, instanceId: record.instanceId, status: record.status, mode: record.mode, buildId: record.buildId, appPort: record.appPort, supervisorPid: record.supervisorPid, appPid: record.appPid });
const persist = (patch) => {
  Object.assign(record, patch);
  const snapshot = { ...record };
  persistence = persistence.catch(() => {}).then(() => writeJsonAtomic(runtimePaths(root).file, snapshot));
  return persistence;
};

async function shutdown(failed = false) {
  if (stopping) return stopping;
  startup.abort();
  stopping = finishOwnedShutdown({ persist, app: launching, control, failed });
  return stopping;
}

try {
  const identity = await projectIdentity(root);
  record = await readRuntime(identity.root, identity.id);
  if (!record || record.status !== "starting" || record.supervisorPid !== null || record.controlPort !== null
    || record.instanceId !== process.env.TIRLIK_DEV_INSTANCE || record.token !== process.env.TIRLIK_DEV_TOKEN
    || process.env.NODE_ENV !== record.mode || process.env.NEXT_DIST_DIR !== record.distDir) {
    throw new CliError("SUPERVISOR_IDENTITY_INVALID", "The supervisor was not launched by this checkout's start command.", "Use node scripts/dev/start.mjs.");
  }
  authorized = true;
  const expected = Buffer.from(`Bearer ${record.token}`);
  const env = { ...process.env };
  delete env.TIRLIK_DEV_TOKEN;
  delete env.TIRLIK_DEV_INSTANCE;
  launching = startAppProcess(root, { port: record.appPort, env, mode: record.mode, logFile: path.join(runtimePaths(root).directory, `app-${record.instanceId}.log`) });
  control = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const authorization = Buffer.from(request.headers.authorization ?? "");
    if (request.headers.origin || request.socket.remoteAddress !== "127.0.0.1" || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"error":"forbidden"}');
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(publicState()));
    } else if (request.method === "POST" && request.url === "/stop") {
      response.writeHead(202, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ ...publicState(), status: "stopping" }));
      setImmediate(() => void shutdown().then(() => process.exit(0)).catch((error) => { reportCliError(error); process.exit(1); }));
    } else response.writeHead(404).end();
  });
  control.requestTimeout = 3000;
  control.headersTimeout = 3000;
  control.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => { control.once("error", reject); control.listen(0, "127.0.0.1", resolve); });
  await persist({ supervisorPid: process.pid, controlPort: control.address().port });
  app = await launching;
  await persist({ appPid: app.pid ?? null });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown().then(() => process.exit(0)).catch(() => process.exit(1)));
  await waitForAppHealth(record.appPort, { process: app, signal: startup.signal });
  if (!stopping) {
    await persist({ status: "ready", readyAt: new Date().toISOString() });
    void app.completion.then(async (result) => {
      if (stopping) return;
      console.error(`[APP_EXITED] The owned application exited with code ${result.code ?? "unknown"}.`);
      await shutdown(true);
      process.exit(1);
    }).catch((error) => { reportCliError(error); process.exit(1); });
  }
} catch (error) {
  if (stopping) {
    try { await stopping; process.exit(0); } catch (stopError) { reportCliError(stopError); process.exit(1); }
  }
  if (app?.output) console.error(app.output);
  reportCliError(error);
  if (authorized) {
    try { await shutdown(true); } catch { /* Preserve the existing runtime identity for recovery. */ }
  }
  process.exit(1);
}
