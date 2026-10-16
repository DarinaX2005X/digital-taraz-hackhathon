import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { assertDevVolumeOwnership, assertDockerAvailable, runCompose } from "../dev/compose.mjs";
import { CliError } from "../dev/errors.mjs";
import { createRedactor } from "../dev/environment.mjs";

function composeArgs(root, project, args) {
  if (!/^tirlik-(?:test-)?[a-f0-9]{12}(?:-[a-f0-9]{32})?$/.test(project)) {
    throw new CliError("COMPOSE_PROJECT_INVALID", "The Compose project identity is invalid.", "Run the project command from the original checkout.");
  }
  return ["compose", "--project-name", project, "--project-directory", root, "--file", path.join(root, "compose.yaml"), ...args];
}

async function binaryCompose(root, project, args, { env, input, output, label }) {
  const redact = createRedactor(env);
  const child = spawn("docker", composeArgs(root, project, args), {
    cwd: root,
    env,
    shell: false,
    windowsHide: true,
    stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "pipe"],
  });
  const diagnostics = [];
  let diagnosticBytes = 0;
  child.stderr.on("data", (chunk) => {
    diagnosticBytes += chunk.length;
    if (diagnosticBytes <= 128 * 1024) diagnostics.push(chunk);
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", () => reject(new CliError("COMMAND_UNAVAILABLE", `${label} could not start.`, "Start Docker Desktop and retry.")));
    child.once("close", (code) => resolve(code));
  });
  let stream;
  try {
    if (input) stream = pipeline(createReadStream(input), child.stdin);
    if (output) stream = pipeline(child.stdout, createWriteStream(output, { flags: "wx", mode: 0o600 }));
    const [closedResult, streamResult] = await Promise.allSettled([closed, stream ?? Promise.resolve()]);
    if (closedResult.status === "rejected") throw closedResult.reason;
    const code = closedResult.value;
    if (code !== 0) {
      const detail = diagnosticBytes > 128 * 1024 ? "Diagnostic output exceeded its safe limit." : redact(Buffer.concat(diagnostics).toString("utf8")).trim();
      const error = new CliError("POSTGRES_BACKUP_COMMAND_FAILED", `${label} failed.`, "Inspect the redacted PostgreSQL diagnostics and retry.");
      error.result = { output: detail };
      throw error;
    }
    if (streamResult.status === "rejected") throw new CliError("POSTGRES_BACKUP_STREAM_FAILED", `${label} could not transfer its archive.`, "Check available disk space and file permissions, then retry.", { cause: streamResult.reason });
  } catch (error) {
    if (output) await unlink(output).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  }
}

export async function startLocalPostgres({ root, project, env, logFile }) {
  const options = { cwd: root, env, logFile };
  await assertDockerAvailable(options);
  await assertDevVolumeOwnership(project, options);
  await runCompose(root, project, ["up", "--detach", "--wait", "--wait-timeout", "120", "postgres"], {
    ...options,
    label: "Local PostgreSQL",
    timeoutMs: 300_000,
  });
}

export function postgresDatabaseAdapter({ root, project, env, logFile }) {
  return {
    async migrationHistory() {
      const result = await runCompose(root, project, [
        "exec", "-T", "postgres", "psql", "--username=tirlik", "--dbname=tirlik", "--no-align", "--tuples-only", "--field-separator=\t",
        "--command=SELECT name, hash FROM _tirlik_migrations ORDER BY name",
      ], { cwd: root, env, logFile, label: "Migration history", timeoutMs: 30_000 });
      return result.output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, hash, ...extra] = line.split("\t");
        if (extra.length || !name || !hash) throw new CliError("BACKUP_MIGRATIONS_INVALID", "PostgreSQL returned an invalid migration row.", "Inspect _tirlik_migrations before retrying.");
        return { name, hash };
      });
    },
    async dump(output) {
      await binaryCompose(root, project, [
        "exec", "-T", "postgres", "pg_dump", "--username=tirlik", "--dbname=tirlik", "--format=custom", "--no-owner", "--no-privileges", "--serializable-deferrable",
      ], { env, output, label: "PostgreSQL backup" });
    },
    async restore(input) {
      await binaryCompose(root, project, [
        "exec", "-T", "postgres", "pg_restore", "--username=tirlik", "--dbname=tirlik", "--clean", "--if-exists", "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges",
      ], { env, input, label: "PostgreSQL restore" });
    },
  };
}
