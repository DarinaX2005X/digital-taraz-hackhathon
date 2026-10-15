import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { tsImport } from 'tsx/esm/api';
import { loadEnvironment, assertNodeVersion } from './dev/environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { action: { type: 'string' }, user: { type: 'string' }, workspace: { type: 'string' }, key: { type: 'string' }, run: { type: 'string' } }, strict: true });
const actions = ['inspect', 'readiness', 'candidate', 'activate', 'start', 'status', 'enable', 'refresh'];
if (!actions.includes(values.action)) throw new Error(`Use --action ${actions.join('|')}. Mutating actions require an independently reviewed release.`);
assertNodeVersion();
Object.assign(process.env, await loadEnvironment(root));
const { getDatabasePool } = await tsImport('../src/server/db/pool.ts', import.meta.url);
const admin = await tsImport('../src/features/runs/server/proof-admin.ts', import.meta.url);
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
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error?.failure ? `EVAL_${String(error.failure).toUpperCase()}` : 'EVAL_FAILED');
  process.exitCode = 1;
} finally { await pool?.end(); }
