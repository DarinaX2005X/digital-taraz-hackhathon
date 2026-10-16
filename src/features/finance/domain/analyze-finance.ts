import type { SourceRef } from '@/contracts/artifacts';
import { FinanceAnalysisInputSchema, FinanceAnalysisResultSchema, type FinanceAnalysisInput } from '../contracts';

type CalendarAccumulator = {
  inflow: bigint;
  outflow: bigint;
  unknown: Set<string>;
  refs: Map<string, SourceRef>;
};

const incomeKinds = new Set(['sale', 'receivable', 'payment-in']);
const expenseKinds = new Set(['return', 'cost', 'tax', 'payable', 'payment-out']);
const directCashKinds = new Set(['payment-in', 'payment-out']);
const refKey = (ref: SourceRef) => JSON.stringify(ref);

function addRef(target: CalendarAccumulator, ref: SourceRef) { target.refs.set(refKey(ref), ref); }
function rowAt(rows: Map<string, CalendarAccumulator>, date: string) {
  let row = rows.get(date);
  if (!row) { row = { inflow: 0n, outflow: 0n, unknown: new Set(), refs: new Map() }; rows.set(date, row); }
  return row;
}

function recognizedDate(item: FinanceAnalysisInput['transactions'][number], accounting: FinanceAnalysisInput['accounting']) {
  if (accounting === 'accrual') return item.occurredOn;
  if (directCashKinds.has(item.kind)) return item.occurredOn;
  return item.cashDate;
}

function cashDate(item: FinanceAnalysisInput['transactions'][number]) {
  return directCashKinds.has(item.kind) ? item.occurredOn : item.cashDate;
}

export function analyzeFinance(raw: FinanceAnalysisInput) {
  const input = FinanceAnalysisInputSchema.parse(raw);
  const excluded = new Set(input.excludedTransactionIds);
  const issues: Array<{ code: 'amount-unknown' | 'cash-date-unknown' | 'currency-mismatch' | 'outside-period' | 'excluded'; transactionId: string; sourceRefs: SourceRef[] }> = [];
  let acceptedTransactions = 0, excludedTransactions = 0;

  const base = input.transactions.flatMap((item) => {
    if (excluded.has(item.id)) { excludedTransactions += 1; issues.push({ code: 'excluded', transactionId: item.id, sourceRefs: item.sourceRefs }); return []; }
    if (!item.amount) { issues.push({ code: 'amount-unknown', transactionId: item.id, sourceRefs: item.sourceRefs }); }
    else if (item.amount.currency !== input.currency) { issues.push({ code: 'currency-mismatch', transactionId: item.id, sourceRefs: item.sourceRefs }); }
    const date = recognizedDate(item, input.accounting);
    if (!date && input.accounting === 'cash') issues.push({ code: 'cash-date-unknown', transactionId: item.id, sourceRefs: item.sourceRefs });
    else if (date && (date < input.period.start || date > input.period.end)) issues.push({ code: 'outside-period', transactionId: item.id, sourceRefs: item.sourceRefs });
    acceptedTransactions += 1;
    return [item];
  });

  const scenarios = input.scenarios.map((scenario) => {
    let income = 0n, expense = 0n;
    const unknown = new Set<string>();
    const calendar = new Map<string, CalendarAccumulator>();
    let undatedCashUnknown = false;

    for (const item of base) {
      const recognition = recognizedDate(item, input.accounting);
      if (!item.amount || item.amount.currency !== input.currency || !recognition) {
        unknown.add(item.id);
      } else if (recognition >= input.period.start && recognition <= input.period.end) {
        const amount = BigInt(item.amount.minorUnits);
        if (incomeKinds.has(item.kind)) income += amount;
        else if (expenseKinds.has(item.kind)) expense += amount;
      }

      const date = cashDate(item);
      if (!date && input.accounting === 'cash') undatedCashUnknown = true;
      if (!date || date < input.period.start || date > input.period.end) continue;
      const row = rowAt(calendar, date);
      for (const ref of item.sourceRefs) addRef(row, ref);
      if (!item.amount || item.amount.currency !== input.currency) row.unknown.add(item.id);
      else if (incomeKinds.has(item.kind)) row.inflow += BigInt(item.amount.minorUnits);
      else if (expenseKinds.has(item.kind)) row.outflow += BigInt(item.amount.minorUnits);
    }

    for (const assumption of scenario.assumptions) {
      if (assumption.effectiveOn < input.period.start || assumption.effectiveOn > input.period.end) continue;
      const row = rowAt(calendar, assumption.effectiveOn);
      if (assumption.sourceRef) addRef(row, assumption.sourceRef);
      if (!assumption.amount || assumption.amount.currency !== input.currency || !assumption.confirmed) {
        unknown.add(assumption.id); row.unknown.add(assumption.id); continue;
      }
      const amount = BigInt(assumption.amount.minorUnits);
      if (assumption.direction === 'inflow') { income += amount; row.inflow += amount; }
      else { expense += amount; row.outflow += amount; }
    }

    let balance = input.openingBalance?.currency === input.currency ? BigInt(input.openingBalance.minorUnits) : null;
    let minimum = balance;
    const rows = [...calendar.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, item]) => {
      const net = item.inflow - item.outflow;
      if (balance !== null && item.unknown.size === 0) { balance += net; minimum = minimum === null || balance < minimum ? balance : minimum; }
      else balance = null;
      return {
        date,
        knownInflowsMinorUnits: item.inflow.toString(),
        knownOutflowsMinorUnits: item.outflow.toString(),
        netKnownMinorUnits: net.toString(),
        closingBalanceMinorUnits: balance?.toString() ?? null,
        unknownItemIds: [...item.unknown].sort(),
        sourceRefs: [...item.refs.values()],
      };
    });
    if (undatedCashUnknown) { balance = null; minimum = null; }
    if (!input.openingBalance) unknown.add('opening_balance');
    for (const row of rows) for (const id of row.unknownItemIds) unknown.add(id);
    return {
      id: scenario.id,
      title: scenario.title,
      accounting: input.accounting,
      knownIncomeMinorUnits: income.toString(),
      knownExpenseMinorUnits: expense.toString(),
      knownResultMinorUnits: (income - expense).toString(),
      closingBalanceMinorUnits: balance?.toString() ?? null,
      minimumBalanceMinorUnits: minimum?.toString() ?? null,
      unknownItemIds: [...unknown].sort(),
      calendar: rows,
    };
  });

  return FinanceAnalysisResultSchema.parse({
    currency: input.currency,
    period: input.period,
    coverage: { acceptedTransactions, excludedTransactions, issues },
    scenarios,
  });
}

