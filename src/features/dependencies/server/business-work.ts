import {
  PrepareWorkChangesInputSchema,
  PrepareWorkChangesResultSchema,
  WorkExecutionContextSchema,
  type PrepareWorkChangesInput,
  type PrepareWorkChangesResult,
  type WorkExecutionContext,
} from '../../../contracts/business-work';
import { createDependencyService } from './service';
import { getDatabasePool } from '../../../server/db/pool';

export async function prepareWorkChanges(input: PrepareWorkChangesInput, context: WorkExecutionContext): Promise<PrepareWorkChangesResult> {
  const body = PrepareWorkChangesInputSchema.parse(input), execution = WorkExecutionContextSchema.parse(context);
  if (body.projectId !== execution.projectId) throw new TypeError('PREPARE_WORK_PROJECT_MISMATCH');
  const principal = { kind: 'job' as const, userId: execution.authority.userId, authzVersion: execution.expectedAuthzVersion };
  return PrepareWorkChangesResultSchema.parse(await createDependencyService(getDatabasePool()).prepareWorkChanges(principal, execution.operationId, { ...body, workspaceId: execution.workspaceId, expectedAuthzVersion: execution.expectedAuthzVersion }, execution));
}
