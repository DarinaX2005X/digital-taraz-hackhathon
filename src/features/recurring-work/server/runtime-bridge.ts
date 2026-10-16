import type { SourceRef } from '../../../contracts/artifacts';
import type { WorkRuleDefinition } from '../../../contracts/business-work';
import type { IdentityPrincipal } from '../../identity/server/access';
import type { WorkOccurrence } from '../contracts';

export interface RecurringRunRequest {
  principal: IdentityPrincipal;
  operationId: string;
  workspaceId: string;
  projectId: string;
  authzVersion: number;
  definition: WorkRuleDefinition;
  occurrence: WorkOccurrence;
  sourceRefs: SourceRef[];
  branchId: string | null;
}

export interface RecurringRunResult {
  runId: string;
  state: 'queued' | 'waiting_input';
  reasonCode?: string;
}

/** Implemented by the canonical runtime owner. The bridge must create the
 * existing capability run idempotently by operationId and apply the rule's
 * maximumUsd as a trusted server-side ceiling. */
export interface RecurringRunBridge {
  start(request: RecurringRunRequest): Promise<RecurringRunResult>;
  cancel(request: { principal: IdentityPrincipal; runId: string; workspaceId: string; expectedAuthzVersion: number; operationId: string }): Promise<void>;
}
