import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { runNpm } from "./process.mjs";
import { writeJsonAtomic } from "./runtime.mjs";

export async function dependencyHash(root) {
  try {
    return createHash("sha256").update(await readFile(path.join(root, "package-lock.json"))).digest("hex");
  } catch {
    throw new CliError("LOCKFILE_MISSING", "The dependency lockfile is missing or unreadable.", "Restore package-lock.json from this checkout before starting.");
  }
}

export async function ensureDependencies(root, options = {}) {
  const lockHash = await dependencyHash(root);
  const markerPath = path.join(root, ".local-data", "dev", "dependencies.json");
  const expected = { lockHash, nodeVersion: process.versions.node, platform: process.platform, arch: process.arch };
  let installed = false;
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    await requiredDependencies(root);
    installed = Object.entries(expected).every(([key, value]) => marker[key] === value);
  } catch { /* A missing or outdated stamp requires a reproducible install. */ }
  if (!installed) {
    console.log("Installing the locked dependencies with npm ci...");
    // Production startup still needs the repository's pinned migration and
    // verification CLIs. NODE_ENV=production must not make npm omit them.
    await runNpm(["ci", "--include=dev", "--no-audit", "--no-fund"], { ...options, cwd: root, label: "Locked dependency install", timeoutMs: 600_000 });
    if (await dependencyHash(root) !== lockHash) {
      throw new CliError("LOCKFILE_CHANGED", "The dependency lockfile changed during installation.", "Let the dependency update finish, then rerun node scripts/dev/start.mjs.");
    }
    try { await requiredDependencies(root); }
    catch { throw new CliError("DEPENDENCIES_INCOMPLETE", "The locked dependency installation did not provide the required local tools.", "Inspect the install log, then rerun node scripts/dev/start.mjs."); }
    await writeJsonAtomic(markerPath, expected);
  }
  return { lockHash, installed: !installed };
}

function requiredDependencies(root) {
  return Promise.all(["next/dist/bin/next", "tsx/dist/cli.mjs", "vitest/vitest.mjs", "typescript/bin/tsc"].map((file) => access(path.join(root, "node_modules", file))));
}
