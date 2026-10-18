import { describe, expect, it } from 'vitest';
import { CreateRunSchema, ResumeRunSchema, RunDecisionSchema, RunEventSchema, RunProgressProjectionSchema, ToolReceiptSchema, UsdSchema } from '../../src/contracts/runs';
import { RUN_LIMITS, RunBudgetLimitSchema } from '../../src/features/runs/domain/limits';
import { addUsd, exceedsUsd, subtractUsd, usd, usdString } from '../../src/features/runs/domain/money';

const id = '11111111-1111-4111-8111-111111111111';
describe('canonical run contracts', () => {
  it('accepts explicit task input without caller-selected authority or provider routing', () => {
    const input = { workspaceId: id, projectId: null, capabilityId: 'sources.extract', capabilityVersion: 1, goal: 'Read the supplied invoice', locale: 'en', inputRefs: [] };
    expect(CreateRunSchema.parse(input)).toEqual(input);
    for (const extra of [{ createdBy: id }, { authzVersion: 1 }, { endpoint: 'openai' }, { budgetUsd: '10' }]) expect(CreateRunSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it('cannot expose raw prompts, reasoning, keys or arbitrary provider payloads in events/receipts', () => {
    const event = { id, runId: id, sequence: 1, at: '2026-10-14T00:00:00Z', kind: 'run_state', state: 'queued', resultRefs: [] };
    expect(RunEventSchema.parse(event)).toEqual(event);
    for (const extra of [{ prompt: 'private' }, { reasoning: 'private' }, { providerPayload: {} }, { apiKey: 'private' }]) expect(RunEventSchema.safeParse({ ...event, ...extra }).success).toBe(false);
    expect(ToolReceiptSchema.safeParse({ runId: id, stepId: id, toolCallId: 'call_1', inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64), resultRefs: [], committedAt: '2026-10-14T00:00:00Z', input: {} }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, kind: 'branch_state', branchId: 'capacity_check', branchState: 'running' }).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...event, kind: 'branch_state', branchId: 'capacity_check' }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, kind: 'projection_changed', projectionRevision: 4 }).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...event, kind: 'projection_changed', projectionRevision: 4, delta: 'raw model text' }).success).toBe(false);
  });
  it('exposes only a finite decision projection and a canonical selected option control', () => {
    const sourceRef = { sourceId: id, sourceVersionId: '22222222-2222-4222-8222-222222222222', revision: 1 };
    const capacityEvidence = { origin: 'source', resourceId: '33333333-3333-4333-8333-333333333333', availabilityVersionId: '44444444-4444-4444-8444-444444444444', verifiedAt: '2026-10-15T12:00:00Z', sourceRefs: [sourceRef] };
    const option = (optionId: string) => ({
      id: optionId, title: optionId, outcome: 'conditional',
      sourceRefs: [sourceRef],
      commercial: { currency: 'KZT', quotedTotal: '1200', directCost: '700', contribution: '500', contributionRate: '41.67' },
      deadline: { requestedDate: '2026-10-30', openingDate: null, earliestCompletionDate: '2026-10-30' },
      capacity: [{ scope: 'installation', requiredMinutes: 120, availableMinutes: 90, evidence: capacityEvidence }],
      factors: [{ code: 'capacity_gap', kind: 'condition', messageKey: 'runs.decision.capacityGap', args: { minutes: '30' }, sourceRefs: [] }],
    });
    const decision = { outcome: 'conditional', selectedOptionId: 'standard', options: [option('standard'), option('later')], differences: [{ leftOptionId: 'standard', rightOptionId: 'later', dimensions: ['price'] }] };
    expect(RunDecisionSchema.parse(decision)).toEqual(decision);
    expect(ResumeRunSchema.parse({ expectedEpoch: 2, selectedOptionId: 'standard', acceptedConditionIds: ['accept_conditions_standard'] })).toEqual({ expectedEpoch: 2, selectedOptionId: 'standard', acceptedConditionIds: ['accept_conditions_standard'] });
    expect(RunProgressProjectionSchema.safeParse({ plan: [], questions: [], summary: '', results: [], decision, messages: [] }).success).toBe(false);
    expect(RunDecisionSchema.safeParse({ ...decision, options: [...decision.options, { ...option('unsafe'), draft: { raw: true } }] }).success).toBe(false);
    expect(RunDecisionSchema.safeParse({ ...decision, options: [{ ...option('standard'), sourceRefs: [] }, option('later')] }).success).toBe(false);
    expect(RunDecisionSchema.safeParse({ ...decision, options: [{ ...option('standard'), sourceRefs: [{ ...sourceRef, rawFragment: 'private source text' }] }, option('later')] }).success).toBe(false);
    expect(RunDecisionSchema.safeParse({ ...decision, options: [{ ...option('standard'), capacity: [{ ...option('standard').capacity[0]!, evidence: { ...capacityEvidence, sourceRefs: [] } }] }, option('later')] }).success).toBe(false);
    expect(RunDecisionSchema.safeParse({ ...decision, options: [{ ...option('standard'), capacity: [{ ...option('standard').capacity[0]!, evidence: { origin: 'manual', resourceId: capacityEvidence.resourceId, availabilityVersionId: capacityEvidence.availabilityVersionId, verifiedAt: null, sourceRefs: [], rawAvailability: 'private schedule' } }] }, option('later')] }).success).toBe(false);
    expect(RunDecisionSchema.safeParse({ ...decision, selectedOptionId: 'missing' }).success).toBe(false);
    expect(ResumeRunSchema.safeParse({ expectedEpoch: 2, selectedOptionId: 'Bad option' }).success).toBe(false);
    expect(ResumeRunSchema.safeParse({ expectedEpoch: 2, acceptedConditionIds: ['select_option'] }).success).toBe(false);
    expect(ResumeRunSchema.safeParse({ expectedEpoch: 2, acceptedConditionIds: ['accept_conditions_standard', 'accept_conditions_standard'] }).success).toBe(false);
  });
  it('keeps fractional USD exact and rounds the conservative reservation upward', () => {
    expect(addUsd('0.1', '0.2')).toBe('0.3');
    expect(subtractUsd('0.5', '0.293888')).toBe('0.206112');
    expect(usdString(usd('0.0000000028').times(3))).toBe('0.0000000084');
    expect(usdString(usd('0.1').dividedBy(3))).toBe('0.033333333334');
    expect(exceedsUsd('0.3', '0.146944', '0.146944')).toBe(false);
    expect(exceedsUsd('0.3', '0.299999999999', '0.000000000002')).toBe(true);
    for (const invalid of ['1e-9', '-1', 'NaN', '0.0000000000001']) expect(UsdSchema.safeParse(invalid).success).toBe(false);
  });
  it('matches the persisted run budget boundaries exactly', () => {
    for (const valid of ['0.000000000001', '0.25', '0.50', '0.500000000000', RUN_LIMITS.runUsd]) expect(RunBudgetLimitSchema.safeParse(valid).success).toBe(true);
    for (const invalid of ['0', '-0.01', '0.500000000001', '1', '0.5000000000001', '1e-3', 'NaN']) expect(RunBudgetLimitSchema.safeParse(invalid).success).toBe(false);
  });
});
