import { spawn } from "node:child_process";
import { access, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { createRedactor } from "./environment.mjs";

export async function resolveNpmCli(env = process.env) {
  const candidates = [
    env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!/[\\/]npm-cli\.js$/.test(candidate)) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // An installation may use the next supported Node/npm directory layout.
    }
  }
  throw new CliError("NPM_UNAVAILABLE", "Cannot find npm beside the active Node.js installation.", "Install Node.js 22 with npm and reopen the terminal.");
}

export function runCommand(executable, args, { cwd, env = process.env, label = "Command", timeoutMs = 120_000, maxOutputBytes = 8 * 1024 * 1024, logFile } = {}) {
  const redact = createRedactor(env);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let spawnedError;
    const startedAt = Date.now();
    let termination;

    const terminate = () => {
      if (termination || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      if (process.platform === "win32") {
        // The live child handle was created above; never use a PID read from disk.
        termination = new Promise((done) => {
          const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
          killer.once("error", () => { child.kill(); done(); });
          killer.once("close", done);
        });
      } else {
        child.kill("SIGTERM");
        termination = Promise.resolve();
      }
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const capture = (data) => {
      bytes += data.length;
      if (bytes <= maxOutputBytes) chunks.push(data);
      else { outputExceeded = true; terminate(); }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => { spawnedError = error; });
    child.once("close", async (code) => {
      clearTimeout(timer);
      if (termination) await termination;
      const output = outputExceeded ? "[Diagnostic output omitted because it exceeded the limit.]\n" : redact(Buffer.concat(chunks).toString("utf8"));
      try {
        if (logFile) {
          await mkdir(path.dirname(logFile), { recursive: true });
          await appendFile(logFile, `\n[${label}]\n${output}`, { mode: 0o600 });
        }
      } catch {
        reject(new CliError("LOG_WRITE_FAILED", "Cannot write the local command log.", "Check .local-data directory permissions and retry."));
        return;
      }
      const result = { code, output, durationMs: Date.now() - startedAt };
      if (spawnedError) {
        reject(new CliError("COMMAND_UNAVAILABLE", `${label} could not start.`, "Check that its executable is installed and available in PATH."));
      } else if (timedOut || outputExceeded || code !== 0) {
        const error = new CliError(timedOut ? "COMMAND_TIMEOUT" : outputExceeded ? "COMMAND_OUTPUT_LIMIT" : "COMMAND_FAILED", `${label} ${timedOut ? "exceeded its time limit" : outputExceeded ? "exceeded its diagnostic output limit" : "failed"}.`, "Read the redacted diagnostic output and retry after correcting the cause.");
        error.result = result;
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

export async function runNpm(args, options = {}) {
  const cli = await resolveNpmCli(options.env);
  return runCommand(process.execPath, [cli, ...args], options);
}

export async function runPackageCheck(script, options) {
  console.log(`Checking ${script}...`);
  try {
    const result = await runNpm(["run", script], { ...options, label: script });
    console.log(`Passed ${script} (${(result.durationMs / 1000).toFixed(1)}s).`);
    return result;
  } catch (error) {
    if (error.result?.output) console.error(error.result.output);
    throw error;
  }
}
