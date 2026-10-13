import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNodeVersion, assertOwnedDatabaseUrl, createRedactor, loadEnvironment, localDatabaseUrl, parsePort, projectIdentity } from "../../scripts/dev/environment.mjs";

const directories = [];

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tirlik-foundation-env-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local environment", () => {
  it("uses explicit shell values and Next environment-file precedence without rewriting files", async () => {
    const root = await fixture();
    const original = "SHARED=base\nOPENROUTER_API_KEY=fixture-secret\nMODEL=base-model\n";
    await writeFile(path.join(root, ".env"), original);
    await writeFile(path.join(root, ".env.development"), "SHARED=development\nMODEL=development-model\n");
    await writeFile(path.join(root, ".env.local"), "SHARED=local\n");
    await writeFile(path.join(root, ".env.development.local"), "SHARED=development-local\n");
    const inherited = { MODEL: "shell-model" };
    const env = await loadEnvironment(root, { inherited });
    expect(env).toMatchObject({ SHARED: "development-local", MODEL: "shell-model", OPENROUTER_API_KEY: "fixture-secret" });
    expect(inherited).toEqual({ MODEL: "shell-model" });
    expect(await readFile(path.join(root, ".env"), "utf8")).toBe(original);
  });

  it("excludes developer-local overrides from test mode and accepts absent optional keys", async () => {
    const root = await fixture();
    await writeFile(path.join(root, ".env.local"), "DATABASE_URL=developer-database\n");
    await writeFile(path.join(root, ".env.test"), "MODE=test\n");
    expect(await loadEnvironment(root, { mode: "test", inherited: {} })).toEqual({ MODE: "test" });
  });

  it("redacts literal and URL-encoded secrets while retaining diagnostic names", () => {
    const redact = createRedactor({ OPENROUTER_API_KEY: "fixture/key?secret", DATABASE_URL: "postgresql://alice:secret@db.example/private" });
    const message = redact("OPENROUTER_API_KEY fixture/key?secret fixture%2Fkey%3Fsecret postgresql://alice:secret@db.example/private");
    expect(message).toBe("OPENROUTER_API_KEY [redacted:OPENROUTER_API_KEY] [redacted:OPENROUTER_API_KEY] [redacted:DATABASE_URL]");
    expect(redact("postgresql://somebody:unlisted-password@127.0.0.1:5432/db")).not.toContain("unlisted-password");
  });

  it.each(["20.19.0", "22.12.9", "23.0.0", "24.1.0", "22.bad.0"])("rejects unsupported Node %s", (version) => {
    expect(() => assertNodeVersion(version)).toThrow();
  });

  it("accepts the pinned LTS line and rejects partial or coerced port values", () => {
    expect(() => assertNodeVersion("22.13.0")).not.toThrow();
    expect(() => assertNodeVersion("22.22.1")).not.toThrow();
    expect(parsePort(undefined, "APP_PORT", 3000)).toBe(3000);
    for (const value of ["3000junk", "1e4", "-1", "0", "80", "65536", " 3000", "3.5"]) {
      expect(() => parsePort(value, "APP_PORT")).toThrow(/APP_PORT/);
    }
  });

  it("derives a stable Compose project from the canonical root", async () => {
    const first = await fixture();
    const second = await fixture();
    const a = await projectIdentity(first);
    expect(await projectIdentity(path.join(first, "."))).toEqual(a);
    expect((await projectIdentity(second)).composeProject).not.toEqual(a.composeProject);
    expect(a.composeProject).toMatch(/^tirlik-[a-f0-9]{12}$/);
  });
});

describe("database target protection", () => {
  it("constructs only the owned local target and normalizes a loopback alias", () => {
    expect(assertOwnedDatabaseUrl(undefined, 54329)).toBe(localDatabaseUrl(54329));
    expect(assertOwnedDatabaseUrl("postgres://tirlik:tirlik_local@localhost:54329/tirlik", 54329)).toBe(localDatabaseUrl(54329));
  });

  it.each([
    "postgresql://tirlik:tirlik_local@remote.example:54329/tirlik",
    "postgresql://tirlik:tirlik_local@127.0.0.1:5432/tirlik",
    "postgresql://tirlik:tirlik_local@127.0.0.1:54329/another_database",
    "postgresql://someone:password@127.0.0.1:54329/tirlik",
    "postgresql://tirlik:tirlik_local@127.0.0.1:54329/tirlik?options=-csearch_path%3Dprivate",
    "https://tirlik:tirlik_local@127.0.0.1:54329/tirlik",
    "not-a-url-secret",
  ])("refuses a target outside the owned local database without echoing it", (url) => {
    let error;
    try { assertOwnedDatabaseUrl(url, 54329); } catch (caught) { error = caught; }
    expect(error).toBeDefined();
    expect(error.message).not.toContain(url);
  });
});
