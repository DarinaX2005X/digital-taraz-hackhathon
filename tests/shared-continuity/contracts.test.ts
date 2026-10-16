import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  BusinessContextReadSchema,
  PrepareWorkChangesInputSchema,
  StartWorkOccurrenceResultSchema,
  WorkExecutionContextSchema,
  WorkRuleDefinitionSchema,
} from '@/contracts/business-work';
import { CreateExportSchema, ExportReleaseSchema } from '@/features/exports/contracts';
import {
  artifactVersionComments,
  artifactVersionDecisions,
  businessContextVersions,
  businessContexts,
  businessContinuityOperations,
  outcomeObservations,
  workOccurrences,
  workRuleVersions,
  workRules,
} from '@/server/db/business-continuity-schema';

const ids = {
  workspace: '00000000-0000-4000-8000-000000000001',
  project: '00000000-0000-4000-8000-000000000002',
  context: '00000000-0000-4000-8000-000000000003',
  user: '00000000-0000-4000-8000-000000000004',
  source: '00000000-0000-4000-8000-000000000005',
  occurrence: '00000000-0000-4000-8000-000000000006',
};

describe('shared business continuity contracts', () => {
  it('keeps legacy work execution contexts readable while accepting frozen context selections', () => {
    const legacy = WorkExecutionContextSchema.parse({
      authority: { kind: 'user', userId: ids.user },
      operationId: ids.occurrence,
      workspaceId: ids.workspace,
      projectId: ids.project,
      expectedAuthzVersion: 1,
      allowedInputRefs: [],
      inputRevisionVector: {},
      cancelEpoch: 0,
      locale: 'ru',
    });
    expect(legacy.allowedBusinessContextRefs).toBeUndefined();

    const recurring = WorkExecutionContextSchema.parse({
      ...legacy,
      authority: { kind: 'rule', userId: ids.user, ruleId: ids.context, ruleVersion: 2, occurrenceId: ids.occurrence },
      allowedBusinessContextRefs: [{ contextId: ids.context, revision: 3, itemIds: ['customer-name'] }],
    });
    expect(recurring.authority.kind).toBe('rule');
    expect(recurring.allowedBusinessContextRefs).toHaveLength(1);
  });

  it('validates typed context values, explicit confirmation, and unique selected items', () => {
    const valid = {
      ref: { kind: 'business-context' as const, id: ids.context, revision: 4 },
      items: [{
        id: 'supplier-terms',
        category: 'supplier' as const,
        label: 'Условия поставщика',
        value: { kind: 'money' as const, value: { currency: 'KZT', minorUnits: '120000' } },
        sourceRefs: [],
        confirmed: true,
        ownerId: ids.user,
      }],
      brandKit: { assetRefs: [], colors: ['#0A6C5A'], fontFamilies: ['Inter'], voiceRules: ['Писать конкретно'] },
      permissions: { read: true as const, edit: true, confirm: true },
    };
    expect(BusinessContextReadSchema.parse(valid).items[0]?.confirmed).toBe(true);
    expect(BusinessContextReadSchema.safeParse({ ...valid, items: [...valid.items, valid.items[0]] }).success).toBe(false);
    expect(BusinessContextReadSchema.safeParse({ ...valid, brandKit: { ...valid.brandKit, colors: ['green'] } }).success).toBe(false);
  });

  it('freezes rule selectors, trigger policy, review boundary, and bounded budget', () => {
    const definition = {
      goal: 'Сверить поставки и подготовить результат',
      sourceSelectors: [{ sourceId: ids.source, required: true }],
      contextRefs: [{ contextId: ids.context, revision: 4, itemIds: ['supplier-terms'] }],
      capability: { id: 'business.prepare', version: 1 },
      procedureVersion: 2,
      trigger: { kind: 'schedule' as const, rrule: 'FREQ=DAILY;BYHOUR=9', timezone: 'Asia/Almaty' },
      timezone: 'Asia/Almaty',
      outputPolicy: { mode: 'new-branch' as const, baseArtifact: null, reviewRequired: true as const, externalEffects: 'forbidden' as const },
      budget: { maximumUsd: '0.25', maxOccurrencesPerDay: 2 },
    };
    expect(WorkRuleDefinitionSchema.parse(definition).trigger.kind).toBe('schedule');
    expect(WorkRuleDefinitionSchema.safeParse({ ...definition, sourceSelectors: [{ sourceId: ids.source, required: true, collectionId: ids.context }] }).success).toBe(false);
    expect(WorkRuleDefinitionSchema.safeParse({ ...definition, sourceSelectors: [...definition.sourceSelectors, definition.sourceSelectors[0]] }).success).toBe(false);
  });

  it('rejects duplicate prepared artifacts and malformed occurrence reason codes', () => {
    expect(PrepareWorkChangesInputSchema.safeParse({ projectId: ids.project, artifactIds: [ids.context, ids.context], sourceRevisionVector: {} }).success).toBe(false);
    expect(StartWorkOccurrenceResultSchema.safeParse({ occurrenceId: ids.occurrence, runId: null, branchId: null, state: 'paused', reused: true, reasonCode: 'access.revoked' }).success).toBe(true);
    expect(StartWorkOccurrenceResultSchema.safeParse({ occurrenceId: ids.occurrence, runId: null, branchId: null, state: 'paused', reused: true, reasonCode: 'Access revoked' }).success).toBe(false);
  });

  it('keeps release metadata separate from the private-field policy and rejects duplicate omissions', () => {
    const release = { projectId: ids.project, title: 'Пакет для согласования', audience: 'Закупочная комиссия', knownOmissions: ['Без подписей'] };
    expect(ExportReleaseSchema.parse(release)).toEqual(release);
    expect(ExportReleaseSchema.safeParse({ ...release, knownOmissions: ['Без подписей', 'Без подписей'] }).success).toBe(false);
    const request = CreateExportSchema.parse({
      workspaceId: ids.workspace,
      expectedAuthzVersion: 2,
      locale: 'ru',
      privateFieldsPolicy: 'exclude-internal',
      release,
      items: [{ artifactId: ids.context, revision: 0, formats: ['pdf'] }],
    });
    expect(request.release).toEqual(release);
    expect(request.privateFieldsPolicy).toBe('exclude-internal');
  });
});

