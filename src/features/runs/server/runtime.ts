import { getDatabasePool } from '../../../server/db/pool';
import { createBudgetLedger } from './budget';
import { runtimeFixture } from './fixture';
import { createRunRegistry } from './registry';
import { createRunService } from './service';
import { modelProofRegistration } from './model-proof';
import { businessRegistration } from '../../agent-tools/server/business';
import { sourceOcrRegistration } from '../../sources/server/ocr-runtime';

export function createApplicationRunRegistry() {
  const fixture = runtimeFixture(process.env.NODE_ENV === 'test' && /^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? ''));
  const proof = modelProofRegistration(getDatabasePool());
  const business = businessRegistration(getDatabasePool());
  const ocr = sourceOcrRegistration(getDatabasePool());
  return createRunRegistry([fixture.capability, proof.capability, business.capability, ocr.capability], [...fixture.tools, ...proof.tools, ...business.tools, ...ocr.tools]);
}

let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime() {
  const pool = getDatabasePool();
  const registry = createApplicationRunRegistry();
  return { pool, registry, service: createRunService(pool, registry), ledger: createBudgetLedger(pool) };
}
export function getRunRuntime() { return runtime ??= createRuntime(); }
