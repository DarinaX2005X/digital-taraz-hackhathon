import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { z } from 'zod';
import { ErrorEnvelopeSchema } from '../../src/contracts/errors';
import { HostingProbeStatusSchema, probePayload, readBoundedBody, sha256, type HostingProbeStatus } from '../../src/server/preflight/contracts';

const root = new URL('../../', import.meta.url);
const evidenceFile = new URL('tests/preflight/evidence/hosting-http.json', root);
const JournalSchema = z.strictObject({
  checkedAt: z.string(), probeId: z.uuid(), syntheticOnly: z.literal(true),
  phase: z.enum(['reserved', 'waiting', 'resume-submitted', 'completed', 'cleaned']),
  startOrigin: z.url(), resumeOrigin: z.url().optional(), resumeSubmitted: z.boolean(),
  before: HostingProbeStatusSchema.optional(), after: HostingProbeStatusSchema.optional(),
  checks: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  lastError: z.enum(['request-failed-or-ambiguous', 'assertion-failed']).optional(),
  lastCheck: z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/).optional(),
});
type Journal = z.infer<typeof JournalSchema>;
const StartReceiptSchema = z.strictObject({ probeId: z.uuid(), runId: z.string().min(1), deploymentId: z.string().min(1) });

export function hostingOrigin(value: string): string {
  const origin = new URL(value);
  assert.equal(origin.protocol, 'https:', 'HTTPS_PREVIEW_REQUIRED');
  assert.ok(origin.hostname.endsWith('.vercel.app') && (origin.hostname.startsWith('tirlik-') || origin.hostname === 'tirlik.vercel.app'), 'TIRLIK_PREVIEW_REQUIRED');
  assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/', 'ORIGIN_ONLY_REQUIRED');
  return origin.origin;
}

async function loadControl() {
  const env = parse(await readFile(new URL('.vibemachina/runtime/hosting-control.env', root)));
  assert.ok(env.PREFLIGHT_HOSTING_TOKEN && env.PREFLIGHT_HOSTING_TOKEN.length >= 32, 'PREFLIGHT_TOKEN_REQUIRED');
  return { token: env.PREFLIGHT_HOSTING_TOKEN, bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET };
}

