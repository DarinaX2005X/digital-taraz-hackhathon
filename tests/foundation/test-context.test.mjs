import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext } from "../../scripts/dev/test-context.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("isolated integration context", () => {
  it("replaces inherited database and storage targets and isolates simultaneous runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-foundation-context-"));
    directories.push(root);
    const inherited = {
      DATABASE_URL: "postgresql://someone:secret@remote.example/production", TIRLIK_DATA_DIR: "foreign-files", NEXT_DIST_DIR: "foreign-build",
      SMTP_HOST: "smtp.remote.example", SMTP_PORT: "587", SMTP_USER: "real-user", SMTP_PASSWORD: "real-password", SMTP_FROM: "real@remote.example",
      BETTER_AUTH_URL: "https://real.example", BETTER_AUTH_SECRET: "real-auth-secret", OPENROUTER_API_KEY: "real-provider-key", BLOB_READ_WRITE_TOKEN: "real-blob-key",
      VERCEL_DEPLOYMENT_ID: "foreign-deployment", VERCEL_OIDC_TOKEN: "foreign-oidc", VERCEL_TOKEN: "foreign-token",
      WORKFLOW_TARGET_WORLD: "vercel", WORKFLOW_LOCAL_DATA_DIR: "foreign-workflow", PREFLIGHT_HOSTING_ENABLED: "1", PREFLIGHT_HOSTING_TOKEN: "foreign-preflight",
      BREVO_API_KEY: "real-brevo-api-key", BREVO_SMTP_KEY: "real-brevo-smtp-key", SMTP_REQUIRE_TLS: "true",
    };
    const first = await createTestContext(root, inherited);
    const second = await createTestContext(root, inherited);
    expect(first.composeProject).not.toBe(second.composeProject);
    expect(first.composeProject).toMatch(/^tirlik-test-[a-f0-9]{12}-[a-f0-9]{32}$/);
    expect(first.directory).not.toBe(second.directory);
    expect(first.env.DATABASE_URL).toContain(`127.0.0.1:${first.ports.database}/tirlik`);
    expect(first.env.DATABASE_URL).not.toContain("remote.example");
    expect(first.env.TIRLIK_DATA_DIR).toBe(path.join(first.directory, "files"));
    expect(first.env.NEXT_DIST_DIR).toBe(`.local-data/tests/${first.runId}/next`);
    expect(first.env.TIRLIK_TEST_NAMESPACE).toBe(first.runId);
    expect(first.env.SMTP_HOST).toBe("127.0.0.1");
    expect(first.env.SMTP_PORT).toBe(String(first.ports.smtp));
    expect(first.env.SMTP_USER).toBe("");
    expect(first.env.SMTP_PASSWORD).toBe("");
    expect(first.env.BREVO_API_KEY).toBe("");
    expect(first.env.BREVO_SMTP_KEY).toBe("");
    expect(first.env.SMTP_REQUIRE_TLS).toBe("false");
    expect(first.env.SMTP_FROM).toContain("@tirlik.invalid>");
    expect(first.env.BETTER_AUTH_URL).toBe(`http://127.0.0.1:${first.ports.app}`);
    expect(first.env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(first.env.BETTER_AUTH_SECRET).not.toBe(second.env.BETTER_AUTH_SECRET);
    expect(first.env.OPENROUTER_API_KEY).toBe("");
    expect(first.env.BLOB_READ_WRITE_TOKEN).toBe("");
    expect(first.env.VERCEL_DEPLOYMENT_ID).toBe("");
    expect(first.env.VERCEL_OIDC_TOKEN).toBe("");
    expect(first.env.VERCEL_TOKEN).toBe("");
    expect(first.env.WORKFLOW_TARGET_WORLD).toBe("local");
    expect(first.env.WORKFLOW_LOCAL_DATA_DIR).toBe(path.join(first.directory, "workflow"));
    expect(first.env.WORKFLOW_LOCAL_DATA_DIR).not.toBe(second.env.WORKFLOW_LOCAL_DATA_DIR);
    expect(first.env.PREFLIGHT_HOSTING_ENABLED).toBe("0");
    expect(first.env.PREFLIGHT_HOSTING_TOKEN).toBe("");
    expect(inherited.TIRLIK_DATA_DIR).toBe("foreign-files");
    expect(inherited.SMTP_HOST).toBe("smtp.remote.example");
  });
});
