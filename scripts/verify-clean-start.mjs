import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, cp, lstat, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedRoots = new Set([".codex", ".git", ".local-data", ".next", ".swc", ".vercel", ".vibemachina", "coverage", "node_modules", "out"]);
const temporaryPrefix = "tirlik-clean-start-";

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.replaceAll("\\", "/").toLowerCase() : resolved;
}

export function cleanCopyExclusionReason(relativePath) {
  const relative = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!relative) return null;
  const first = relative.split("/", 1)[0];
  if (excludedRoots.has(first)) return `generated-or-private:${first}`;
  const name = path.posix.basename(relative);
  if (/^\.env(?:\..*)?$/.test(name) && name !== ".env.example") return "private-environment";
  if (name.endsWith(".log")) return "log";
  if (name.endsWith(".tsbuildinfo")) return "compiler-cache";
  return null;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function hashJson(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function cleanVerificationEnvironment(inherited, { copyRoot, ports }) {
  const env = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (typeof value !== "string") continue;
    if (/^(?:DATABASE_URL|NODE_ENV|NEXT_|OPENROUTER_|BETTER_AUTH_|SMTP_|BREVO_|TIRLIK_|WORKFLOW_|BLOB_|R2_|VERCEL_|PREFLIGHT_)/i.test(name)) continue;
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CONNECTION_STRING|COOKIE|SESSION)/i.test(name)) continue;
    env[name] = value;
  }
  return {
    ...env,
    DATABASE_URL: "",
    NODE_ENV: "development",
    OPENROUTER_API_KEY: "",
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    BETTER_AUTH_URL: `http://127.0.0.1:${ports.app}`,
    TIRLIK_APP_PORT: String(ports.app),
    TIRLIK_DB_PORT: String(ports.database),
    TIRLIK_SMTP_PORT: String(ports.smtp),
    TIRLIK_MAIL_UI_PORT: String(ports.mail),
    TIRLIK_DATA_DIR: path.join(copyRoot, ".local-data", "files"),
    TIRLIK_STORAGE_DRIVER: "local",
    WORKFLOW_TARGET_WORLD: "local",
    WORKFLOW_LOCAL_DATA_DIR: path.join(copyRoot, ".local-data", "workflow"),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(ports.smtp),
    SMTP_FROM: "Tirlik clean verification <no-reply@tirlik.invalid>",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_REQUIRE_TLS: "false",
    BREVO_API_KEY: "",
    BREVO_SMTP_KEY: "",
    BLOB_READ_WRITE_TOKEN: "",
    R2_ACCOUNT_ID: "",
    R2_BUCKET_NAME: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    VERCEL_DEPLOYMENT_ID: "",
    VERCEL_OIDC_TOKEN: "",
    VERCEL_TOKEN: "",
  };
}

export function assertOwnedTemporaryRoot(target, temporaryRoot = os.tmpdir()) {
  const parent = normalized(path.dirname(target));
  const expectedParent = normalized(temporaryRoot);
  if (parent !== expectedParent || !path.basename(target).startsWith(temporaryPrefix)) {
    throw new Error("CLEAN_COPY_PATH_NOT_OWNED");
  }
}

async function assertNoIncludedSymlinks(root, relative = "") {
  const directory = path.join(root, relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (cleanCopyExclusionReason(child)) continue;
    const info = await lstat(path.join(root, child));
    if (info.isSymbolicLink()) throw new Error(`CLEAN_COPY_SYMLINK_UNSUPPORTED:${child}`);
    if (info.isDirectory()) await assertNoIncludedSymlinks(root, child);
  }
}

async function reservePorts(count) {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const reservation = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => resolve({ server, port: server.address().port }));
      });
      reservations.push(reservation);
    }
    const [app, database, smtp, mail] = reservations.map((item) => item.port);
    return { ports: { app, database, smtp, mail }, release: () => Promise.all(reservations.map(({ server }) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))) };
  } catch (error) {
    await Promise.allSettled(reservations.map(({ server }) => new Promise((resolve) => server.close(() => resolve()))));
    throw error;
  }
}

