import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runPackageCheck } from "./dev/process.mjs";
import { createTestContext } from "./dev/test-context.mjs";
import { assertDockerAvailable, cleanupTestCompose, composeSpecHash, startCompose } from "./dev/compose.mjs";
import { startAppProcess, waitForAppHealth } from "./dev/app-process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productPhases = ["http-artifacts", "http-workspace", "http-sources"];
const phases = ["database", "http-identity", ...productPhases, "http-runtime"];

function selectedPhases(args) {
  if (!args.length) return phases;
  if (args.length !== 2 || args[0] !== "--phase") throw new Error("Expected --phase database|http-identity|http-artifacts|http-workspace|http-sources|http-runtime|http-product|http.");
  if (args[1] === "http") return phases.filter((phase) => phase !== "database");
  if (args[1] === "http-product") return productPhases;
  if (!phases.includes(args[1])) throw new Error("INVALID_INTEGRATION_PHASE");
  return [args[1]];
}

async function runPhase(phase) {
  const inherited = await loadEnvironment(root, { mode: "test" });
  const context = await createTestContext(root, inherited);
  const options = { cwd: root, env: { ...context.env, TIRLIK_INTEGRATION_PHASE: phase }, logFile: path.join(context.directory, "integration.log") };
  const specHash = await composeSpecHash(root);
  let composeStarted = false;
  let app;
  try {
    await assertDockerAvailable(options);
    console.log(`Starting isolated ${phase} integration services...`);
    console.log(`Test run ${context.runId}; logs: ${context.directory}`);
    composeStarted = true;
    await startCompose(root, context.composeProject, options);
    await runPackageCheck("db:migrate", { ...options, timeoutMs: 60_000 });
    await runPackageCheck("db:seed", { ...options, timeoutMs: 60_000 });
    if (phase !== "database") {
      console.log("Starting the isolated application for HTTP integration checks...");
      app = await startAppProcess(root, { port: context.ports.app, env: options.env, logFile: path.join(context.directory, "app.log") });
      await waitForAppHealth(context.ports.app, { process: app });
    }
    // Leave time for owned app/container cleanup before the checkpoint helper's 300s deadline.
    await runPackageCheck("test:integration", { ...options, timeoutMs: phase === "database" ? 180_000 : 240_000 });
  } finally {
    await app?.stop();
    if (composeStarted && (!app || app.closed)) {
      await cleanupTestCompose(root, context, specHash, options);
      console.log(`Removed only the ${phase} phase's isolated containers and test volume.`);
    }
  }
}

try {
  assertNodeVersion();
  // Each phase has fresh data: fixture queues cannot be claimed by the HTTP app.
  for (const phase of selectedPhases(process.argv.slice(2))) await runPhase(phase);
  console.log("Selected PostgreSQL and HTTP integration checks passed.");
} catch (error) {
  if (error.result?.output) console.error(error.result.output);
  reportCliError(error);
}
