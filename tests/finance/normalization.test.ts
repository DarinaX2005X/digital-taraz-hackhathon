import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SourceRef } from '../../src/contracts/artifacts';
import type { BuildFinanceWorkInput } from '../../src/contracts/business-work';
import type { DatasetRecord, MaterialCell, MaterialValue } from '../../src/contracts/materials';
import { normalizeFinanceRecords, normalizeFinanceScenarios } from '../../src/features/finance/server/normalization';

function financeInput(overrides: Partial<BuildFinanceWorkInput> = {}): BuildFinanceWorkInput {
  return {
    sourceRefs: [], query: { workspaceId: randomUUID(), collectionId: randomUUID(), filters: [], query: '', limit: 50, includeMissing: false },
    currency: 'KZT', accounting: 'cash', openingBalance: null, period: { start: '2026-10-01', end: '2026-10-31' },
    assumptionSets: [{ id: 'expected_inflow', title: 'Expected inflow', variables: [], calculation: { schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up', lines: [{ id: 'line', quantityCellId: 'quantity', priceCellId: 'price', amountCellId: 'amount', expectedFormula: '=quantity*price' }], subtotalCellId: 'subtotal', subtotalFormula: '=amount', totalCellId: 'total', totalFormula: '=subtotal' } }],
    ...overrides,
  };
}

function cell(sourceRef: SourceRef, value: MaterialValue): MaterialCell {
  return { value, rawValue: '', reviewState: 'observed', origin: 'observed', lineage: { fragmentId: randomUUID(), row: 2, column: 0 }, sourceRef, factRevision: sourceRef.factRevision! };
}

describe('finance normalization authority boundaries', () => {
  it('matches selected facts by semantic SourceRef identity rather than object property order', () => {
    const sourceId = randomUUID(), sourceVersionId = randomUUID(), collectionId = randomUUID(), recordId = randomUUID();
    const ref = (fieldId: string): SourceRef => ({ sourceId, sourceVersionId, revision: 1, collectionId, recordId, fieldId, factRevision: 1 });
    const reordered = (fieldId: string): SourceRef => ({ factRevision: 1, fieldId, recordId, collectionId, revision: 1, sourceVersionId, sourceId });
    const sourceRefs = ['kind', 'occurred_on', 'amount'].map(ref);
    const record: DatasetRecord = { recordId, label: 'Sale', missing: false, revision: 1, cells: {
      kind: cell(reordered('kind'), { kind: 'text', text: 'sale' }),
      occurred_on: cell(reordered('occurred_on'), { kind: 'date', date: '2026-10-05', precision: 'day' }),
      amount: cell(reordered('amount'), { kind: 'money', currency: 'KZT', minorUnits: '125000' }),
    } };
    const normalized = normalizeFinanceRecords([record], financeInput({ sourceRefs }));
    expect(normalized.transactions).toHaveLength(1);
    expect(normalized.transactions[0]).toMatchObject({ kind: 'sale', occurredOn: '2026-10-05', amount: { currency: 'KZT', minorUnits: '125000' } });
  });

  it('keeps a foreign-currency assumption unresolved instead of relabeling it as target currency', () => {
    const input = financeInput({ assumptionSets: [{
      id: 'expected_inflow', title: 'Expected inflow',
      variables: [{ id: 'quantity', value: { decimal: '2', unit: 'pcs' }, confirmed: true }, { id: 'price', value: { currency: 'USD', minorUnits: '1000' }, confirmed: true }, { id: 'settlement_date', value: '2026-10-20', confirmed: true }],
      calculation: { schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up', lines: [{ id: 'line', quantityCellId: 'quantity', priceCellId: 'price', amountCellId: 'amount', expectedFormula: '=quantity*price' }], subtotalCellId: 'subtotal', subtotalFormula: '=amount', totalCellId: 'total', totalFormula: '=subtotal' },
    }] });
    const normalized = normalizeFinanceScenarios(input);
    expect(normalized.scenarios[0]!.assumptions[0]).toMatchObject({ confirmed: false, amount: null });
    expect(normalized.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'finance.assumption.currency_mismatch', targetIds: ['expected_inflow', 'price'] })]));
  });
});