async function run(command, args, { cwd, env, logFile, timeoutMs, quiet = false }) {
  await appendFile(logFile, `\n$ ${command} ${args.join(" ")}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", writes = Promise.resolve();
    const collect = (chunk) => {
      const text = String(chunk);
      output += text;
      writes = writes.then(() => appendFile(logFile, text));
      if (!quiet) process.stdout.write(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", async (code, signal) => {
      clearTimeout(timer);
      try { await writes; } catch (error) { reject(error); return; }
      if (code === 0) resolve({ output });
      else reject(Object.assign(new Error(`COMMAND_FAILED:${command}:${code ?? signal}`), { output }));
    });
  });
}

class HttpClient {
  constructor(origin) { this.origin = origin; this.cookies = new Map(); this.userId = undefined; }
  async request(pathname, method = "GET", body, extra = {}) {
    const headers = new Headers(extra);
    if (method !== "GET") {
      if (!headers.has("origin")) headers.set("origin", this.origin);
      if (!headers.has("content-type")) headers.set("content-type", body instanceof Uint8Array ? "application/octet-stream" : "application/json");
    }
    if (this.userId && !headers.has("x-tirlik-user-id")) headers.set("x-tirlik-user-id", this.userId);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${this.origin}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });
    for (const serialized of response.headers.getSetCookie()) {
      const pair = serialized.split(";", 1)[0];
      const split = pair.indexOf("=");
      if (split < 1) continue;
      const name = pair.slice(0, split), value = pair.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}

async function json(response, expected, label) {
  const text = await response.text();
  if (!expected.includes(response.status)) throw new Error(`${label}:HTTP_${response.status}:${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${label}:INVALID_JSON`); }
}

async function bytes(response, expected, label) {
  if (!expected.includes(response.status)) throw new Error(`${label}:HTTP_${response.status}:${(await response.text()).slice(0, 800)}`);
  return Buffer.from(await response.arrayBuffer());
}

async function waitForMissingModel(client, runId) {
  const deadline = Date.now() + 90_000;
  let last;
  while (Date.now() < deadline) {
    last = await json(await client.request(`/api/runs/${runId}`), [200], "read missing-model run");
    if (last.failure === "configuration" && ["waiting_input", "failed"].includes(last.state)) return last;
    if (last.failure && last.failure !== "configuration") throw new Error(`UNEXPECTED_MODEL_FAILURE:${last.failure}`);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(`MISSING_MODEL_STATE_TIMEOUT:${last?.state ?? "unknown"}:${last?.failure ?? "none"}`);
}

async function exerciseProduct(origin) {
  const client = new HttpClient(origin);
  const health = await client.request("/api/health");
  if (health.status !== 200) throw new Error(`HEALTH_HTTP_${health.status}`);

  const email = `clean-${randomUUID()}@example.test`;
  await json(await client.request("/api/auth/sign-up/email", "POST", { email, password: "Clean verification password 42", name: "Clean verification", locale: "ru" }), [200], "sign up");
  const viewer = await json(await client.request("/api/identity/me"), [200], "viewer");
  client.userId = viewer.user.id;
  const workspace = (await json(await client.request("/api/identity/workspaces", "POST", { name: "Чистая проверка Tirlik" }, { "idempotency-key": randomUUID() }), [201], "workspace")).workspace;
  const project = (await json(await client.request("/api/projects", "POST", { workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion, title: "Проверка чистого запуска", goal: "Создать и сохранить редактируемый результат" }, { "idempotency-key": randomUUID() }), [201], "project")).project;

  const sourceBytes = Buffer.from("Позиция,Количество,Цена\nМонтаж,2,18000\nДоставка,1,7000\n", "utf8");
  const initialized = await json(await client.request("/api/sources/uploads/init", "POST", { workspaceId: workspace.workspaceId, projectId: project.id, title: "Исходная смета", fileName: "estimate.csv", format: "csv", size: sourceBytes.length }, { "idempotency-key": randomUUID() }), [201], "source init");
  const sourceQuery = `workspaceId=${workspace.workspaceId}`;
  await json(await client.request(`/api/sources/uploads/${initialized.upload.id}?${sourceQuery}`, "PUT", sourceBytes, { "x-upload-token": initialized.token }), [200], "source upload");
  const readySource = (await json(await client.request(`/api/sources/uploads/${initialized.upload.id}/finalize`, "POST", { workspaceId: workspace.workspaceId }), [200], "source finalize")).upload;
  if (readySource.status !== "ready" || readySource.manifest?.rowCount !== 3) throw new Error("SOURCE_NOT_READY");

  const originalParagraph = { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Черновик предложения по монтажу." }] };
  const content = { kind: "document", schemaVersion: 1, document: { type: "doc", attrs: { id: "root" }, content: [originalParagraph] } };
  const artifact = await json(await client.request("/api/artifacts", "POST", { workspaceId: workspace.workspaceId, projectId: project.id, expectedAuthzVersion: workspace.authzVersion, title: "Предложение клиенту", content, sourceRefs: [{ sourceId: readySource.sourceId, sourceVersionId: readySource.versionId, revision: 1 }] }, { "idempotency-key": randomUUID() }), [201], "artifact create");
  const artifactId = artifact.artifact.id;
  const artifactUrl = `/api/artifacts/${artifactId}?workspaceId=${workspace.workspaceId}`;
  const initial = await json(await client.request(artifactUrl), [200], "artifact read");
  const targetHash = hashJson({ targetId: "p1", targetProperty: null, kind: "document-node", value: originalParagraph, binding: null, lock: null, location: { parentId: "root", position: 0 } });
  const changedParagraph = { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Проверенное предложение: монтаж и доставка указаны отдельно." }] };
  const commandGroupId = randomUUID();
  await json(await client.request("/api/artifacts/commands", "POST", {
    workspaceId: workspace.workspaceId,
    expectedAuthzVersion: initial.viewer.authzVersion,
    group: {
      commandGroupId,
      expectedArtifactRevisions: { [artifactId]: 0 },
      expectedSourceRevisions: { [readySource.sourceId]: 1 },
      commands: [{ commandId: randomUUID(), artifactId, baseRevision: 0, kind: "document", operations: [{ targetId: "p1", op: "set", beforeHash: targetHash, value: changedParagraph }], expectedSourceRevisions: { [readySource.sourceId]: 1 }, reason: "Ручная проверка чистого запуска" }],
    },
  }, { "idempotency-key": commandGroupId }), [200], "artifact edit");
  const changed = await json(await client.request(artifactUrl), [200], "changed artifact");
  if (changed.artifact.currentRevision !== 1 || changed.content.document.content[0]?.content?.[0]?.text !== changedParagraph.content[0].text) throw new Error("ARTIFACT_EDIT_NOT_SAVED");

  const job = await json(await client.request("/api/exports", "POST", { workspaceId: workspace.workspaceId, expectedAuthzVersion: changed.viewer.authzVersion, locale: "ru", items: [{ artifactId, revision: 1, formats: ["docx", "pdf"] }] }, { "idempotency-key": randomUUID() }), [201], "export create");
  const rendered = await json(await client.request(`/api/exports/${job.id}/render`, "POST", { workspaceId: workspace.workspaceId, expectedAuthzVersion: changed.viewer.authzVersion }), [200], "export render");
  if (rendered.status !== "ready") throw new Error(`EXPORT_NOT_READY:${rendered.status}`);
  const docx = rendered.files.find((file) => file.format === "docx"), pdf = rendered.files.find((file) => file.format === "pdf");
  if (!docx || !pdf) throw new Error("EXPORT_FILES_MISSING");
  const docxBytes = await bytes(await client.request(`/api/exports/${job.id}/files/${docx.id}?workspaceId=${workspace.workspaceId}`), [200], "docx download");
  const pdfBytes = await bytes(await client.request(`/api/exports/${job.id}/files/${pdf.id}?workspaceId=${workspace.workspaceId}`), [200], "pdf download");
  if (!docxBytes.subarray(0, 2).equals(Buffer.from("PK")) || pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("EXPORT_SIGNATURE_INVALID");

  const run = await json(await client.request("/api/runs", "POST", { workspaceId: workspace.workspaceId, projectId: project.id, capabilityId: "business.goal", capabilityVersion: 1, goal: "Проверь смету и подготовь предложение", locale: "ru", inputRefs: [{ kind: "source", id: readySource.sourceId, revision: 1 }] }, { "idempotency-key": randomUUID() }), [201, 202], "missing-model run");
  await waitForMissingModel(client, run.id);
  if ((await client.request(artifactUrl)).status !== 200) throw new Error("MANUAL_WORK_BROKEN_WITHOUT_MODEL");

  return { client, workspaceId: workspace.workspaceId, projectId: project.id, artifactId, sourceId: readySource.sourceId, uploadId: readySource.id, expectedText: changedParagraph.content[0].text, exportJobId: job.id };
}

async function verifyAfterRestart(state) {
  const { client, workspaceId, projectId, artifactId, sourceId, uploadId, expectedText, exportJobId } = state;
  const project = await json(await client.request(`/api/projects/${projectId}?workspaceId=${workspaceId}`), [200], "project after restart");
  if (project.project.id !== projectId) throw new Error("PROJECT_NOT_REOPENED");
  const artifact = await json(await client.request(`/api/artifacts/${artifactId}?workspaceId=${workspaceId}`), [200], "artifact after restart");
  if (artifact.artifact.currentRevision !== 1 || artifact.content.document.content[0]?.content?.[0]?.text !== expectedText) throw new Error("ARTIFACT_NOT_REOPENED");
  const original = await bytes(await client.request(`/api/sources/${sourceId}/original?workspaceId=${workspaceId}&uploadId=${uploadId}`), [200], "source after restart");
  if (!original.toString("utf8").includes("Монтаж,2,18000")) throw new Error("SOURCE_NOT_REOPENED");
  const exportJob = await json(await client.request(`/api/exports/${exportJobId}?workspaceId=${workspaceId}`), [200], "export after restart");
  if (exportJob.status !== "ready") throw new Error("EXPORT_NOT_REOPENED");
}

async function inspectOwnedDocker(copyRoot, project, env, logFile) {
  if (!/^tirlik-[a-f0-9]{12}$/.test(project)) throw new Error("CLEAN_COMPOSE_PROJECT_INVALID");
  const listing = await run("docker", ["ps", "--all", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"], { cwd: copyRoot, env, logFile, timeoutMs: 30_000, quiet: true });
  const ids = listing.output.trim().split(/\r?\n/).filter(Boolean);
  if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("CLEAN_CONTAINER_ID_INVALID");
  if (ids.length) {
    const inspection = await run("docker", ["inspect", ...ids], { cwd: copyRoot, env, logFile, timeoutMs: 30_000, quiet: true });
    const containers = JSON.parse(inspection.output.slice(inspection.output.indexOf("[")));
    const expectedRoot = normalized(copyRoot);
    if (containers.some((container) => container.Config?.Labels?.["com.docker.compose.project"] !== project
      || normalized(container.Config?.Labels?.["com.docker.compose.project.working_dir"] ?? "") !== expectedRoot
      || !["postgres", "mailpit"].includes(container.Config?.Labels?.["com.docker.compose.service"]))) throw new Error("CLEAN_CONTAINER_OWNERSHIP_MISMATCH");
  }
  const volumes = await run("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Name}}"], { cwd: copyRoot, env, logFile, timeoutMs: 30_000, quiet: true });
  const names = volumes.output.trim().split(/\r?\n/).filter(Boolean);
  if (names.some((name) => name !== `${project}_postgres-data`)) throw new Error("CLEAN_VOLUME_OWNERSHIP_MISMATCH");
  for (const name of names) {
    const inspection = await run("docker", ["volume", "inspect", name], { cwd: copyRoot, env, logFile, timeoutMs: 30_000, quiet: true });
    const [volume] = JSON.parse(inspection.output.slice(inspection.output.indexOf("[")));
    if (volume?.Name !== name || volume?.Labels?.["com.docker.compose.project"] !== project || volume?.Labels?.["com.docker.compose.volume"] !== "postgres-data") throw new Error("CLEAN_VOLUME_OWNERSHIP_MISMATCH");
  }
}

async function composeProjectFor(copyRoot) {
  const canonical = await realpath(copyRoot);
  const identity = createHash("sha256").update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex").slice(0, 12);
  return `tirlik-${identity}`;
}

async function cleanupOwnedDocker(copyRoot, project, env, logFile) {
  await inspectOwnedDocker(copyRoot, project, env, logFile);
  await run("docker", ["compose", "--project-name", project, "--project-directory", copyRoot, "--file", path.join(copyRoot, "compose.yaml"), "down", "--volumes", "--remove-orphans", "--timeout", "10"], { cwd: copyRoot, env, logFile, timeoutMs: 90_000 });
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true, keep: false };
  if (args.length > 1 || (args.length === 1 && args[0] !== "--keep")) throw new Error("Usage: node scripts/verify-clean-start.mjs [--keep]");
  return { help: false, keep: args[0] === "--keep" };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log("Usage: node scripts/verify-clean-start.mjs [--keep]\nCopies only product source into an owned temporary directory, installs from the lockfile, starts isolated local services, exercises a saved manual workflow without an AI key, restarts, verifies persistence, and removes only verified owned resources. Use --keep to retain a successful copy for inspection.");
    return;
  }
  const tempRoot = await realpath(os.tmpdir());
  const temporary = await mkdtemp(path.join(tempRoot, temporaryPrefix));
  assertOwnedTemporaryRoot(temporary, tempRoot);
  const copyRoot = path.join(temporary, "project"), logFile = path.join(temporary, "verification.log");
  let env, project, stopNeeded = false, passed = false, failure;
  try {
    console.log(`Clean verification directory: ${temporary}`);
    await assertNoIncludedSymlinks(sourceRoot);
    await cp(sourceRoot, copyRoot, { recursive: true, filter: (source) => {
      const relative = path.relative(sourceRoot, source);
      return relative === "" || !cleanCopyExclusionReason(relative);
    } });
    if ((await stat(path.join(copyRoot, "package-lock.json"))).size < 1) throw new Error("LOCKFILE_MISSING");
    const reserved = await reservePorts(4);
    const ports = reserved.ports;
    env = cleanVerificationEnvironment(process.env, { copyRoot, ports });
    await reserved.release();
    project = await composeProjectFor(copyRoot);
    console.log("Starting from a copy without node_modules, generated caches, private environment files or VibeMachina memory...");
    stopNeeded = true;
    await run(process.execPath, ["scripts/dev/start.mjs", "--port", String(ports.app)], { cwd: copyRoot, env, logFile, timeoutMs: 900_000 });
    const origin = `http://127.0.0.1:${ports.app}`;
    console.log("Exercising account, source, manual edit, real export and missing-model behavior over HTTP...");
    const state = await exerciseProduct(origin);
    await run(process.execPath, ["scripts/dev/stop.mjs"], { cwd: copyRoot, env, logFile, timeoutMs: 60_000 });
    stopNeeded = false;
    console.log("Restarting the same isolated copy and reopening saved data...");
    stopNeeded = true;
    await run(process.execPath, ["scripts/dev/start.mjs", "--port", String(ports.app)], { cwd: copyRoot, env, logFile, timeoutMs: 300_000 });
    await verifyAfterRestart(state);
    await run(process.execPath, ["scripts/dev/stop.mjs"], { cwd: copyRoot, env, logFile, timeoutMs: 60_000 });
    stopNeeded = false;
    passed = true;
    console.log("PASS: clean install/start, manual workflow, export, missing-model state, restart and reopen were verified.");
  } catch (error) {
    failure = error;
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Preserved verification directory: ${temporary}`);
  } finally {
    if (stopNeeded && env) await run(process.execPath, ["scripts/dev/stop.mjs"], { cwd: copyRoot, env, logFile, timeoutMs: 60_000 }).catch((error) => {
      failure ??= error;
      console.error(`Owned application cleanup failed: ${error.message}`);
    });
    if (env && project) await cleanupOwnedDocker(copyRoot, project, env, logFile).catch((error) => {
      failure ??= error;
      console.error(`Owned Docker cleanup was refused or failed: ${error.message}`);
    });
    if (failure) passed = false;
    if (passed && !options.keep) {
      assertOwnedTemporaryRoot(temporary, tempRoot);
      await rm(temporary, { recursive: true, force: false });
    } else if (passed) console.log(`Retained successful verification copy: ${temporary}`);
  }
  if (failure) throw failure;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invoked) main().catch(() => { process.exitCode = 1; });
