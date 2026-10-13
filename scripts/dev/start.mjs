import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment, projectIdentity } from "./environment.mjs";
import { CliError, reportCliError } from "./errors.mjs";
import { assertDevVolumeOwnership, assertDockerAvailable, inspectOwnedServices, startCompose } from "./compose.mjs";
import { runPackageCheck } from "./process.mjs";
import { dependencyHash, ensureDependencies } from "./dependencies.mjs";
import { resolveLocalConfig } from "./local-config.mjs";
import { acquireStartLock, controlRequest, delay, isProcessAlive, newRuntime, readRuntime, runtimePaths, writeJsonAtomic } from "./runtime.mjs";
import { waitForAppHealth } from "./app-process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let release;
let created;
let supervisor;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/dev/start.mjs [--port 3000]\nStarts the owned local services and application; preserves database and files.");
  } else {
    if (args.length && !(args.length === 2 && args[0] === "--port")) throw new CliError("ARGUMENT_INVALID", "Unsupported startup arguments.", "Use node scripts/dev/start.mjs [--port 3000].");
    assertNodeVersion();
    const identity = await projectIdentity(root);
    const paths = runtimePaths(identity.root);
    release = await acquireStartLock(identity.root);
    const previous = await readRuntime(identity.root, identity.id);
    const active = await controlRequest(previous);
    if (active) {
      if (active.status !== "ready") throw new CliError("APP_STATE_BUSY", "The owned application is still starting or stopping.", "Wait briefly and rerun node scripts/dev/start.mjs.");
      if (previous.lockHash !== await dependencyHash(root)) throw new CliError("DEPENDENCIES_CHANGED", "The lockfile changed while the owned application is running.", "Run node scripts/dev/stop.mjs, then node scripts/dev/start.mjs to install the new lockfile.");
      if (args[1] && Number(args[1]) !== previous.appPort) throw new CliError("APP_ALREADY_RUNNING", "The owned application is already running on another local port.", "Run node scripts/dev/stop.mjs before selecting a different port.");
      await waitForAppHealth(previous.appPort, { timeoutMs: 10_000 });
      console.log(`Tirlik is already running: http://127.0.0.1:${previous.appPort}/`);
      console.log(`Local mail: http://127.0.0.1:${previous.mailPort}/`);
    } else {
      if (previous && !["stopped", "failed"].includes(previous.status) && isProcessAlive(previous.supervisorPid)) {
        throw new CliError("CONTROL_UNAVAILABLE", "The recorded supervisor is alive but its private control endpoint did not respond.", "Inspect .local-data/dev logs; no PID from disk will be used to stop a process.");
      }
      const inherited = await loadEnvironment(identity.root);
      const logFile = path.join(paths.directory, `start-${Date.now()}.log`);
      const preflight = { cwd: identity.root, env: inherited, logFile };
      await assertDockerAvailable(preflight);
      const services = await inspectOwnedServices(identity.root, identity.composeProject, preflight);
      await assertDevVolumeOwnership(identity.composeProject, preflight);
      const config = await resolveLocalConfig(identity.root, inherited, previous, services, args[1]);
      const options = { cwd: identity.root, env: config.env, logFile };
      const dependencies = await ensureDependencies(identity.root, options);
      created = newRuntime(identity, config.ports, dependencies.lockHash);
      await writeJsonAtomic(paths.file, created);
      await mkdir(config.env.TIRLIK_DATA_DIR, { recursive: true });
      console.log("Starting the owned PostgreSQL and mail services...");
      await startCompose(identity.root, identity.composeProject, options);
      await runPackageCheck("db:migrate", { ...options, timeoutMs: 60_000 });
      await runPackageCheck("db:seed", { ...options, timeoutMs: 60_000 });
      const log = await open(path.join(paths.directory, `supervisor-${created.instanceId}.log`), "a", 0o600);
      let spawnFailed = false;
      try {
        supervisor = spawn(process.execPath, [path.join(root, "scripts", "dev", "supervisor.mjs")], {
          cwd: identity.root, env: { ...config.env, TIRLIK_DEV_INSTANCE: created.instanceId, TIRLIK_DEV_TOKEN: created.token },
          detached: true, windowsHide: true, shell: false, stdio: ["ignore", log.fd, log.fd],
        });
        supervisor.once("error", () => { spawnFailed = true; });
      } finally { await log.close(); }
      const deadline = Date.now() + 150_000;
      let ready = false;
      while (Date.now() < deadline) {
        if (spawnFailed || supervisor.exitCode !== null || supervisor.signalCode !== null) throw new CliError("SUPERVISOR_EXITED", "The local supervisor exited before application readiness.", "Inspect its .local-data/dev log, then retry.");
        const current = await readRuntime(identity.root, identity.id);
        const state = await controlRequest(current);
        if (state?.status === "ready") { ready = true; created = current; break; }
        if (current?.status === "failed") throw new CliError("APP_START_FAILED", "The owned application failed during startup.", "Inspect .local-data/dev logs, correct the cause, and rerun node scripts/dev/start.mjs.");
        await delay(400);
      }
      if (!ready) throw new CliError("SUPERVISOR_TIMEOUT", "The supervisor did not finish startup before its deadline.", "Run node scripts/dev/stop.mjs, inspect the local logs, and retry.");
      supervisor.unref();
      console.log(`Tirlik is ready: http://127.0.0.1:${created.appPort}/`);
      console.log(`Local mail: http://127.0.0.1:${created.mailPort}/`);
      console.log("Stop the application with: node scripts/dev/stop.mjs");
    }
  }
} catch (error) {
  if (error.result?.output) console.error(error.result.output);
  reportCliError(error);
  if (created) {
    const current = await readRuntime(created.root, created.projectId).catch(() => null);
    if (current?.instanceId === created.instanceId) {
      if (current.controlPort) await controlRequest(current, "stop");
      else if (!supervisor || supervisor.exitCode !== null) await writeJsonAtomic(runtimePaths(created.root).file, { ...current, status: "failed" });
    }
    supervisor?.unref();
  }
} finally {
  if (release) await release().catch(reportCliError);
}