describe('business continuity persistence boundary', () => {
  it('exports one canonical Drizzle table per persisted aggregate', () => {
    expect([
      businessContexts,
      businessContextVersions,
      artifactVersionComments,
      artifactVersionDecisions,
      workRules,
      workRuleVersions,
      workOccurrences,
      outcomeObservations,
      businessContinuityOperations,
    ].map(getTableName)).toEqual([
      'business_contexts',
      'business_context_versions',
      'artifact_version_comments',
      'artifact_version_decisions',
      'work_rules',
      'work_rule_versions',
      'work_occurrences',
      'outcome_observations',
      'business_continuity_operations',
    ]);
  });

  it('keeps immutable-version, exact-evidence, idempotency, and lifecycle constraints in migration 0024', async () => {
    const migration = await readFile(new URL('../../migrations/0024_business_continuity.sql', import.meta.url), 'utf8');
    expect(migration).toContain('UNIQUE(workspace_id,context_id,revision)');
    expect(migration).toContain('REFERENCES artifact_versions(workspace_id,artifact_id,revision) ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES work_rule_versions(workspace_id,rule_id,version)');
    expect(migration).toContain("state IN ('completed','failed','cancelled'))=(completed_at IS NOT NULL)");
    expect(migration).toContain('PRIMARY KEY(workspace_id,actor_id,operation_id)');
    expect(migration).toContain("jsonb_typeof(result)='object' AND octet_length(result::text)<=262144");
  });
});
