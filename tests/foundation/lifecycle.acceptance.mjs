import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { localDatabaseUrl, loadEnvironment, projectIdentity } from "../../scripts/dev/environment.mjs";
import { readRuntime } from "../../scripts/dev/runtime.mjs";
import { runCommand } from "../../scripts/dev/process.mjs";

// Explicit acceptance command: restarts this checkout's owned local application.
// Regular integration checks use their own Compose project and do not run this file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const identity = await projectIdentity(root);
const env = await loadEnvironment(root);
const command = (name, args = []) => runCommand(process.execPath, [path.join(root, "scripts", "dev", `${name}.mjs`), ...args], { cwd: root, env, label: `Local ${name}`, timeoutMs: 240_000 });
const nonce = randomUUID().replaceAll("-", "");
const schema = `foundation_${nonce}`;
const markerId = randomUUID();
const markerValue = `saved-value-${nonce}`;
const directory = path.join(root, ".local-data", "files", `acceptance-${nonce}`);
let pool;
let foreign;
let stopped = false;
let schemaCreated = false;

try {
  await command("start");
  const first = await readRuntime(identity.root, identity.id);
  assert.equal(first.status, "ready");
  pool = new Pool({ connectionString: localDatabaseUrl(first.databasePort) });
  assert.match(schema, /^foundation_[a-f0-9]{32}$/);
  await pool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await pool.query(`CREATE TABLE ${schema}.marker (id uuid PRIMARY KEY, value text NOT NULL)`);
  await pool.query(`INSERT INTO ${schema}.marker(id, value) VALUES ($1, $2)`, [markerId, markerValue]);
  const seedBefore = await pool.query("SELECT id FROM public.demo_templates WHERE key = $1", ["tirlik-training"]);
  assert.equal(seedBefore.rowCount, 1);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "marker.json"), JSON.stringify({ id: markerId, value: markerValue }));

  await command("start");
  const duplicate = await readRuntime(identity.root, identity.id);
  assert.equal(duplicate.instanceId, first.instanceId);
  assert.equal(duplicate.appPid, first.appPid);
  await assert.rejects(command("supervisor"), (error) => error.code === "COMMAND_FAILED" && error.result.output.includes("SUPERVISOR_IDENTITY_INVALID"));
  assert.deepEqual(await readRuntime(identity.root, identity.id), duplicate);
  for (const headers of [{}, { Authorization: "Bearer wrong-token" }, { Authorization: `Bearer ${first.token}`, Origin: "https://unrelated.invalid" }]) {
    const response = await fetch(`http://127.0.0.1:${first.controlPort}/stop`, { method: "POST", headers, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 403);
    await response.body?.cancel();
  }
  console.log("Duplicate start reused the same instance; unauthorized control requests were rejected.");
  await command("stop");
  stopped = true;
  assert.equal((await readRuntime(identity.root, identity.id)).status, "stopped");

  foreign = http.createServer((request, response) => response.end("unrelated-service-still-running"));
  await new Promise((resolve, reject) => { foreign.once("error", reject); foreign.listen(first.appPort, "127.0.0.1", resolve); });
  await assert.rejects(command("start", ["--port", String(first.appPort)]), (error) => error.code === "COMMAND_FAILED" && error.result.output.includes("PORT_UNAVAILABLE"));
  assert.equal(await (await fetch(`http://127.0.0.1:${first.appPort}/`, { signal: AbortSignal.timeout(3000) })).text(), "unrelated-service-still-running");
  await command("start");
  stopped = false;
  const restarted = await readRuntime(identity.root, identity.id);
  assert.equal(restarted.status, "ready");
  assert.notEqual(restarted.instanceId, first.instanceId);
  assert.notEqual(restarted.appPort, first.appPort);
  assert.equal(restarted.databasePort, first.databasePort);
  const saved = await pool.query(`SELECT id, value FROM ${schema}.marker`);
  assert.deepEqual(saved.rows, [{ id: markerId, value: markerValue }]);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "marker.json"), "utf8")), { id: markerId, value: markerValue });
  const seedAfter = await pool.query("SELECT id FROM public.demo_templates WHERE key = $1", ["tirlik-training"]);
  assert.deepEqual(seedAfter.rows, seedBefore.rows);
  assert.equal(await (await fetch(`http://127.0.0.1:${first.appPort}/`, { signal: AbortSignal.timeout(3000) })).text(), "unrelated-service-still-running");
  console.log(JSON.stringify({
    result: "passed", markerId, persistedValue: true, persistedFile: true, seedIdPreserved: true, seedCount: seedAfter.rowCount,
    duplicateStartReusedInstance: true, unauthorizedStopRejected: true, occupiedPortOwnerPreserved: true,
    previousPort: first.appPort, currentPort: restarted.appPort, url: `http://127.0.0.1:${restarted.appPort}/`,
  }, null, 2));
} finally {
  if (foreign?.listening) await new Promise((resolve) => { foreign.close(resolve); foreign.closeAllConnections(); });
  if (pool) {
    if (schemaCreated && /^foundation_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  const expected = path.join(root, ".local-data", "files", `acceptance-${nonce}`);
  if (directory === expected && /^[a-f0-9]{32}$/.test(nonce)) await rm(directory, { recursive: true, force: true });
  if (stopped) await command("start");
}
