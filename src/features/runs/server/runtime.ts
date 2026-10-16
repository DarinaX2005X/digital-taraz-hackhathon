import { getDatabasePool } from '../../../server/db/pool';
import { createBudgetLedger } from './budget';
import { runtimeFixture } from './fixture';
import { createRunRegistry } from './registry';
import { createRunService } from './service';
import { modelProofRegistration } from './model-proof';
import { businessRegistration } from '../../agent-tools/server/business';
import { materialContextBusinessToolExtension } from '../../agent-tools/server/material-context';
import { businessWorkToolExtension } from '../../agent-tools/server/business-work-adapter';
import { sourceOcrRegistration } from '../../sources/server/ocr-runtime';
import { operationsBusinessToolExtension } from '../../operations/server/ai-business-tool';
import { createFinanceWorkBuilder } from '../../finance/server/work-builder';
import { createCampaignWorkToolDescriptor } from '../../campaigns/server';
import type { WorkExecutionContext } from '../../../contracts/business-work';

function principalForBusinessWork(context: WorkExecutionContext) {
  return { kind: 'job' as const, userId: context.authority.userId, authzVersion: context.expectedAuthzVersion };
}

export function createApplicationRunRegistry() {
  const pool = getDatabasePool();
  const fixture = runtimeFixture(process.env.NODE_ENV === 'test' && /^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? ''));
  const proof = modelProofRegistration(pool);
  const finance = createFinanceWorkBuilder(pool, { principalForContext: principalForBusinessWork });
  const campaign = createCampaignWorkToolDescriptor({ pool, principalForContext: principalForBusinessWork });
  const businessWork = businessWorkToolExtension([...finance.toolDescriptors, campaign]);
  const business = businessRegistration(pool, { extensions: [operationsBusinessToolExtension, materialContextBusinessToolExtension(pool), businessWork] });
  const ocr = sourceOcrRegistration(pool);
  return createRunRegistry([fixture.capability, proof.capability, business.capability, ocr.capability], [...fixture.tools, ...proof.tools, ...business.tools, ...ocr.tools]);
}

let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime() {
  const pool = getDatabasePool();
  const registry = createApplicationRunRegistry();
  return { pool, registry, service: createRunService(pool, registry), ledger: createBudgetLedger(pool) };
}
export function getRunRuntime() { return runtime ??= createRuntime(); }
