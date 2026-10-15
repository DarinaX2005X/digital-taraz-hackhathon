import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

const databaseFiles = [
  "tests/agent-tools/business.integration.test.ts",
  "tests/artifacts/server/project-sources.integration.test.ts",
  "tests/artifacts/server/retention.integration.test.ts",
  "tests/artifacts/server/service.integration.test.ts",
  "tests/database/migrations.integration.test.ts",
  "tests/dependencies/service.integration.test.ts",
  "tests/design-export/import.integration.test.ts",
  "tests/designs/editor.integration.test.ts",
  "tests/exports/service.integration.test.ts",
  "tests/identity/server/workspace-schema.integration.test.ts",
  "tests/materials/imports.integration.test.ts",
  "tests/onboarding/progress.integration.test.ts",
  "tests/operations/service.integration.test.ts",
  "tests/runs/runtime.integration.test.ts",
  "tests/runs/schema.integration.test.ts",
  "tests/sheets/calculation.integration.test.ts",
  "tests/sources/adapters.integration.test.ts",
  "tests/sources/recognition.integration.test.ts",
  "tests/sources/service.integration.test.ts",
  "tests/sources/visual-assets.integration.test.ts",
  "tests/workspace/project-views.integration.test.ts",
  "tests/workspace/first-result.integration.test.ts",
  "tests/workspace/project.integration.test.ts",
];
const identityHttpFiles = [
  "tests/identity/server/lifecycle.integration.test.ts",
  "tests/identity/server/team.integration.test.ts",
];
const artifactHttpFiles = ["tests/artifacts/server/http.integration.test.ts"];
const workspaceHttpFiles = [
  "tests/contracts/identity-routes.integration.test.ts",
  "tests/foundation/http.integration.test.mjs",
  "tests/ui-contracts/http.integration.test.ts",
];
const demoHttpFiles = ["tests/demo/http.integration.test.ts"];
const sourceHttpFiles = ["tests/sources/http.integration.test.ts"];
const sheetHttpFiles = ["tests/sheets/http.integration.test.ts"];
const materialHttpFiles = ["tests/materials/http.integration.test.ts"];
const productHttpFiles = [...artifactHttpFiles, ...workspaceHttpFiles, ...demoHttpFiles, ...sourceHttpFiles, ...sheetHttpFiles, ...materialHttpFiles];
const runtimeHttpFiles = ["tests/runs/http.integration.test.ts"];
const httpFiles = [...identityHttpFiles, ...productHttpFiles, ...runtimeHttpFiles];
const partition = [...databaseFiles, ...httpFiles];
const discovered = readdirSync(new URL("./tests/", import.meta.url), { recursive: true })
  .filter((file): file is string => typeof file === "string" && /\.integration\.test\.(?:ts|mjs)$/.test(file))
  .map((file) => `tests/${file.replaceAll("\\", "/")}`);
if (new Set(partition).size !== partition.length || partition.length !== discovered.length
  || discovered.some((file) => !partition.includes(file))) {
  throw new Error(`INVALID_INTEGRATION_PARTITION: unclassified=${discovered.filter((file) => !partition.includes(file)).join(",")}; missing=${partition.filter((file) => !discovered.includes(file)).join(",")}`);
}
const phase = process.env.TIRLIK_INTEGRATION_PHASE;
if (phase && !["database", "http", "http-identity", "http-artifacts", "http-workspace", "http-demo", "http-sources", "http-sheets", "http-materials", "http-product", "http-runtime"].includes(phase)) throw new Error("INVALID_INTEGRATION_PHASE");
const includedFiles = phase === "database" ? databaseFiles : phase === "http-identity" ? identityHttpFiles
  : phase === "http-artifacts" ? artifactHttpFiles : phase === "http-workspace" ? workspaceHttpFiles : phase === "http-demo" ? demoHttpFiles : phase === "http-sources" ? sourceHttpFiles
  : phase === "http-sheets" ? sheetHttpFiles
  : phase === "http-materials" ? materialHttpFiles
  : phase === "http-product" ? productHttpFiles : phase === "http-runtime" ? runtimeHttpFiles : phase === "http" ? httpFiles : partition;

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: includedFiles,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
