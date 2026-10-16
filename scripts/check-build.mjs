import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodeVersion, loadEnvironment, projectIdentity } from "./dev/environment.mjs";
import { reportCliError } from "./dev/errors.mjs";
import { runPackageCheck } from "./dev/process.mjs";
import { dependencyHash } from "./dev/dependencies.mjs";
import { assertProductionBuildIdle, invalidateProductionBuild, productionDistDir, productionInputHash, pruneProductionCompilerCache, recordProductionBuild } from "./dev/production-build.mjs";
import { acquireStartLock } from "./dev/runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let release;

try {
  assertNodeVersion();
  const identity = await projectIdentity(root);
  release = await acquireStartLock(identity.root);
  await assertProductionBuildIdle(identity.root, { identity });
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
} finally {
  if (release) await release().catch(reportCliError);
}
