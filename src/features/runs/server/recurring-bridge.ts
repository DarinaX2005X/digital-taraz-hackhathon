import type { Pool } from 'pg';

import { LocaleSchema } from '../../../contracts/primitives';
import type { CreateRun, Run } from '../../../contracts/runs';
import type { IdentityPrincipal } from '../../identity/server/access';
import type { RecurringRunBridge, RecurringRunRequest } from '../../recurring-work/server/runtime-bridge';
import type { JsonObject } from './data';

interface CanonicalRunService {
  create(principal: IdentityPrincipal, input: CreateRun, key: string, options: {
    trusted: true;
    privateInput: JsonObject;
    budgetLimitUsd: string;
  }): Promise<Run>;
  read(principal: IdentityPrincipal, runId: string): Promise<Run>;
  cancel(principal: IdentityPrincipal, runId: string, input: { expectedEpoch: number }, key: string): Promise<Run>;
}

async function ownerLocale(pool: Pool, userId: string) {
  const row = (await pool.query<{ locale: unknown }>('SELECT locale FROM identity_users WHERE id=$1', [userId])).rows[0];
  return LocaleSchema.catch('ru').parse(row?.locale);
}

function runInput(request: RecurringRunRequest, locale: Run['locale']): CreateRun {
  return {
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    capabilityId: 'business.goal',
    capabilityVersion: 1,
    goal: request.definition.goal,
    locale,
    inputRefs: [
      ...request.sourceRefs.map((ref) => ({ kind: 'source' as const, id: ref.sourceId, revision: ref.revision })),
      ...(request.branchId ? [{ kind: 'artifact' as const, id: request.branchId, revision: 0 }] : []),
    ],
  };
}

function privateInput(request: RecurringRunRequest): JsonObject {
  return {
    executionAuthority: {
      kind: 'rule',
      userId: request.principal.userId,
      ruleId: request.occurrence.ruleId,
      ruleVersion: request.occurrence.ruleVersion,
      occurrenceId: request.occurrence.id,
    },
    businessContextRefs: request.definition.contextRefs,
    currentArtifact: request.branchId ? { id: request.branchId, revision: 0 } : null,
  };
}

export function createRecurringRunBridge(pool: Pool, service: CanonicalRunService): RecurringRunBridge {
  return {
    async start(request) {
      const run = await service.create(
        request.principal,
        runInput(request, await ownerLocale(pool, request.principal.userId)),
        request.operationId,
        { trusted: true, privateInput: privateInput(request), budgetLimitUsd: request.definition.budget.maximumUsd },
      );
      return { runId: run.id, state: run.state === 'waiting_input' ? 'waiting_input' : 'queued' };
    },
    async cancel(request) {
      const principal: IdentityPrincipal = { kind: 'job', userId: request.principal.userId, authzVersion: request.expectedAuthzVersion };
      const run = await service.read(principal, request.runId);
      await service.cancel(principal, request.runId, { expectedEpoch: run.epoch }, request.operationId);
    },
  };
}
