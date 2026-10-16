import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runPackageCheck } from "./dev/process.mjs";
import { dependencyHash } from "./dev/dependencies.mjs";
import { invalidateProductionBuild, productionDistDir, productionInputHash, pruneProductionCompilerCache, recordProductionBuild } from "./dev/production-build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  assertNodeVersion();
  const env = await loadEnvironment(root, { mode: "production" });
  env.NEXT_DIST_DIR = productionDistDir;
  const inputHash = await productionInputHash(root, env);
  const lockHash = await dependencyHash(root);
  await invalidateProductionBuild(root);
  await runPackageCheck("build", {
    cwd: root,
    env: { ...env, NODE_ENV: "production" },
    logFile: path.join(root, ".local-data", "checks", `build-${Date.now()}.log`),
    timeoutMs: 300_000,
  });
  const manifest = await recordProductionBuild(root, { inputHash, env, lockHash });
  const pruned = await pruneProductionCompilerCache(root);
  console.log(`Verified production build ${manifest.buildId} for the current source.`);
  if (pruned.removed) console.log(`Pruned ${pruned.removed} rebuild-only compiler cache directories (${pruned.bytes} bytes).`);
} catch (error) {
  reportCliError(error);
}
