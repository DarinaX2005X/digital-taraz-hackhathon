import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runPackageCheck } from "./dev/process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  assertNodeVersion();
  const env = await loadEnvironment(root, { mode: "test" });
  const logFile = path.join(root, ".local-data", "checks", `check-${Date.now()}.log`);
  for (const script of ["typecheck", "lint", "test:unit"]) {
    await runPackageCheck(script, { cwd: root, env, logFile, timeoutMs: 180_000 });
  }
  console.log("Type, lint, and unit/domain/locale/contract checks passed.");
} catch (error) {
  reportCliError(error);
}
