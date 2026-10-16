import { describe, expect, it } from 'vitest';
import { analyzeFinance } from '@/features/finance/domain/analyze-finance';
import { buildFinanceArtifacts } from '@/features/finance/domain/artifact-builders';

const ref = { sourceId: '10000000-0000-4000-8000-000000000001', sourceVersionId: '10000000-0000-4000-8000-000000000002', revision: 1 };
const money = (minorUnits: string) => ({ currency: 'KZT', minorUnits });

describe('finance scenario analysis', () => {
  it('keeps accrual recognition separate from cash timing and treats returns as expense', () => {
    const result = analyzeFinance({
      currency: 'KZT', accounting: 'accrual', openingBalance: money('10000'), period: { start: '2026-10-01', end: '2026-10-31' }, excludedTransactionIds: [],
      transactions: [
        { id: 'sale_1', kind: 'sale', occurredOn: '2026-10-02', cashDate: '2026-11-03', amount: money('9000'), status: 'observed', sourceRefs: [ref], note: '' },
        { id: 'return_1', kind: 'return', occurredOn: '2026-10-04', cashDate: '2026-10-08', amount: money('2500'), status: 'observed', sourceRefs: [ref], note: '' },
      ],
      scenarios: [{ id: 'base', title: 'Base', assumptions: [] }],
    });
    expect(result.scenarios[0]).toMatchObject({ knownIncomeMinorUnits: '9000', knownExpenseMinorUnits: '2500', knownResultMinorUnits: '6500', closingBalanceMinorUnits: '7500' });
    expect(result.scenarios[0]!.calendar).toEqual([expect.objectContaining({ date: '2026-10-08', knownOutflowsMinorUnits: '2500' })]);
  });

  it('never turns missing cash timing or an unknown amount into zero', () => {
    const result = analyzeFinance({
      currency: 'KZT', accounting: 'cash', openingBalance: money('5000'), period: { start: '2026-10-01', end: '2026-10-31' }, excludedTransactionIds: [],
      transactions: [
        { id: 'known_cost', kind: 'cost', occurredOn: '2026-10-02', cashDate: '2026-10-05', amount: money('6000'), status: 'observed', sourceRefs: [ref], note: '' },
        { id: 'unknown_receipt', kind: 'sale', occurredOn: '2026-10-03', cashDate: null, amount: money('8000'), status: 'observed', sourceRefs: [ref], note: '' },
        { id: 'unknown_amount', kind: 'payment-in', occurredOn: '2026-10-06', cashDate: null, amount: null, status: 'observed', sourceRefs: [ref], note: '' },
      ],
      scenarios: [{ id: 'base', title: 'Base', assumptions: [] }],
    });
    expect(result.scenarios[0]).toMatchObject({ closingBalanceMinorUnits: null, minimumBalanceMinorUnits: null });
    expect(result.scenarios[0]!.unknownItemIds).toEqual(['unknown_amount', 'unknown_receipt']);
    expect(result.coverage.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['cash-date-unknown', 'amount-unknown']));
  });

  it('reports a known negative balance and only counts real exclusions', () => {
    const result = analyzeFinance({
      currency: 'KZT', accounting: 'cash', openingBalance: money('1000'), period: { start: '2026-10-01', end: '2026-10-31' }, excludedTransactionIds: ['missing_id', 'cost_ignored'],
      transactions: [
        { id: 'cost_live', kind: 'payment-out', occurredOn: '2026-10-03', cashDate: null, amount: money('1500'), status: 'observed', sourceRefs: [], note: '' },
        { id: 'cost_ignored', kind: 'payment-out', occurredOn: '2026-10-04', cashDate: null, amount: money('500'), status: 'observed', sourceRefs: [], note: '' },
      ], scenarios: [{ id: 'base', title: 'Base', assumptions: [] }],
    });
    expect(result.scenarios[0]).toMatchObject({ closingBalanceMinorUnits: '-500', minimumBalanceMinorUnits: '-500' });
    expect(result.coverage).toMatchObject({ acceptedTransactions: 1, excludedTransactions: 1 });
  });

  it('builds canonical editable workbook and report artifacts', () => {
    const input = {
      currency: 'KZT' as const, accounting: 'cash' as const, openingBalance: money('1000'), period: { start: '2026-10-01', end: '2026-10-31' }, excludedTransactionIds: [],
      transactions: [{ id: 'sale_1', kind: 'payment-in' as const, occurredOn: '2026-10-02', cashDate: null, amount: money('9000'), status: 'observed' as const, sourceRefs: [ref], note: '' }],
      scenarios: [{ id: 'base', title: 'Base', assumptions: [] }],
    };
    const built = buildFinanceArtifacts(input, analyzeFinance(input), 'ru');
    expect(built.workbook.workbook.sheetOrder).toEqual(['finance_overview', 'cash_calendar', 'transactions', 'assumptions', 'coverage']);
    expect(built.workbook.workbook.sheets.finance_overview?.charts?.[0]?.valueColumnIds).toEqual(['result']);
    expect(built.report.document.type).toBe('doc');
    expect(built.sourceRefs).toEqual([ref]);
    expect(buildFinanceArtifacts(input, analyzeFinance(input), 'ru')).toEqual(built);
  });
});

