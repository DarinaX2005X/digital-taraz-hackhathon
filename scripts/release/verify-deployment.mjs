import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultStatePath = path.join(root, ".local-data", "release", "deployment-smoke.json");
const stateVersion = 1;
const sourceByteSize = 6_350_000;
const r2TokenPrefix = "r2.v1.";

const usage = `Usage:
  node scripts/release/verify-deployment.mjs prepare --origin https://example.com [--state <path>] [--expect-missing-model]
  node scripts/release/verify-deployment.mjs verify [--origin https://example.com] [--state <path>]
  node scripts/release/verify-deployment.mjs cleanup [--origin https://example.com] [--state <path>]

prepare creates a private synthetic account and a 6.35 MB direct-R2 source, applies a manual edit, renders DOCX/PDF, and saves credentials only in the ignored state file. Deploy or restart the same release, then use verify to prove persistence. cleanup tombstones only the synthetic account and removes the local state file.`;

function fail(code, detail = "") {
  throw new Error(detail ? `${code}:${detail}` : code);
}

export function deploymentOrigin(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { fail("DEPLOYMENT_ORIGIN_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname) fail("DEPLOYMENT_ORIGIN_INVALID");
  if (!/^\/$/.test(parsed.pathname)) fail("DEPLOYMENT_ORIGIN_INVALID");
  return parsed.origin;
}

export function deploymentSourceBytes(size = sourceByteSize) {
  if (!Number.isSafeInteger(size) || size < 128 || size > 20 * 1024 * 1024) fail("DEPLOYMENT_SOURCE_SIZE_INVALID");
  const prefix = Buffer.from("Tirlik deployment persistence proof\n", "utf8");
  const suffix = Buffer.from("\nEND Tirlik deployment persistence proof\n", "utf8");
  const bytes = Buffer.alloc(size, 0x78);
  prefix.copy(bytes, 0);
  suffix.copy(bytes, bytes.length - suffix.length);
  return bytes;
}

export function decodeDirectUploadTarget(token) {
  if (typeof token !== "string" || !token.startsWith(r2TokenPrefix)) fail("DEPLOYMENT_R2_TOKEN_MISSING");
  try {
    const encoded = token.slice(r2TokenPrefix.length);
    if (!encoded || encoded.length > 8_192) fail("DEPLOYMENT_R2_TOKEN_INVALID");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const target = new URL(payload.url);
    if (target.protocol !== "https:" || target.username || target.password
      || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(target.hostname)
      || !target.pathname.includes("/") || !target.searchParams.has("X-Amz-Signature")) fail("DEPLOYMENT_R2_TOKEN_INVALID");
    return target.toString();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DEPLOYMENT_R2_")) throw error;
    fail("DEPLOYMENT_R2_TOKEN_INVALID");
  }
}

export function deploymentArguments(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { help: true };
  const [action, ...rest] = args;
  if (!["prepare", "verify", "cleanup"].includes(action ?? "")) fail("DEPLOYMENT_ACTION_INVALID");
  let origin, statePath = defaultStatePath, expectMissingModel = false, stateSelected = false;
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === "--expect-missing-model") { if (expectMissingModel) fail("DEPLOYMENT_OPTION_DUPLICATE"); expectMissingModel = true; continue; }
    if (!["--origin", "--state"].includes(item)) fail("DEPLOYMENT_OPTION_INVALID", item);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail("DEPLOYMENT_OPTION_MISSING", item);
    index += 1;
    if (item === "--origin") { if (origin) fail("DEPLOYMENT_OPTION_DUPLICATE", item); origin = deploymentOrigin(value); }
    else { if (stateSelected) fail("DEPLOYMENT_OPTION_DUPLICATE", item); stateSelected = true; statePath = path.resolve(root, value); }
  }
  if (action === "prepare" && !origin) fail("DEPLOYMENT_ORIGIN_REQUIRED");
  if (action !== "prepare" && expectMissingModel) fail("DEPLOYMENT_OPTION_INVALID", "--expect-missing-model");
  return { help: false, action, origin, statePath, expectMissingModel };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function hashJson(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function assertSafeStatePath(statePath, allowMissing) {
  const parent = path.dirname(statePath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const canonicalParent = await realpath(parent);
  const resolved = path.resolve(statePath);
  if (path.dirname(resolved) !== canonicalParent || path.basename(resolved) !== path.basename(statePath)) fail("DEPLOYMENT_STATE_PATH_UNSAFE");
  const info = await lstat(resolved).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (!info) { if (!allowMissing) fail("DEPLOYMENT_STATE_MISSING"); return resolved; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) fail("DEPLOYMENT_STATE_PATH_UNSAFE");
  return resolved;
}

async function writeState(statePath, state, { create = false } = {}) {
  const target = await assertSafeStatePath(statePath, true);
  if (create) {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    return;
  }
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
}

async function readState(statePath) {
  const target = await assertSafeStatePath(statePath, false);
  let state;
  try { state = JSON.parse(await readFile(target, "utf8")); } catch { fail("DEPLOYMENT_STATE_INVALID"); }
  if (state?.version !== stateVersion || typeof state.origin !== "string" || typeof state.email !== "string" || typeof state.password !== "string" || typeof state.stage !== "string") fail("DEPLOYMENT_STATE_INVALID");
  if (deploymentOrigin(state.origin) !== state.origin) fail("DEPLOYMENT_STATE_INVALID");
  return { target, state };
}

class HttpClient {
  constructor(origin) { this.origin = origin; this.cookies = new Map(); this.userId = undefined; }
  async request(pathname, method = "GET", body, extra = {}) {
    const headers = new Headers(extra);
    if (method !== "GET") {
      if (!headers.has("origin")) headers.set("origin", this.origin);
      if (!headers.has("content-type") && body !== undefined) headers.set("content-type", body instanceof Uint8Array ? "application/octet-stream" : "application/json");
    }
    if (this.userId && !headers.has("x-tirlik-user-id")) headers.set("x-tirlik-user-id", this.userId);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${this.origin}${pathname}`, {
      method, headers, redirect: "manual",
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    for (const serialized of response.headers.getSetCookie()) {
      const pair = serialized.split(";", 1)[0], split = pair.indexOf("=");
      if (split < 1) continue;
      const name = pair.slice(0, split), value = pair.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}

async function json(response, expected, label) {
  const text = await response.text();
  if (!expected.includes(response.status)) fail(`DEPLOYMENT_${label}_HTTP_${response.status}`, text.slice(0, 500));
  try { return JSON.parse(text); } catch { fail(`DEPLOYMENT_${label}_INVALID_JSON`); }
}

async function bytes(response, expected, label) {
  if (!expected.includes(response.status)) fail(`DEPLOYMENT_${label}_HTTP_${response.status}`, (await response.text()).slice(0, 500));
  return Buffer.from(await response.arrayBuffer());
}

async function assertHealth(client) {
  const response = await client.request("/api/health");
  if (response.status !== 200) fail("DEPLOYMENT_HEALTH_FAILED", String(response.status));
}

async function signIn(state) {
  const client = new HttpClient(state.origin);
  await json(await client.request("/api/auth/sign-in/email", "POST", { email: state.email, password: state.password }), [200], "SIGN_IN");
  const viewer = await json(await client.request("/api/identity/me"), [200], "VIEWER");
  if (state.userId && viewer.user?.id !== state.userId) fail("DEPLOYMENT_ACTOR_CHANGED");
  client.userId = viewer.user.id;
  return { client, viewer };
}

async function waitForMissingModel(client, runId) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    last = await json(await client.request(`/api/runs/${runId}`), [200], "RUN_READ");
    if (last.failure === "configuration" && ["waiting_input", "failed"].includes(last.state)) return last;
    if (last.failure && last.failure !== "configuration") fail("DEPLOYMENT_MODEL_FAILURE", last.failure);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  fail("DEPLOYMENT_MISSING_MODEL_TIMEOUT", `${last?.state ?? "unknown"}:${last?.failure ?? "none"}`);
}

async function prepare(options) {
  await assertSafeStatePath(options.statePath, true);
  if (await stat(options.statePath).catch((error) => { if (error.code === "ENOENT") return null; throw error; })) fail("DEPLOYMENT_STATE_EXISTS");
  const client = new HttpClient(options.origin);
  await assertHealth(client);
  const email = `deployment-${randomUUID()}@example.test`;
  const password = `Tirlik-${randomBytes(24).toString("base64url")}!`;
  await json(await client.request("/api/auth/sign-up/email", "POST", { email, password, name: "Tirlik deployment verification", locale: "ru" }), [200], "SIGN_UP");
  const state = { version: stateVersion, stage: "account", origin: options.origin, createdAt: new Date().toISOString(), email, password, userId: null, expectMissingModel: options.expectMissingModel };
  await writeState(options.statePath, state, { create: true });
  try {
    const viewer = await json(await client.request("/api/identity/me"), [200], "VIEWER");
    client.userId = viewer.user.id;
    state.userId = viewer.user.id;
    await writeState(options.statePath, state);
    const workspace = (await json(await client.request("/api/identity/workspaces", "POST", { name: "Tirlik deployment verification" }, { "idempotency-key": randomUUID() }), [201], "WORKSPACE_CREATE")).workspace;
    const project = (await json(await client.request("/api/projects", "POST", { workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion, title: "Deployment persistence proof", goal: "Verify durable hosted inputs and editable outputs" }, { "idempotency-key": randomUUID() }), [201], "PROJECT_CREATE")).project;
    Object.assign(state, { stage: "project", workspaceId: workspace.workspaceId, workspaceName: workspace.name ?? "Tirlik deployment verification", projectId: project.id });
    await writeState(options.statePath, state);

    const source = deploymentSourceBytes(), sourceHash = createHash("sha256").update(source).digest("hex");
    const initialized = await json(await client.request("/api/sources/uploads/init", "POST", { workspaceId: state.workspaceId, projectId: state.projectId, title: "Large deployment proof", fileName: "deployment-proof.txt", format: "text", size: source.length }, { "idempotency-key": randomUUID() }), [201], "SOURCE_INIT");
    const target = decodeDirectUploadTarget(initialized.token);
    const direct = await fetch(target, { method: "PUT", headers: { Origin: state.origin, "Content-Type": "application/octet-stream", "If-None-Match": "*" }, body: source, credentials: "omit", redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if (direct.status !== 200 || direct.headers.get("access-control-allow-origin") !== state.origin
      || !direct.headers.get("etag") || !/\betag\b/i.test(direct.headers.get("access-control-expose-headers") ?? "")) fail("DEPLOYMENT_DIRECT_R2_FAILED", String(direct.status));
    const uploadQuery = `workspaceId=${state.workspaceId}`;
    const committed = await json(await client.request(`/api/sources/uploads/${initialized.upload.id}?${uploadQuery}`, "PUT", undefined, { "x-upload-token": initialized.token }), [200], "SOURCE_COMMIT");
    if (committed.upload?.status !== "uploaded" || committed.upload.byteHash !== sourceHash || committed.upload.byteSize !== source.length) fail("DEPLOYMENT_SOURCE_COMMIT_INVALID");
    const ready = (await json(await client.request(`/api/sources/uploads/${initialized.upload.id}/finalize`, "POST", { workspaceId: state.workspaceId }), [200], "SOURCE_FINALIZE")).upload;
    if (ready.status !== "ready" || ready.byteHash !== sourceHash || ready.manifest?.byteHash !== sourceHash || ready.manifest.fragmentCount < 2) fail("DEPLOYMENT_SOURCE_NOT_READY");
    const original = await bytes(await client.request(`/api/sources/${ready.sourceId}/original?${uploadQuery}&uploadId=${ready.id}`), [200], "SOURCE_DOWNLOAD");
    if (original.length !== source.length || createHash("sha256").update(original).digest("hex") !== sourceHash) fail("DEPLOYMENT_SOURCE_BYTES_CHANGED");
    Object.assign(state, { stage: "source", sourceId: ready.sourceId, sourceVersionId: ready.versionId, uploadId: ready.id, sourceHash, sourceBytes: source.length });
    await writeState(options.statePath, state);

    const originalParagraph = { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Deployment draft." }] };
    const content = { kind: "document", schemaVersion: 1, document: { type: "doc", attrs: { id: "root" }, content: [originalParagraph] } };
    const artifact = await json(await client.request("/api/artifacts", "POST", { workspaceId: state.workspaceId, projectId: state.projectId, expectedAuthzVersion: workspace.authzVersion, title: "Deployment proof document", content, sourceRefs: [{ sourceId: state.sourceId, sourceVersionId: state.sourceVersionId, revision: 1 }] }, { "idempotency-key": randomUUID() }), [201], "ARTIFACT_CREATE");
    const artifactUrl = `/api/artifacts/${artifact.artifact.id}?workspaceId=${state.workspaceId}`;
    const initial = await json(await client.request(artifactUrl), [200], "ARTIFACT_READ");
    const expectedText = "Saved manual edit after direct R2 upload.";
    const changedParagraph = { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: expectedText }] };
    const targetHash = hashJson({ targetId: "p1", targetProperty: null, kind: "document-node", value: originalParagraph, binding: null, lock: null, location: { parentId: "root", position: 0 } });
    const commandGroupId = randomUUID();
    await json(await client.request("/api/artifacts/commands", "POST", { workspaceId: state.workspaceId, expectedAuthzVersion: initial.viewer.authzVersion, group: { commandGroupId, expectedArtifactRevisions: { [artifact.artifact.id]: 0 }, expectedSourceRevisions: { [state.sourceId]: 1 }, commands: [{ commandId: randomUUID(), artifactId: artifact.artifact.id, baseRevision: 0, kind: "document", operations: [{ targetId: "p1", op: "set", beforeHash: targetHash, value: changedParagraph }], expectedSourceRevisions: { [state.sourceId]: 1 }, reason: "Deployment verification manual edit" }] } }, { "idempotency-key": commandGroupId }), [200], "ARTIFACT_EDIT");
    const changed = await json(await client.request(artifactUrl), [200], "ARTIFACT_CHANGED");
    if (changed.artifact.currentRevision !== 1 || changed.content.document.content[0]?.content?.[0]?.text !== expectedText) fail("DEPLOYMENT_ARTIFACT_EDIT_MISSING");

    const job = await json(await client.request("/api/exports", "POST", { workspaceId: state.workspaceId, expectedAuthzVersion: changed.viewer.authzVersion, locale: "ru", items: [{ artifactId: artifact.artifact.id, revision: 1, formats: ["docx", "pdf"] }] }, { "idempotency-key": randomUUID() }), [201], "EXPORT_CREATE");
    const rendered = await json(await client.request(`/api/exports/${job.id}/render`, "POST", { workspaceId: state.workspaceId, expectedAuthzVersion: changed.viewer.authzVersion }), [200], "EXPORT_RENDER");
    if (rendered.status !== "ready") fail("DEPLOYMENT_EXPORT_NOT_READY", rendered.status);
    const docx = rendered.files.find((file) => file.format === "docx"), pdf = rendered.files.find((file) => file.format === "pdf");
    if (!docx || !pdf) fail("DEPLOYMENT_EXPORT_FILES_MISSING");
    const docxBytes = await bytes(await client.request(`/api/exports/${job.id}/files/${docx.id}?workspaceId=${state.workspaceId}`), [200], "DOCX_DOWNLOAD");
    const pdfBytes = await bytes(await client.request(`/api/exports/${job.id}/files/${pdf.id}?workspaceId=${state.workspaceId}`), [200], "PDF_DOWNLOAD");
    if (!docxBytes.subarray(0, 2).equals(Buffer.from("PK")) || pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") fail("DEPLOYMENT_EXPORT_SIGNATURE_INVALID");
    Object.assign(state, { stage: "artifact", artifactId: artifact.artifact.id, expectedText, exportJobId: job.id, docxFileId: docx.id, pdfFileId: pdf.id });
    await writeState(options.statePath, state);

    if (options.expectMissingModel) {
      const run = await json(await client.request("/api/runs", "POST", { workspaceId: state.workspaceId, projectId: state.projectId, capabilityId: "business.goal", capabilityVersion: 1, goal: "Verify the hosted missing-model state", locale: "ru", inputRefs: [{ kind: "source", id: state.sourceId, revision: 1 }] }, { "idempotency-key": randomUUID() }), [201, 202], "RUN_CREATE");
      await waitForMissingModel(client, run.id);
      state.runId = run.id;
    }
    state.stage = "ready";
    state.preparedAt = new Date().toISOString();
    await writeState(options.statePath, state);
    console.log(`PASS prepare: health, database, ${source.length}-byte direct R2 upload/read, manual edit, DOCX/PDF${options.expectMissingModel ? ", and missing-model state" : ""}.`);
    console.log(`State saved privately at ${options.statePath}. Deploy or restart the same release, then run verify with this state file.`);
  } catch (error) {
    console.error(`Preparation stopped; recovery state is preserved at ${options.statePath}. Run cleanup after inspecting the failure.`);
    throw error;
  }
}

async function verify(options) {
  const { state } = await readState(options.statePath);
  if (options.origin && options.origin !== state.origin) fail("DEPLOYMENT_ORIGIN_CHANGED");
  if (state.stage !== "ready") fail("DEPLOYMENT_STATE_INCOMPLETE", state.stage);
  const { client, viewer } = await signIn(state);
  await assertHealth(client);
  if (!viewer.workspaces.some((workspace) => workspace.workspaceId === state.workspaceId)) fail("DEPLOYMENT_WORKSPACE_NOT_REOPENED");
  const project = await json(await client.request(`/api/projects/${state.projectId}?workspaceId=${state.workspaceId}`), [200], "PROJECT_REOPEN");
  if (project.project?.id !== state.projectId) fail("DEPLOYMENT_PROJECT_NOT_REOPENED");
  const artifact = await json(await client.request(`/api/artifacts/${state.artifactId}?workspaceId=${state.workspaceId}`), [200], "ARTIFACT_REOPEN");
  if (artifact.artifact.currentRevision !== 1 || artifact.content.document.content[0]?.content?.[0]?.text !== state.expectedText) fail("DEPLOYMENT_ARTIFACT_NOT_REOPENED");
  const original = await bytes(await client.request(`/api/sources/${state.sourceId}/original?workspaceId=${state.workspaceId}&uploadId=${state.uploadId}`), [200], "SOURCE_REOPEN");
  if (original.length !== state.sourceBytes || createHash("sha256").update(original).digest("hex") !== state.sourceHash) fail("DEPLOYMENT_SOURCE_NOT_REOPENED");
  const job = await json(await client.request(`/api/exports/${state.exportJobId}?workspaceId=${state.workspaceId}`), [200], "EXPORT_REOPEN");
  if (job.status !== "ready") fail("DEPLOYMENT_EXPORT_NOT_REOPENED");
  const docx = await bytes(await client.request(`/api/exports/${state.exportJobId}/files/${state.docxFileId}?workspaceId=${state.workspaceId}`), [200], "DOCX_REOPEN");
  const pdf = await bytes(await client.request(`/api/exports/${state.exportJobId}/files/${state.pdfFileId}?workspaceId=${state.workspaceId}`), [200], "PDF_REOPEN");
  if (!docx.subarray(0, 2).equals(Buffer.from("PK")) || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") fail("DEPLOYMENT_EXPORT_SIGNATURE_INVALID");
  if (state.expectMissingModel) await waitForMissingModel(client, state.runId);
  state.verifiedAt = new Date().toISOString();
  await writeState(options.statePath, state);
  console.log(`PASS verify: the saved project, ${state.sourceBytes}-byte source, manual edit, exports${state.expectMissingModel ? ", and missing-model state" : ""} survived a fresh authenticated session.`);
}

async function cleanup(options) {
  const { target, state } = await readState(options.statePath);
  if (options.origin && options.origin !== state.origin) fail("DEPLOYMENT_ORIGIN_CHANGED");
  const { client } = await signIn(state);
  const preview = await json(await client.request("/api/identity/account/deletion"), [200], "DELETION_PREVIEW");
  const workspaces = preview.ownedWorkspaces.map((workspace) => ({ workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion, action: "delete", confirmationName: workspace.name }));
  await json(await client.request("/api/identity/account/deletion", "POST", { password: state.password, confirmation: "DELETE_ACCOUNT", workspaces }, { "idempotency-key": randomUUID() }), [200], "ACCOUNT_DELETE");
  await rm(target, { force: false });
  console.log("PASS cleanup: the synthetic account and its owned workspaces entered the normal deletion-retention flow; the local credential state was removed.");
}

export async function main(args = process.argv.slice(2)) {
  const options = deploymentArguments(args);
  if (options.help) { console.log(usage); return; }
  if (options.action === "prepare") await prepare(options);
  else if (options.action === "verify") await verify(options);
  else await cleanup(options);
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invoked) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
