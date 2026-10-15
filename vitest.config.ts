import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    exclude: ["tests/**/*.integration.test.{ts,mjs}", "tests/deployed/**"],
    testTimeout: 10_000,
    maxWorkers: 4,
  },
});
