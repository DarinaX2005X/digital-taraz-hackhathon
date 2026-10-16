import path from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runNpm, runPackageCheck } from "./dev/process.mjs";
import { createTestContext } from "./dev/test-context.mjs";
import { assertDockerAvailable, cleanupTestCompose, composeSpecHash, startCompose } from "./dev/compose.mjs";
import { startAppProcess, waitForAppHealth } from "./dev/app-process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productPhases = ["http-artifacts", "http-workspace", "http-demo", "http-sources", "http-sheets", "http-materials"];
const phases = ["database", "http-identity", ...productPhases, "http-runtime"];
const selectedFiles = [];
let productionBuild;

function selectedPhases(args) {
  if (!args.length) return phases;
  if (args.length < 2 || args[0] !== "--phase") throw new Error("Expected --phase database|http-identity|http-artifacts|http-workspace|http-demo|http-sources|http-sheets|http-materials|http-runtime|http-product|http, optionally followed by --test-file tests/path.integration.test.ts or --production-build .local-data/build-next/name.");
  for (let i = 2; i < args.length; i += 2) {
    const file = args[i + 1];
    if (args[i] === "--production-build" && file && !productionBuild && args[1] !== "database") { productionBuild = file; continue; }
    if (args[i] !== "--test-file" || !file || !/^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.integration\.test\.(ts|mjs)$/.test(file)) throw new Error("INVALID_INTEGRATION_TEST_FILE");
    selectedFiles.push(file);
  }
  if (selectedFiles.length && !phases.includes(args[1])) throw new Error("TARGETED_TESTS_REQUIRE_ONE_PHASE");
  if (args[1] === "http") return phases.filter((phase) => phase !== "database");
  if (args[1] === "http-product") return productPhases;
  if (!phases.includes(args[1])) throw new Error("INVALID_INTEGRATION_PHASE");
  return [args[1]];
}

async function runPhase(phase) {
  const inherited = await loadEnvironment(root, { mode: "test" });
  const context = await createTestContext(root, inherited);
  const options = { cwd: root, env: { ...context.env, TIRLIK_INTEGRATION_PHASE: phase }, logFile: path.join(context.directory, "integration.log") };
  if (productionBuild) {
    const buildsRoot = await realpath(path.join(root, ".local-data", "build-next"));
    const directory = await realpath(path.resolve(root, productionBuild));
    const relative = path.relative(buildsRoot, directory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("ISOLATED_PRODUCTION_BUILD_REQUIRED");
    const buildId = (await readFile(path.join(directory, "BUILD_ID"), "utf8")).trim();
    if (!buildId || buildId.length > 512) throw new Error("COMPLETED_PRODUCTION_BUILD_REQUIRED");
    options.env.NEXT_DIST_DIR = path.relative(root, directory).replaceAll("\\", "/");
    console.log(`Using completed local production build ${buildId}.`);
  }
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
      app = await startAppProcess(root, { port: context.ports.app, env: options.env, logFile: path.join(context.directory, "app.log"), ...(productionBuild ? { mode: "production" } : {}) });
      // A cold development compiler may spend most of the default health window
      // loading Next configuration and instrumentation before it can compile the
      // first health request. Keep the product-test and cleanup deadlines
      // unchanged; only bound the owned cold start separately.
      await waitForAppHealth(context.ports.app, { process: app, timeoutMs: productionBuild ? 120_000 : 240_000 });
    }
    // Leave time for owned app/container cleanup before the checkpoint helper's 300s deadline.
    const testOptions = { ...options, timeoutMs: phase === "database" ? 180_000 : 240_000 };
    if (selectedFiles.length) {
      console.log(`Checking selected integration files: ${selectedFiles.join(", ")}`);
      const result = await runNpm(["run", "test:integration", "--", ...selectedFiles], { ...testOptions, label: "test:integration:selected" });
      console.log(result.output);
    } else await runPackageCheck("test:integration", testOptions);
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