async function request(origin: string, path: string, method: string, probeId: string, authenticated = true) {
  const control = await loadControl();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${control.token}`;
  if (control.bypass) headers['x-vercel-protection-bypass'] = control.bypass;
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = probeId;
  }
  const response = await fetch(`${origin}/api/preflight/hosting${path}`, {
    method, headers, redirect: 'error', signal: AbortSignal.timeout(30000),
    ...(method === 'GET' ? {} : { body: JSON.stringify({ probeId }) }),
  });
  const cache = response.headers.get('cache-control')?.split(',').map((value) => value.trim()) ?? [];
  assert.ok(cache.includes('no-store') && cache.includes('private'), 'APPLICATION_RESPONSE_REQUIRED');
  assert.ok(response.headers.get('content-type')?.startsWith('application/json'), 'APPLICATION_JSON_REQUIRED');
  const bytes = await readBoundedBody(response.body, 32768);
  return { status: response.status, bytes, json: JSON.parse(bytes.toString('utf8')) as unknown };
}

async function status(origin: string, probeId: string): Promise<HostingProbeStatus> {
  const result = await request(origin, `?probeId=${probeId}`, 'GET', probeId);
  assert.equal(result.status, 200, 'STATUS_NOT_OK');
  const value = HostingProbeStatusSchema.parse(result.json);
  assert.equal(value.probeId, probeId, 'PROBE_ID_MISMATCH');
  return value;
}

async function poll(origin: string, probeId: string, ready: (value: HostingProbeStatus) => boolean) {
  let value = await status(origin, probeId);
  for (let attempt = 0; attempt < 20 && !ready(value); attempt += 1) {
    if (value.state === 'failed' || ['failed', 'cancelled'].includes(value.workflowStatus)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    value = await status(origin, probeId);
  }
  return value;
}

const save = (journal: Journal) => writeFile(evidenceFile, `${JSON.stringify(JournalSchema.parse(journal), null, 2)}\n`);

async function checkPrivateFile(origin: string, probeId: string, journal: Journal) {
  const denied = await request(origin, `/file?probeId=${probeId}`, 'GET', probeId, false);
  assert.equal(denied.status, 401, 'PRIVATE_FILE_AUTH_REQUIRED');
  assert.equal(ErrorEnvelopeSchema.parse(denied.json).code, 'UNAUTHENTICATED', 'APPLICATION_AUTH_PROOF_REQUIRED');
  const authorized = await request(origin, `/file?probeId=${probeId}`, 'GET', probeId);
  assert.equal(authorized.status, 200, 'PRIVATE_FILE_NOT_AVAILABLE');
  assert.equal(sha256(authorized.bytes), sha256(probePayload(probeId)), 'PRIVATE_FILE_HASH_MISMATCH');
  journal.checks.privateFileUnauthorizedHttpStatus = denied.status;
  journal.checks.privateFileAuthorizedSha256 = sha256(authorized.bytes);
}

export async function runHostingHttp(action: 'start' | 'status' | 'resume' | 'cleanup', rawOrigin: string) {
  const origin = hostingOrigin(rawOrigin);
  let journal: Journal;
  if (action === 'start') {
    journal = {
      checkedAt: new Date().toISOString(), probeId: randomUUID(), syntheticOnly: true,
      phase: 'reserved', startOrigin: origin, resumeSubmitted: false, checks: {},
    };
    const reservation = await open(evidenceFile, 'wx');
    await reservation.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
    await reservation.close();
  } else {
    journal = JournalSchema.parse(JSON.parse(await readFile(evidenceFile, 'utf8')));
  }
  const probeId = journal.probeId;
  try {
    if (action === 'start') {
      const started = await request(origin, '', 'POST', probeId);
      assert.equal(started.status, 202, 'START_NOT_ACCEPTED');
      const receipt = StartReceiptSchema.parse(started.json);
      assert.equal(receipt.probeId, probeId, 'START_PROBE_MISMATCH');
      const before = await poll(origin, probeId, (value) => value.state === 'waiting' && value.hookReady);
      assert.equal(before.runId, receipt.runId, 'START_RUN_MISMATCH');
      assert.equal(before.runtimeRegion, 'fra1', 'FUNCTION_REGION_MISMATCH');
      journal.checks.functionRuntimeRegion = before.runtimeRegion;
      journal.before = before;
      if (before.state === 'waiting' && before.hookReady) {
        assert.equal(before.beforeCount, 1, 'BEFORE_MARKER_MISSING');
        assert.equal(before.afterCount, 0, 'UNEXPECTED_AFTER_MARKER');
        const duplicate = await request(origin, '', 'POST', probeId);
        assert.equal(duplicate.status, 202, 'DUPLICATE_START_NOT_ACKNOWLEDGED');
        assert.equal(StartReceiptSchema.parse(duplicate.json).runId, receipt.runId, 'DUPLICATE_START_CREATED_RUN');
        await checkPrivateFile(origin, probeId, journal);
        journal.checks.startDeduplicated = true;
        journal.phase = 'waiting';
      }
    } else if (action === 'resume') {
      assert.ok(journal.before && journal.phase === 'waiting', 'WAITING_RECEIPT_REQUIRED');
      assert.equal(journal.resumeSubmitted, false, 'RESUME_ALREADY_SUBMITTED_USE_STATUS');
      const current = await status(origin, probeId);
      assert.equal(current.runtimeRegion, 'fra1', 'FUNCTION_REGION_MISMATCH');
      assert.notEqual(current.deploymentId, journal.before.deploymentId, 'REDEPLOYMENT_REQUIRED');
      assert.equal(current.startDeploymentId, journal.before.startDeploymentId, 'DATABASE_START_RECEIPT_CHANGED');
      assert.equal(current.runId, journal.before.runId, 'RUN_CHANGED_AFTER_REDEPLOY');
      assert.equal(current.beforeCount, 1, 'BEFORE_MARKER_LOST');
      assert.equal(current.afterCount, 0, 'ALREADY_RESUMED');
      assert.equal(current.blobSha256, journal.before.blobSha256, 'PRIVATE_BLOB_LOST');
      assert.equal(current.hookReady, true, 'HOOK_NOT_READY');
      await checkPrivateFile(origin, probeId, journal);
      journal.resumeOrigin = origin;
      journal.resumeSubmitted = true;
      journal.phase = 'resume-submitted';
      journal.checks.persistenceAcrossRedeploy = true;
      await save(journal);
      const resumed = await request(origin, '/resume', 'POST', probeId);
      assert.equal(resumed.status, 202, 'RESUME_NOT_ACCEPTED');
      assert.equal(StartReceiptSchema.parse(resumed.json).runId, current.runId, 'RESUME_RUN_MISMATCH');
      journal.after = await poll(origin, probeId, (value) => value.state === 'completed' && value.workflowStatus === 'completed');
    } else if (action === 'status') {
      const current = await status(origin, probeId);
      if (!journal.resumeSubmitted) {
        journal.before = current;
        if (current.state === 'waiting' && current.hookReady) {
          await checkPrivateFile(origin, probeId, journal);
          journal.phase = 'waiting';
        }
      } else journal.after = current;
    } else {
      assert.equal(journal.phase, 'completed', 'COMPLETED_RECEIPT_REQUIRED');
      const deleted = await request(origin, '', 'DELETE', probeId);
      assert.equal(deleted.status, 200, 'CLEANUP_FAILED');
      assert.deepEqual(deleted.json, { probeId, deleted: true, receiptRetained: true }, 'CLEANUP_RECEIPT_MISMATCH');
      const file = await request(origin, `/file?probeId=${probeId}`, 'GET', probeId);
      assert.equal(file.status, 404, 'CLEANUP_FILE_STILL_ACCESSIBLE');
      const current = await status(origin, probeId);
      assert.equal(current.fileAvailable, false, 'CLEANUP_POINTER_RETAINED');
      assert.equal(current.afterCount, 1, 'DURABLE_RECEIPT_REMOVED');
      journal.checks.privateFileCleaned = true;
      journal.checks.databaseReceiptRetained = true;
      journal.phase = 'cleaned';
    }
    if (journal.after?.state === 'completed' && journal.after.workflowStatus === 'completed' && journal.phase !== 'cleaned') {
      assert.equal(journal.after.beforeCount, 1, 'DUPLICATE_BEFORE_MARKER');
      assert.equal(journal.after.afterCount, 1, 'DUPLICATE_AFTER_MARKER');
      assert.equal(journal.after.runId, journal.before?.runId, 'COMPLETION_RUN_MISMATCH');
      assert.notEqual(journal.after.startDeploymentId, journal.after.resumeDeploymentId, 'REDEPLOYMENT_NOT_PROVEN');
      journal.checks.workflowResumedAcrossRedeploy = true;
      journal.checks.exactlyOneBeforeAndAfterMarker = true;
      journal.phase = 'completed';
    }
    delete journal.lastError;
    delete journal.lastCheck;
  } catch (error) {
    journal.lastError = error instanceof assert.AssertionError ? 'assertion-failed' : 'request-failed-or-ambiguous';
    if (error instanceof assert.AssertionError && /^[A-Z][A-Z0-9_]{1,99}$/.test(error.message)) journal.lastCheck = error.message;
    process.exitCode = 1;
  }
  await save(journal);
  return journal;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [action, flag, origin, execute] = process.argv.slice(2);
    assert.ok(['start', 'status', 'resume', 'cleanup'].includes(action ?? '') && flag === '--origin' && origin && execute === '--execute' && process.argv.length === 6, 'EXPLICIT_ACTION_ORIGIN_EXECUTE_REQUIRED');
    const journal = await runHostingHttp(action as 'start' | 'status' | 'resume' | 'cleanup', origin);
    console.log(JSON.stringify({ phase: journal.phase, checks: journal.checks, lastError: journal.lastError ?? null, lastCheck: journal.lastCheck ?? null }));
  } catch {
    console.error('HOSTING_HTTP_INPUT_REJECTED_OR_RECEIPT_ALREADY_EXISTS');
    process.exitCode = 1;
  }
}
