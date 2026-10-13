import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runPackageCheck } from "./dev/process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  assertNodeVersion();
  const env = await loadEnvironment(root, { mode: "production" });
  await runPackageCheck("build", {
    cwd: root,
    env: { ...env, NODE_ENV: "production", NEXT_DIST_DIR: ".local-data/build" },
    logFile: path.join(root, ".local-data", "checks", `build-${Date.now()}.log`),
    timeoutMs: 300_000,
  });
} catch (error) {
  reportCliError(error);
}
