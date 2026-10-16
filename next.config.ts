import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const configId = createHash("sha256").update(distDir).digest("hex").slice(0, 12);
if (!process.env.VERCEL_DEPLOYMENT_ID) {
  process.env.WORKFLOW_TARGET_WORLD ??= "local";
  process.env.WORKFLOW_LOCAL_DATA_DIR ??= path.join(process.cwd(), ".local-data", "workflow", configId);
}
const generatedDirectory = path.join(process.cwd(), ".local-data", "tsconfig");
const generatedConfig = path.join(generatedDirectory, `${configId}.json`);
mkdirSync(generatedDirectory, { recursive: true });
// Next extends its type includes at runtime; isolated runs must not rewrite the source tsconfig.
writeFileSync(generatedConfig, JSON.stringify({
  extends: "../../tsconfig.json",
  include: ["../../next-env.d.ts", "../../src/**/*.ts", "../../src/**/*.tsx",
    `../../${distDir}/types/**/*.ts`, `../../${distDir}/dev/types/**/*.ts`],
  exclude: ["../../node_modules"],
}, null, 2));

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { globalNotFound: true },
  serverExternalPackages: ["pg", "@napi-rs/canvas", "pdfkit"],
  distDir,
  typescript: { tsconfigPath: path.relative(process.cwd(), generatedConfig) },
};

export default withWorkflow(config);
