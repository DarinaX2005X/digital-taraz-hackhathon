import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { CliError } from "./errors.mjs";

export function assertNodeVersion(version = process.versions.node) {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new CliError("NODE_VERSION_INVALID", "The Node.js version is invalid.", "Use Node.js 22.13 or newer in the 22.x LTS line.");
  }
  if (parts[0] !== 22 || parts[1] < 13) {
    throw new CliError("NODE_VERSION_UNSUPPORTED", "This project requires Node.js 22.13 or newer in the 22.x LTS line.", "Install Node.js 22 LTS, reopen the terminal, and retry.");
  }
}

export async function loadEnvironment(root, { mode = "development", inherited = process.env } = {}) {
  if (!["development", "test", "production"].includes(mode)) {
    throw new CliError("ENV_MODE_INVALID", "Unsupported environment mode.", "Use development, test, or production.");
  }
  // Match Next's precedence; test runs must not inherit a developer's .env.local.
  const files = [`.env.${mode}.local`, ...(mode === "test" ? [] : [".env.local"]), `.env.${mode}`, ".env"];
  const env = { ...inherited };
  for (const file of files) {
    let source;
    try {
      source = await readFile(path.join(root, file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new CliError("ENV_READ_FAILED", `Cannot read ${file}.`, "Check the file permissions and retry.");
    }
    let parsed;
    try {
      parsed = parseEnv(source);
    } catch {
      throw new CliError("ENV_PARSE_FAILED", `Cannot parse ${file}.`, "Check its KEY=value entries without sharing secret values.");
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (env[name] === undefined) env[name] = value;
    }
  }
  return env;
}

export function createRedactor(env = {}) {
  const replacements = [];
  for (const [name, value] of Object.entries(env)) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|DATABASE_URL|SMTP_URL|CONNECTION_STRING)/i.test(name) || typeof value !== "string" || value.length === 0) continue;
    for (const text of new Set([value, encodeURIComponent(value)])) {
      replacements.push({ text, label: `[redacted:${name}]` });
    }
  }
  replacements.sort((a, b) => b.text.length - a.text.length);
  return (text) => {
    let safe = String(text);
    for (const replacement of replacements) safe = safe.split(replacement.text).join(replacement.label);
    return safe.replace(/\b(postgres(?:ql)?|https?|smtp(?:s)?):\/\/[^\s/@]+:[^\s/@]+@/gi, "$1://[redacted]@");
  };
}

export function parsePort(value, name, fallback) {
  const selected = value === undefined || value === "" ? fallback : value;
  if (!/^[0-9]+$/.test(String(selected)) || !Number.isSafeInteger(Number(selected)) || Number(selected) < 1024 || Number(selected) > 65535) {
    throw new CliError("PORT_INVALID", `${name} must be an integer between 1024 and 65535.`, `Correct ${name} and retry.`);
  }
  return Number(selected);
}

export async function projectIdentity(root) {
  const canonicalRoot = await realpath(root);
  const normalized = process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
  const id = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return { root: canonicalRoot, id, composeProject: `tirlik-${id}` };
}

export function localDatabaseUrl(port) {
  return `postgresql://tirlik:tirlik_local@127.0.0.1:${parsePort(port, "TIRLIK_DB_PORT")}/tirlik`;
}

export function assertOwnedDatabaseUrl(configured, port) {
  const expected = new URL(localDatabaseUrl(port));
  if (!configured) return expected.href;
  let actual;
  try {
    actual = new URL(configured);
  } catch {
    throw new CliError("DATABASE_URL_INVALID", "DATABASE_URL is not a valid PostgreSQL URL.", "Use the local Compose database for this command.");
  }
  const matches = ["postgres:", "postgresql:"].includes(actual.protocol)
    && ["127.0.0.1", "localhost", "[::1]"].includes(actual.hostname)
    && actual.port === expected.port
    && actual.pathname === expected.pathname
    && actual.username === expected.username
    && actual.password === expected.password
    && !actual.search
    && !actual.hash;
  if (!matches) {
    throw new CliError("DATABASE_NOT_LOCAL_COMPOSE", "This command only migrates and seeds its own local Compose database.", "Remove the DATABASE_URL override for local startup. Use a separately configured deployment command for another database.");
  }
  return expected.href;
}
