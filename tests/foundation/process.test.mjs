import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand, resolveNpmCli } from "../../scripts/dev/process.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("command execution", () => {
  it("runs npm through Node without invoking a shell", async () => {
    expect(await resolveNpmCli()).toMatch(/npm-cli\.js$/);
    const result = await runCommand(process.execPath, ["-e", "console.log(process.argv[1])", "literal;$()&value"]);
    expect(result.output.trim()).toBe("literal;$()&value");
  });

  it("redacts secrets split across output chunks before returning and persisting diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tirlik-foundation-process-"));
    directories.push(root);
    const logFile = path.join(root, "nested", "check.log");
    const result = await runCommand(process.execPath, ["-e", "process.stdout.write('fixture-'); setTimeout(() => process.stdout.write('split-secret'), 15)"], {
      env: { ...process.env, TEST_SECRET: "fixture-split-secret" }, logFile,
    });
    expect(result.output).toBe("[redacted:TEST_SECRET]");
    expect(await readFile(logFile, "utf8")).not.toContain("fixture-split-secret");
  });

  it("reports nonzero exit codes instead of a successful skipped check", async () => {
    await expect(runCommand(process.execPath, ["-e", "console.error('expected-failure'); process.exitCode=7"], { label: "fixture-check" }))
      .rejects.toMatchObject({ code: "COMMAND_FAILED", result: { code: 7, output: "expected-failure\n" } });
  });

  it("terminates its own timed-out child and leaves an independent command running", async () => {
    const independent = runCommand(process.execPath, ["-e", "setTimeout(() => console.log('independent-ok'), 750)"], { timeoutMs: 5000 });
    await expect(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 150 }))
      .rejects.toMatchObject({ code: "COMMAND_TIMEOUT" });
    expect((await independent).output).toContain("independent-ok");
  });

  it("bounds diagnostic output and avoids persisting a truncated secret", async () => {
    await expect(runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(2048))"], { maxOutputBytes: 128 }))
      .rejects.toMatchObject({ code: "COMMAND_OUTPUT_LIMIT", result: { output: "[Diagnostic output omitted because it exceeded the limit.]\n" } });
  });

  it("returns a safe error for a missing executable", async () => {
    await expect(runCommand("tirlik-missing-command-for-test", [], { label: "Docker" }))
      .rejects.toMatchObject({ code: "COMMAND_UNAVAILABLE", message: "Docker could not start." });
  });
});
