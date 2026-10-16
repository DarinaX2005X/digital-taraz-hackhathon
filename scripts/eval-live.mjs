import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { tsImport } from 'tsx/esm/api';
import { loadEnvironment, assertNodeVersion } from './dev/environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { action: { type: 'string' }, user: { type: 'string' }, workspace: { type: 'string' }, key: { type: 'string' }, run: { type: 'string' } }, strict: true });
const actions = ['inspect', 'readiness', 'candidate', 'activate', 'start', 'status', 'enable', 'refresh', 'business-preflight', 'business'];
if (!actions.includes(values.action)) throw new Error(`Use --action ${actions.join('|')}. Mutating actions require an independently reviewed release.`);
assertNodeVersion();
Object.assign(process.env, await loadEnvironment(root));
const { getDatabasePool } = await tsImport('../src/server/db/pool.ts', import.meta.url);
const admin = await tsImport('../src/features/runs/server/proof-admin.ts', import.meta.url);

const LIVE_CONSTRAINT_ID = 'live-proof-constraint';
const LIVE_RESULT_EDIT_ID = 'live-proof-result-note';
const LIVE_CONSTRAINT = 'New authoritative constraint for this proof: the pharmacy entrance must remain clear from 13:00 on Friday, so installation must finish by 13:00 Friday rather than 18:00. If that is not feasible, do not promise it; compare a smaller first release with the full package and preserve the capacity and white-vinyl evidence.';
const LIVE_GOAL = 'Use the two saved inputs, including the new authoritative 13:00 Friday installation constraint. Compare the full package with a materially smaller first release using the saved prices, direct costs, white-vinyl availability, workload and resource availability. Pause for an explicit option selection, then create the selected option as exactly three linked editable materials: estimate, customer offer and operational plan. Send or book nothing.';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function required(value, message) { if (value === undefined || value === null) throw new Error(message); return value; }
function deterministicKey(prefix, key) { return `${prefix}_${key.replaceAll('-', '_')}`.slice(0, 128); }
function deterministicUuid(prefix, key) {
  const bytes = createHash('sha256').update(`${prefix}\0${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function sourceVector(snapshot) { return Object.fromEntries(snapshot.sourceFreshness.filter((item) => item.currentRevision !== undefined).map((item) => [item.sourceRef.sourceId, item.currentRevision])); }
function documentRoot(snapshot) {
  if (snapshot.content.kind !== 'document') throw new Error('LIVE_DOCUMENT_REQUIRED');
  return required(snapshot.content.document.attrs?.id, 'LIVE_DOCUMENT_ROOT_REQUIRED');
}
function hasTarget(value, targetId) {
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(value) && value.attrs?.id === targetId) return true;
  return Object.values(value).some((item) => hasTarget(item, targetId));
}

async function applicationHealth() {
  const response = await fetch('http://127.0.0.1:59850/api/health', { redirect: 'error', signal: AbortSignal.timeout(5_000), headers: { Connection: 'close' } });
  const body = await response.json();
  if (!response.ok || body?.status !== 'ok' || body?.database !== 'ready') throw new Error('LIVE_APPLICATION_NOT_HEALTHY');
  return { status: response.status, body };
}

async function liveBusinessScope(pool, startKey) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(startKey)) throw new Error('LIVE_KEY_REQUIRED');
  const secret = process.env.DEMO_CAPABILITY_SECRET;
  if (!secret || secret.length < 32) throw new Error('DEMO_CAPABILITY_SECRET_REQUIRED');
  const [{ createDemoExecutionScopeService }, { getRunRuntime }] = await Promise.all([
    tsImport('../src/features/demo/server/execution-scope.ts', import.meta.url),
    tsImport('../src/features/runs/server/runtime.ts', import.meta.url),
  ]);
  const service = createDemoExecutionScopeService({ pool, secret, runtime: getRunRuntime(), wake: async () => undefined });
  const created = await service.create('en', startKey);
  let scope = await service.read(created.scope.sessionId, created.capabilityToken);
  const snapshots = await Promise.all(scope.inputRefs.map((ref) => service.artifactSnapshot(scope.sessionId, created.capabilityToken, ref.id)));
  const brief = required(snapshots.find((snapshot) => snapshot.content.kind === 'document'), 'LIVE_BRIEF_REQUIRED');
  const plan = required(snapshots.find((snapshot) => snapshot.content.kind === 'plan'), 'LIVE_PLAN_REQUIRED');
  const constraintPresent = hasTarget(brief.content, LIVE_CONSTRAINT_ID);
  if (!constraintPresent) {
    const expectedSourceRevisions = sourceVector(brief);
    await service.applyArtifactCommand(scope.sessionId, created.capabilityToken, {
      workspaceId: scope.workspaceId,
      expectedAuthzVersion: 1,
      group: {
        commandGroupId: randomUUID(),
        expectedArtifactRevisions: { [brief.artifact.id]: brief.artifact.currentRevision },
        expectedSourceRevisions,
        commands: [{
          commandId: randomUUID(), artifactId: brief.artifact.id, baseRevision: brief.artifact.currentRevision, kind: 'document', expectedSourceRevisions,
          reason: 'Add the new live-proof operating constraint before model execution',
          operations: [{ targetId: LIVE_CONSTRAINT_ID, op: 'insert', beforeHash: null, value: { parentId: documentRoot(brief), beforeId: null, node: { type: 'paragraph', attrs: { id: LIVE_CONSTRAINT_ID }, content: [{ type: 'text', text: LIVE_CONSTRAINT }] } } }],
        }],
      },
    });
    scope = await service.read(scope.sessionId, created.capabilityToken);
  }
  const currentBrief = await service.artifactSnapshot(scope.sessionId, created.capabilityToken, brief.artifact.id);
  if (!hasTarget(currentBrief.content, LIVE_CONSTRAINT_ID) || !JSON.stringify(currentBrief.content).includes('13:00 Friday')) throw new Error('LIVE_CONSTRAINT_NOT_SAVED');
  const currentPlan = await service.artifactSnapshot(scope.sessionId, created.capabilityToken, plan.artifact.id);
  if (currentPlan.content.kind !== 'plan' || currentPlan.content.entries.length < 3) throw new Error('LIVE_PLAN_INPUT_INCOMPLETE');
  return { service, created, scope, brief: currentBrief, plan: currentPlan, constraintInserted: !constraintPresent };
}

async function pollRun(service, scope, token, runId, predicate, timeoutMs = 720_000) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt < timeoutMs) {
    last = await service.readRun(scope.sessionId, token, runId);
    if (predicate(last)) return last;
    await delay(2_000);
  }
  throw new Error(`LIVE_RUN_TIMEOUT:${last?.state ?? 'unknown'}`);
}

function chooseRunOption(run) {
  if (run.failure) throw new Error(`LIVE_RUN_FAILURE:${run.failure}`);
  const work = run.progress.workDecision;
  if (work?.requiresConsent) {
    const option = required(work.options[0], 'LIVE_WORK_OPTION_REQUIRED');
    return { selectedOptionId: option.id, acceptedConditionIds: [], kind: 'work' };
  }
  const decision = run.progress.decision;
  if (!decision) throw new Error('LIVE_STRUCTURED_DECISION_REQUIRED');
  const option = decision.options.find((item) => item.outcome === 'feasible') ?? decision.options.find((item) => item.outcome === 'conditional');
  if (!option) throw new Error('LIVE_FEASIBLE_OPTION_REQUIRED');
  const acceptedConditionIds = run.progress.questions.filter((question) => question.id.startsWith('accept_conditions_')).map((question) => question.id);
  const unsupportedQuestions = run.progress.questions.filter((question) => question.required && question.id !== 'select_option' && !question.id.startsWith('accept_conditions_'));
  if (unsupportedQuestions.length) throw new Error(`LIVE_UNRESOLVED_QUESTION:${unsupportedQuestions.map((question) => question.id).join(',')}`);
  return { selectedOptionId: option.id, acceptedConditionIds, kind: 'commercial' };
}

async function readUsageLedger(pool, runId) {
  const usage = (await pool.query(`SELECT id,state,model,endpoint,reserved_usd::text AS reserved_usd,actual_usd::text AS actual_usd,input_tokens,output_tokens,cached_input_tokens,provider_request_id,operation_key,created_at,reconciled_at
    FROM agent_run_usage WHERE run_id=$1 ORDER BY created_at,id`, [runId])).rows;
  const totals = (await pool.query(`SELECT count(*)::int AS calls,COALESCE(sum(actual_usd),0)::text AS actual_usd,COALESCE(sum(reserved_usd),0)::text AS reserved_usd,
    count(*) FILTER (WHERE state IN ('reserved','dispatched','ambiguous'))::int AS unresolved FROM agent_run_usage WHERE run_id=$1`, [runId])).rows[0];
  const authorization = (await pool.query(`SELECT state,limit_usd::text AS limit_usd,reserved_usd::text AS reserved_usd,spent_usd::text AS spent_usd,authority_ref
    FROM agent_budget_authorizations WHERE id=$1`, ['user-2026-10-14-autonomy-usd10'])).rows[0];
  return { usage, totals, authorization };
}

async function verifyBusinessResult(pool, live, run, selection, startedLedger, startKey) {
  if (run.state !== 'completed' || run.failure !== null) throw new Error(`LIVE_RUN_NOT_COMPLETED:${run.state}:${run.failure ?? 'none'}`);
  const context = (await pool.query('SELECT state,revision FROM agent_run_contexts WHERE run_id=$1', [run.id])).rows[0];
  const bundle = required(context?.state?.bundle, 'LIVE_DECISION_BUNDLE_REQUIRED');
  if (bundle.optionId !== selection.selectedOptionId) throw new Error('LIVE_SELECTED_OPTION_MISMATCH');
  const refs = [bundle.estimate, bundle.offer, bundle.plan];
  if (refs.length !== 3 || new Set(refs.map((ref) => ref.id)).size !== 3) throw new Error('LIVE_THREE_ARTIFACTS_REQUIRED');
  const before = await Promise.all(refs.map((ref) => live.service.artifactSnapshot(live.scope.sessionId, live.created.capabilityToken, ref.id)));
  const kinds = before.map((snapshot) => snapshot.content.kind).sort();
  if (kinds.join(',') !== 'document,plan,table') throw new Error(`LIVE_TYPED_ARTIFACTS_REQUIRED:${kinds.join(',')}`);
  for (const [index, snapshot] of before.entries()) {
    if (snapshot.artifact.currentRevision !== refs[index].revision || snapshot.artifact.projectId !== live.scope.projectId) throw new Error('LIVE_ARTIFACT_READBACK_MISMATCH');
  }
  const offer = required(before.find((snapshot) => snapshot.content.kind === 'document'), 'LIVE_OFFER_REQUIRED');
  if (!hasTarget(offer.content, LIVE_RESULT_EDIT_ID)) {
    const expectedSourceRevisions = sourceVector(offer);
    await live.service.applyArtifactCommand(live.scope.sessionId, live.created.capabilityToken, {
      workspaceId: live.scope.workspaceId,
      expectedAuthzVersion: 1,
      group: {
        commandGroupId: randomUUID(), expectedArtifactRevisions: { [offer.artifact.id]: offer.artifact.currentRevision }, expectedSourceRevisions,
        commands: [{
          commandId: randomUUID(), artifactId: offer.artifact.id, baseRevision: offer.artifact.currentRevision, kind: 'document', expectedSourceRevisions,
          reason: 'Record the explicit live-proof review on the saved offer',
          operations: [{ targetId: LIVE_RESULT_EDIT_ID, op: 'insert', beforeHash: null, value: { parentId: documentRoot(offer), beforeId: null, node: { type: 'paragraph', attrs: { id: LIVE_RESULT_EDIT_ID }, content: [{ type: 'text', text: 'Reviewed after the live decision: keep the 13:00 Friday access constraint visible before any customer commitment.' }] } } }],
        }],
      },
    });
  }
  const reopened = await live.service.artifactSnapshot(live.scope.sessionId, live.created.capabilityToken, offer.artifact.id);
  if (reopened.artifact.currentRevision <= offer.artifact.currentRevision || !hasTarget(reopened.content, LIVE_RESULT_EDIT_ID)) throw new Error('LIVE_EDIT_REOPEN_FAILED');
  const exportItems = [];
  for (const snapshot of await Promise.all(refs.map((ref) => live.service.artifactSnapshot(live.scope.sessionId, live.created.capabilityToken, ref.id)))) {
    const format = snapshot.content.kind === 'table' ? 'xlsx' : snapshot.content.kind === 'document' ? 'pdf' : 'ics';
    exportItems.push({ artifactId: snapshot.artifact.id, revision: snapshot.artifact.currentRevision, formats: [format] });
  }
  const exportJob = await live.service.createExport(live.scope.sessionId, live.created.capabilityToken, {
    workspaceId: live.scope.workspaceId, expectedAuthzVersion: 1, locale: 'en', items: exportItems,
  }, deterministicUuid('j1export', startKey));
  const rendered = await live.service.renderExport(live.scope.sessionId, live.created.capabilityToken, exportJob.id);
  if (rendered.status !== 'ready' || rendered.files.length !== 3 || rendered.files.some((file) => file.status !== 'ready')) throw new Error('LIVE_EXPORT_NOT_READY');
  const downloads = [];
  for (const file of rendered.files) {
    const downloaded = await live.service.downloadExport(live.scope.sessionId, live.created.capabilityToken, rendered.id, file.id);
    if (!downloaded.bytes?.byteLength) throw new Error('LIVE_EXPORT_EMPTY');
    downloads.push({ artifactId: file.artifactId, revision: file.revision, format: file.format, mediaType: downloaded.mediaType, byteSize: downloaded.bytes.byteLength, sha256: file.sha256 });
  }
  const ledger = await readUsageLedger(pool, run.id);
  if (!ledger.usage.length || Number(ledger.totals.unresolved) !== 0 || ledger.usage.some((item) => item.state !== 'succeeded' || item.actual_usd === null)) throw new Error('LIVE_USAGE_NOT_RECONCILED');
  if (Number(ledger.totals.actual_usd) > 2) throw new Error('LIVE_ALLOCATION_EXCEEDED');
  const evidence = {
    checkedAt: new Date().toISOString(), runId: run.id, sessionId: live.scope.sessionId, workspaceId: live.scope.workspaceId, projectId: live.scope.projectId,
    constraint: { artifactId: live.brief.artifact.id, revision: live.brief.artifact.currentRevision, targetId: LIVE_CONSTRAINT_ID, text: LIVE_CONSTRAINT },
    selection, artifacts: refs.map((ref) => ({ id: ref.id, revision: ref.revision, title: ref.title })),
    editedArtifact: { id: reopened.artifact.id, revision: reopened.artifact.currentRevision, targetId: LIVE_RESULT_EDIT_ID }, exports: downloads,
    run: { state: run.state, requestCount: run.budget.requestCount, limitUsd: run.budget.limitUsd, spentUsd: run.budget.spentUsd, contextRevision: context.revision },
    ledger, authorizationBefore: startedLedger.authorization,
  };
  const evidenceUrl = new URL('../.vibemachina/runtime/live-business-proof.json', import.meta.url);
  await mkdir(new URL('./', evidenceUrl), { recursive: true });
  await writeFile(evidenceUrl, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ...evidence, evidenceFile: fileURLToPath(evidenceUrl) };
}

async function businessPreflight(pool, startKey) {
  const [health, readiness] = await Promise.all([applicationHealth(), admin.modelProofReadiness(pool)]);
  if (!readiness.readyForRuntimeCalls || readiness.paidProofRequired || readiness.unresolvedRuntimeUsages !== 0) throw new Error(`LIVE_NOT_READY:${readiness.nextAction}`);
  const live = await liveBusinessScope(pool, startKey);
  const ledger = await readUsageLedger(pool, '00000000-0000-0000-0000-000000000000');
  if (!ledger.authorization || ledger.authorization.state !== 'active' || Number(ledger.authorization.reserved_usd) !== 0) throw new Error('LIVE_AUTHORIZATION_NOT_AVAILABLE');
  if (live.scope.runIds.length > 1) throw new Error('LIVE_SCOPE_HAS_UNEXPECTED_RUNS');
  return { health, readiness, scope: { sessionId: live.scope.sessionId, workspaceId: live.scope.workspaceId, projectId: live.scope.projectId, revision: live.scope.revision, inputRefs: live.scope.inputRefs }, inputs: { brief: { id: live.brief.artifact.id, revision: live.brief.artifact.currentRevision }, plan: { id: live.plan.artifact.id, revision: live.plan.artifact.currentRevision, entries: live.plan.content.entries.length }, constraintInserted: live.constraintInserted }, authorization: ledger.authorization };
}

async function runBusinessProof(pool, startKey) {
  const preflight = await businessPreflight(pool, startKey);
  const live = await liveBusinessScope(pool, startKey);
  const startedLedger = await readUsageLedger(pool, '00000000-0000-0000-0000-000000000000');
  const started = await live.service.createRun(live.scope.sessionId, live.created.capabilityToken, { goal: LIVE_GOAL, inputRefs: live.scope.inputRefs, expectedRevision: live.scope.revision }, deterministicKey('j1run', startKey));
  let run = await pollRun(live.service, live.scope, live.created.capabilityToken, started.id, (value) => ['waiting_input', 'review_ready', 'completed', 'failed', 'cancelled'].includes(value.state));
  if (run.state !== 'waiting_input') throw new Error(`LIVE_SELECTION_NOT_REACHED:${run.state}:${run.failure ?? 'none'}`);
  const selection = chooseRunOption(run);
  run = await live.service.resumeRun(live.scope.sessionId, live.created.capabilityToken, run.id, { expectedEpoch: run.epoch, selectedOptionId: selection.selectedOptionId, ...(selection.acceptedConditionIds.length ? { acceptedConditionIds: selection.acceptedConditionIds } : {}) }, deterministicKey('j1resume', startKey));
  run = await pollRun(live.service, live.scope, live.created.capabilityToken, run.id, (value) => ['completed', 'review_ready', 'failed', 'cancelled'].includes(value.state) || (value.state === 'waiting_input' && value.failure !== null));
  return { preflight, proof: await verifyBusinessResult(pool, live, run, selection, startedLedger, startKey) };
}

let pool;
try {
  // Historical liabilities remain untouched and visible beside the new SQL grant.
  const legacy = JSON.parse(await readFile(new URL('../tests/preflight/evidence/live-receipts.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify({ historicalLedger: { batchId: legacy.batchId, confirmedUsd: legacy.actualCostUsd, calls: legacy.calls?.map(({ caseId, status, reservedUsd, actualCostUsd }) => ({ caseId, status, reservedUsd, actualCostUsd })) ?? [] } }));
  let result;
  if (values.action === 'inspect') result = await admin.inspectProofPricing();
  else {
    pool = getDatabasePool();
    if (values.action === 'readiness') result = await admin.modelProofReadiness(pool);
    if (values.action === 'candidate') result = await admin.registerProofCandidate(pool, await admin.inspectProofPricing());
    if (values.action === 'activate') result = await admin.activateProofAuthorization(pool);
    if (values.action === 'start') result = await admin.startModelProof(pool, { userId: values.user, workspaceId: values.workspace, key: values.key });
    if (values.action === 'status') result = await admin.proofStatus(pool, values.run);
    if (values.action === 'enable') result = await admin.enableProvenModel(pool, values.run);
    if (values.action === 'refresh') result = await admin.refreshProvenPricing(pool, await admin.inspectProofPricing());
    if (values.action === 'business-preflight') result = await businessPreflight(pool, required(values.key, 'Use --key with a stable 16-128 character proof key.'));
    if (values.action === 'business') result = await runBusinessProof(pool, required(values.key, 'Use --key with the reviewed preflight key.'));
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error?.failure ? `EVAL_${String(error.failure).toUpperCase()}` : 'EVAL_FAILED');
  process.exitCode = 1;
} finally { await pool?.end(); }
