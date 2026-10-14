import { describe, expect, it } from 'vitest';
import { CreateRunSchema, RunEventSchema, ToolReceiptSchema, UsdSchema } from '../../src/contracts/runs';
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
});
