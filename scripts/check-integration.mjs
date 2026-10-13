import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runPackageCheck } from "./dev/process.mjs";
import { createTestContext } from "./dev/test-context.mjs";
import { assertDockerAvailable, cleanupTestCompose, composeSpecHash, startCompose } from "./dev/compose.mjs";
import { startAppProcess, waitForAppHealth } from "./dev/app-process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let context;
let specHash;
let options;
let composeStarted = false;
let app;

try {
  assertNodeVersion();
  const inherited = await loadEnvironment(root, { mode: "test" });
  context = await createTestContext(root, inherited);
  options = { cwd: root, env: context.env, logFile: path.join(context.directory, "integration.log") };
  await assertDockerAvailable(options);
  specHash = await composeSpecHash(root);
  console.log("Starting isolated PostgreSQL and mail services...");
  composeStarted = true;
  await startCompose(root, context.composeProject, options);
  await runPackageCheck("db:migrate", { ...options, timeoutMs: 60_000 });
  await runPackageCheck("db:seed", { ...options, timeoutMs: 60_000 });
  console.log("Starting the isolated application for HTTP integration checks...");
  app = await startAppProcess(root, { port: context.ports.app, env: context.env, logFile: path.join(context.directory, "app.log") });
  await waitForAppHealth(context.ports.app, { process: app });
  await runPackageCheck("test:integration", { ...options, timeoutMs: 180_000 });
  console.log("PostgreSQL and HTTP integration checks passed.");
} catch (error) {
  if (error.result?.output) console.error(error.result.output);
  reportCliError(error);
} finally {
  try { await app?.stop(); } catch (error) { reportCliError(error); }
  if (composeStarted && (!app || app.closed)) {
    try {
      await cleanupTestCompose(root, context, specHash, options);
      console.log("Removed only this run's isolated containers and test volume.");
    } catch (error) {
      reportCliError(error);
    }
  }
}
