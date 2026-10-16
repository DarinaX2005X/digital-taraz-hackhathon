import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  BuildCampaignWorkInputSchema,
  BusinessWorkResultSchema,
  type BuildCampaignWorkInput,
  type BusinessWorkResult,
  type WorkExecutionContext,
} from '@/contracts/business-work';
import type { SourceRef } from '@/contracts/artifacts';
import type { ArtifactContent, DocumentNode } from '@/features/artifacts/domain/content-models';
import { createArtifactService } from '@/features/artifacts/server/service';
import { withWorkspaceAccessInTransaction, identityTransaction, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { IdentityError } from '@/features/identity/server/http';
import { proposeWorkPlan, type ProposeWorkPlanResult } from '@/features/operations/domain/propose-work-plan';
import { readPlanResourceSnapshotsInTransaction } from '@/features/operations/server/service';
import { readPinnedSource } from '@/features/sources/server/pinned-source';
import { SourceAssetLicenseSchema } from '@/contracts/sources';
import { getDatabasePool } from '@/server/db/pool';

import { composeCampaignVariants } from '../domain/compose-campaign';
import { conditionText, type CampaignCondition } from '../domain/model';

type ArtifactService = ReturnType<typeof createArtifactService>;

type AssetRow = {
  id: string;
  source_id: string;
  source_version_id: string;
  project_id: string;
  state: string;
  kind: string;
  license: unknown;
};

export type CampaignWorkDependencies = {
  pool: Pool;
  artifacts?: ArtifactService;
  plan?: typeof proposeWorkPlan;
  principalForContext?: (context: WorkExecutionContext) => IdentityPrincipal;
};

function principal(context: WorkExecutionContext): IdentityPrincipal {
  if (context.authority.kind !== 'user') throw new IdentityError('UNAVAILABLE', 'campaigns.errors.demoUnavailable');
  return { kind: 'job', userId: context.authority.userId, authzVersion: context.expectedAuthzVersion };
}

function derivedOperationId(operationId: string, purpose: string) {
  const value = createHash('sha256').update(`tirlik-campaign-work-v1:${operationId}:${purpose}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

function sourceKey(ref: SourceRef) {
  return [ref.sourceId, ref.sourceVersionId, ref.revision, ref.fragmentId ?? '', ref.collectionId ?? '', ref.recordId ?? '', ref.fieldId ?? '', ref.factRevision ?? ''].join(':');
}

function uniqueRefs(refs: readonly SourceRef[]) {
  return [...new Map(refs.map((ref) => [sourceKey(ref), structuredClone(ref)])).values()];
}

function assertAllowedInputs(input: BuildCampaignWorkInput, context: WorkExecutionContext) {
  const allowed = new Set(context.allowedInputRefs.map((ref) => `${ref.kind}:${ref.id}:${ref.revision}`));
  for (const ref of input.sourceRefs) if (!allowed.has(`source:${ref.sourceId}:${ref.revision}`)) throw new IdentityError('NOT_FOUND', 'campaigns.errors.sourceUnavailable');
  if (input.budgetRef && !allowed.has(`artifact:${input.budgetRef.artifactId}:${input.budgetRef.revision}`)) throw new IdentityError('NOT_FOUND', 'campaigns.errors.budgetUnavailable');
  for (const ref of input.sourceRefs) if (context.inputRevisionVector[ref.sourceId] !== undefined && context.inputRevisionVector[ref.sourceId] !== ref.revision) throw new IdentityError('CONFLICT', 'campaigns.errors.sourceChanged');
  if (input.budgetRef && context.inputRevisionVector[input.budgetRef.artifactId] !== undefined && context.inputRevisionVector[input.budgetRef.artifactId] !== input.budgetRef.revision) throw new IdentityError('CONFLICT', 'campaigns.errors.budgetChanged');
}

function localized(locale: WorkExecutionContext['locale']) {
  return {
    briefTitle: { ru: 'Кампания: исходные условия', kk: 'Кампания: бастапқы шарттар', en: 'Campaign: source terms' }[locale],
    briefHeading: { ru: 'Задача кампании', kk: 'Кампания мақсаты', en: 'Campaign brief' }[locale],
    conditions: { ru: 'Подтверждённые условия', kk: 'Расталған шарттар', en: 'Confirmed terms' }[locale],
    budgetLinked: { ru: 'Бюджет связан с выбранной версией финансового материала.', kk: 'Бюджет қаржы материалының таңдалған нұсқасымен байланыстырылды.', en: 'Budget is linked to the selected finance artifact version.' }[locale],
    budgetMissing: { ru: 'Бюджет не выбран.', kk: 'Бюджет таңдалмаған.', en: 'No budget selected.' }[locale],
    summary: { ru: 'Подготовлены два редактируемых варианта кампании. Выберите вариант перед выпуском файлов.', kk: 'Кампанияның екі өңделетін нұсқасы дайын. Файлдарды шығармас бұрын нұсқаны таңдаңыз.', en: 'Two editable campaign directions are ready. Choose one before producing files.' }[locale],
    editorial: { ru: 'Главное сообщение', kk: 'Негізгі хабарлама', en: 'Message first' }[locale],
    split: { ru: 'Условия в фокусе', kk: 'Шарттарға назар', en: 'Terms in focus' }[locale],
  };
}

function textNode(text: string, id: string): DocumentNode { return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }; }
function headingNode(text: string, id: string, level = 2): DocumentNode { return { type: 'heading', attrs: { id, level }, content: [{ type: 'text', text }] }; }

function campaignDocument(input: BuildCampaignWorkInput, context: WorkExecutionContext): Extract<ArtifactContent, { kind: 'document' }> {
  const t = localized(context.locale);
  const nodeId = (purpose: string) => derivedOperationId(context.operationId, `brief-node:${purpose}`);
  const conditionNodes = input.conditions.map((condition, index) => ({
    type: 'listItem' as const,
    attrs: { id: nodeId(`condition-item:${index}:${condition.id}`) },
    content: [textNode(`${condition.id}: ${conditionText(condition as CampaignCondition, context.locale)}`, nodeId(`condition-text:${index}:${condition.id}`))],
  }));
  return {
    kind: 'document',
    schemaVersion: 1,
    document: {
      type: 'doc',
      attrs: { id: nodeId('root') },
      content: [
        headingNode(t.briefHeading, nodeId('brief-heading'), 1),
        textNode(input.brief, nodeId('brief-text')),
        headingNode(t.conditions, nodeId('conditions-heading')),
        ...(conditionNodes.length ? [{ type: 'bulletList' as const, attrs: { id: nodeId('conditions-list') }, content: conditionNodes }] : [textNode('—', nodeId('conditions-empty'))]),
        headingNode({ ru: 'Связанные результаты', kk: 'Байланысты нәтижелер', en: 'Linked results' }[context.locale], nodeId('linked-heading')),
        textNode(input.budgetRef ? t.budgetLinked : t.budgetMissing, nodeId('budget-text')),
      ],
    },
  };
}

async function authorizeSources(tx: PoolClient, access: WorkspaceAccess, input: BuildCampaignWorkInput, projectId: string) {
  for (const ref of input.sourceRefs) {
    const pinned = await readPinnedSource(tx, access, { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId });
    if (pinned.projectId !== projectId || pinned.sourceRef.revision !== ref.revision) throw new IdentityError('NOT_FOUND', 'campaigns.errors.sourceUnavailable');
  }
}

async function availableAssets(tx: PoolClient, access: WorkspaceAccess, input: BuildCampaignWorkInput, projectId: string) {
  const usable: string[] = [], rightsUnknown: string[] = [], unavailable: string[] = [];
  for (const assetId of input.assetRefs) {
    const row = (await tx.query<AssetRow>(`SELECT a.id,a.source_id,a.source_version_id,a.state,a.kind,a.license,s.project_id
      FROM source_assets a JOIN sources s ON s.workspace_id=a.workspace_id AND s.id=a.source_id
      WHERE a.workspace_id=$1 AND a.id=$2`, [access.workspace.id, assetId])).rows[0];
    if (!row || row.state !== 'ready' || row.kind !== 'image' || row.project_id !== projectId) { unavailable.push(assetId); continue; }
    try {
      const pinned = await readPinnedSource(tx, access, { sourceId: row.source_id, sourceVersionId: row.source_version_id });
      if (pinned.projectId !== projectId || !input.sourceRefs.some((ref) => ref.sourceId === row.source_id && ref.sourceVersionId === row.source_version_id && ref.revision === pinned.sourceRef.revision)) { unavailable.push(assetId); continue; }
      const license = SourceAssetLicenseSchema.parse(row.license);
      if (license.permission === 'confirmed' && license.canEmbed) usable.push(assetId);
      else rightsUnknown.push(assetId);
    } catch { unavailable.push(assetId); }
  }
  return { usable, rightsUnknown, unavailable };
}

async function readBudget(tx: PoolClient, artifacts: ArtifactService, actor: IdentityPrincipal, input: BuildCampaignWorkInput, context: WorkExecutionContext) {
  if (!input.budgetRef) return null;
  const detail = await artifacts.versionInTransaction(tx, actor, { workspaceId: context.workspaceId, artifactId: input.budgetRef.artifactId, revision: input.budgetRef.revision, expectedProjectId: context.projectId });
  if (!['table', 'document'].includes(detail.content.kind)) throw new IdentityError('VALIDATION_FAILED', 'campaigns.errors.budgetKind');
  return detail;
}

function campaignChecks(variants: ReturnType<typeof composeCampaignVariants>, assetState: Awaited<ReturnType<typeof availableAssets>>, budgetLinked: boolean, plan: ProposeWorkPlanResult | null) {
  const checks: BusinessWorkResult['checks'] = variants.flatMap((variant) => variant.checks.map((check) => ({
    code: `campaign.design.${check.code}`,
    status: check.status,
    targetIds: check.targetIds,
    sourceRefs: check.sourceRefs,
  })));
  checks.push({ code: 'campaign.assets.authorized', status: assetState.unavailable.length ? 'failed' : assetState.usable.length ? 'passed' : 'unknown', targetIds: assetState.unavailable, sourceRefs: [] });
  checks.push({ code: 'campaign.assets.export-rights', status: assetState.rightsUnknown.length ? 'unknown' : assetState.usable.length ? 'passed' : 'unknown', targetIds: assetState.rightsUnknown, sourceRefs: [] });
  checks.push({ code: 'campaign.budget.linked', status: budgetLinked ? 'passed' : 'unknown', targetIds: [], sourceRefs: [] });
  checks.push({ code: 'campaign.plan.feasible', status: !plan ? 'unknown' : plan.status === 'feasible' ? 'passed' : plan.status === 'infeasible' ? 'failed' : 'unknown', targetIds: plan?.changedEntryIds ?? [], sourceRefs: [] });
  return checks;
}

function campaignUnresolved(input: BuildCampaignWorkInput, assetState: Awaited<ReturnType<typeof availableAssets>>, plan: ProposeWorkPlanResult | null) {
  const unresolved: BusinessWorkResult['unresolved'] = [];
  if (!input.brandRef) unresolved.push({ code: 'campaign.brand.missing', targetIds: [], sourceRefs: [] });
  else unresolved.push({ code: 'campaign.brand.reader-unavailable', targetIds: input.brandRef.itemIds, sourceRefs: [] });
  if (!input.budgetRef) unresolved.push({ code: 'campaign.budget.missing', targetIds: [], sourceRefs: [] });
  if (!input.planInput) unresolved.push({ code: 'campaign.plan.missing', targetIds: [], sourceRefs: [] });
  for (const id of assetState.unavailable) unresolved.push({ code: 'campaign.asset.unavailable', targetIds: [id], sourceRefs: [] });
  for (const id of assetState.rightsUnknown) unresolved.push({ code: 'campaign.asset.export-rights', targetIds: [id], sourceRefs: [] });
  for (const issue of plan?.unresolved ?? []) unresolved.push({ code: `campaign.plan.${issue.code}`, targetIds: [issue.entryId], sourceRefs: issue.sourceRefs });
  for (const conflict of plan?.conflicts ?? []) unresolved.push({ code: `campaign.plan.${conflict.code}`, targetIds: conflict.entryIds, sourceRefs: conflict.sourceRefs });
  if (unresolved.length <= 200) return unresolved;
  return [...unresolved.slice(0, 199), { code: 'campaign.additional-unresolved', targetIds: [], sourceRefs: [] }];
}

export function createCampaignWorkService(dependencies: CampaignWorkDependencies) {
  const artifacts = dependencies.artifacts ?? createArtifactService(dependencies.pool);
  const planEngine = dependencies.plan ?? proposeWorkPlan;
  return async function run(rawInput: BuildCampaignWorkInput, rawContext: WorkExecutionContext): Promise<BusinessWorkResult> {
    const input = BuildCampaignWorkInputSchema.parse(rawInput), context = rawContext;
    assertAllowedInputs(input, context);
    const actor = dependencies.principalForContext?.(context) ?? principal(context), refs = uniqueRefs(input.sourceRefs), t = localized(context.locale);
    const result = await identityTransaction(dependencies.pool, async (tx) => withWorkspaceAccessInTransaction(tx, actor, {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      scope: 'edit',
      expectedAuthzVersion: context.expectedAuthzVersion,
    }, async (transaction, access) => {
      await authorizeSources(transaction, access, input, context.projectId);
      const assetState = await availableAssets(transaction, access, input, context.projectId);
      const budget = await readBudget(transaction, artifacts, actor, input, context);
      const variants = composeCampaignVariants({ brief: input.brief, conditions: input.conditions as CampaignCondition[], formats: input.formats, assetRefs: assetState.usable });
      let planned: ProposeWorkPlanResult | null = null;
      if (input.planInput) planned = await planEngine(input.planInput, {
        authorization: { workspaceId: context.workspaceId, actorId: actor.userId, authzVersion: context.expectedAuthzVersion },
        searchLimit: 100_000,
        readResources: (requested) => readPlanResourceSnapshotsInTransaction(transaction, access, requested),
      });

      const saved = [];
      const brief = await artifacts.createInTransaction(transaction, actor, derivedOperationId(context.operationId, 'brief'), {
        workspaceId: context.workspaceId, projectId: context.projectId, expectedAuthzVersion: context.expectedAuthzVersion,
        title: t.briefTitle, content: campaignDocument(input, context), sourceRefs: refs, bindings: [], accessClass: 'internal',
      });
      saved.push(brief);
      for (const variant of variants) {
        const artifact = await artifacts.createInTransaction(transaction, actor, derivedOperationId(context.operationId, `design:${variant.id}`), {
          workspaceId: context.workspaceId, projectId: context.projectId, expectedAuthzVersion: context.expectedAuthzVersion,
          title: `${t.briefTitle} · ${variant.id === 'editorial' ? t.editorial : t.split}`,
          content: variant.content, sourceRefs: refs, bindings: variant.bindings, accessClass: 'internal',
        });
        saved.push(artifact);
      }
      if (planned) {
        const linkedArtifactIds = [...saved.map((item) => item.artifact.id), ...(budget ? [budget.artifact.id] : [])];
        const content = JSON.parse(JSON.stringify({
          ...planned.candidate,
          entries: planned.candidate.entries.map((entry) => ({ ...entry, linkedArtifactIds: [...new Set([...(entry.linkedArtifactIds ?? []), ...linkedArtifactIds])] })),
        })) as typeof planned.candidate;
        saved.push(await artifacts.createInTransaction(transaction, actor, derivedOperationId(context.operationId, 'plan'), {
          workspaceId: context.workspaceId, projectId: context.projectId, expectedAuthzVersion: context.expectedAuthzVersion,
          title: { ru: 'План кампании', kk: 'Кампания жоспары', en: 'Campaign plan' }[context.locale], content, sourceRefs: refs, bindings: [], accessClass: 'internal',
        }));
      }
      const designs = saved.filter((item) => item.artifact.kind === 'design');
      return BusinessWorkResultSchema.parse({
        artifacts: saved,
        inputRevisionVector: { ...context.inputRevisionVector, ...(planned?.checkReceipt.inputRevisionVector ?? {}), ...(budget ? { [budget.artifact.id]: budget.version.revision } : {}) },
        checks: campaignChecks(variants, assetState, Boolean(budget), planned),
        unresolved: campaignUnresolved(input, assetState, planned),
        decision: {
          id: 'campaign-direction',
          options: designs.map((artifact, index) => ({ id: index === 0 ? 'editorial' : 'split', label: index === 0 ? t.editorial : t.split, artifactIds: [artifact.artifact.id] })),
          requiresConsent: true,
        },
        summary: t.summary,
      });
    }));
    return result;
  };
}

let defaultService: ReturnType<typeof createCampaignWorkService> | undefined;
export function buildCampaignWork(input: BuildCampaignWorkInput, context: WorkExecutionContext) {
  defaultService ??= createCampaignWorkService({ pool: getDatabasePool() });
  return defaultService(input, context);
}

