import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectIdentity } from "./environment.mjs";
import { CliError, reportCliError } from "./errors.mjs";
import { controlRequest, delay, isProcessAlive, readRuntime, recoverStartLock } from "./runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/dev/stop.mjs [--recover-lock]\nStops only the application owned by this checkout. Database, mail, volumes, and files remain available.");
  } else {
    if (args.length && !(args.length === 1 && args[0] === "--recover-lock")) throw new CliError("ARGUMENT_INVALID", "Unsupported stop arguments.", "Use node scripts/dev/stop.mjs [--recover-lock].");
    const identity = await projectIdentity(root);
    const runtime = await readRuntime(identity.root, identity.id);
    const active = await controlRequest(runtime);
    if (active) {
      if (!await controlRequest(runtime, "stop")) throw new CliError("STOP_REFUSED", "The owned supervisor did not accept the stop request.", "Retry node scripts/dev/stop.mjs and inspect its local log if it remains unavailable.");
      const deadline = Date.now() + 20_000;
      let stopped = false;
      while (Date.now() < deadline) {
        const current = await readRuntime(identity.root, identity.id);
        if (current?.instanceId !== runtime.instanceId) throw new CliError("RUNTIME_CHANGED", "A different local instance started during shutdown.", "Inspect the local runtime state before retrying.");
        if (current.status === "stopped") { stopped = true; break; }
        if (current.status === "failed") throw new CliError("STOP_FAILED", "The supervisor reported an incomplete shutdown.", "Inspect its local logs. No unrelated process has been stopped.");
        await delay(200);
      }
      if (!stopped) throw new CliError("STOP_TIMEOUT", "The owned application did not confirm shutdown in time.", "Inspect .local-data/dev logs before retrying.");
      console.log("Stopped the owned Tirlik application. Database and local files were preserved.");
    } else if (runtime && !["stopped", "failed"].includes(runtime.status) && isProcessAlive(runtime.supervisorPid)) {
      throw new CliError("CONTROL_UNAVAILABLE", "The recorded process is alive but its private control endpoint did not respond.", "Inspect .local-data/dev logs. This command will not terminate an unverified process by PID.");
    } else console.log("No owned application is running. Database and local files were preserved.");
    if (args[0] === "--recover-lock") console.log(await recoverStartLock(identity.root) ? "Removed the interrupted startup lock after confirming its process has exited." : "No interrupted startup lock was present.");
  }
} catch (error) {
  reportCliError(error);
}
