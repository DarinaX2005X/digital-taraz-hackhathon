import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dependencyHash } from "../../scripts/dev/dependencies.mjs";
import { productionInputHash, pruneProductionCompilerCache, recordProductionBuild, verifyProductionBuild } from "../../scripts/dev/production-build.mjs";

const directories = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-production-build-test-"));
  directories.push(root);
  await Promise.all(["src/app/.well-known/workflow/v1/flow", "public", "migrations", "fixtures", ".local-data/build/server", ".local-data/build/static"]
    .map((relative) => mkdir(path.join(root, relative), { recursive: true })));
  await writeFile(path.join(root, "src", "entry.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, "next-env.d.ts"), "generated development types\n");
  await writeFile(path.join(root, "src", "app", ".well-known", "workflow", "v1", "flow", "route.js"), "generated development route\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "16.4.0" } }));
  await writeFile(path.join(root, "package-lock.json"), "fixture-lock\n");
  await writeFile(path.join(root, ".local-data", "build", "BUILD_ID"), "fixture_build_1\n");
  await writeFile(path.join(root, ".local-data", "build", "required-server-files.json"), JSON.stringify({ config: { distDir: ".local-data/build" }, appDir: root, files: [] }));
  await writeFile(path.join(root, ".local-data", "build", "routes-manifest.json"), "{}");
  await writeFile(path.join(root, ".local-data", "build", "prerender-manifest.json"), "{}");
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verified local production builds", () => {
  it("accepts a completed current build and rejects it after a source change", async () => {
    const root = await fixture();
    const env = { NEXT_PUBLIC_FIXTURE: "one", WORKFLOW_TARGET_WORLD: "local" };
    await expect(verifyProductionBuild(root, { env })).rejects.toMatchObject({ code: "PRODUCTION_BUILD_UNVERIFIED" });
    const inputHash = await productionInputHash(root, env);
    const manifest = await recordProductionBuild(root, { inputHash, env, lockHash: await dependencyHash(root) });
    await expect(verifyProductionBuild(root, { env })).resolves.toEqual(manifest);
    await writeFile(path.join(root, "next-env.d.ts"), "generated production types\n");
    await writeFile(path.join(root, "src", "app", ".well-known", "workflow", "v1", "flow", "route.js"), "generated production route\n");
    await expect(verifyProductionBuild(root, { env })).resolves.toEqual(manifest);
    await writeFile(path.join(root, "src", "entry.ts"), "export const value = 2;\n");
    await expect(verifyProductionBuild(root, { env })).rejects.toMatchObject({ code: "PRODUCTION_BUILD_STALE" });
  });

  it("removes only rebuild caches while preserving runnable output and its manifest", async () => {
    const root = await fixture();
    const env = {};
    const inputHash = await productionInputHash(root, env);
    await recordProductionBuild(root, { inputHash, env, lockHash: await dependencyHash(root) });
    await mkdir(path.join(root, ".local-data", "build", "cache", "webpack"), { recursive: true });
    await mkdir(path.join(root, ".local-data", "build", "cache", "swc"), { recursive: true });
    await writeFile(path.join(root, ".local-data", "build", "cache", "webpack", "pack"), "1234");
    await writeFile(path.join(root, ".local-data", "build", "cache", "swc", "pack"), "56");
    expect(await pruneProductionCompilerCache(root)).toEqual({ removed: 2, bytes: 6 });
    await expect(readFile(path.join(root, ".local-data", "build", "tirlik-build.json"), "utf8")).resolves.toContain("fixture_build_1");
    await expect(verifyProductionBuild(root, { env })).resolves.toMatchObject({ buildId: "fixture_build_1" });
  });
});
