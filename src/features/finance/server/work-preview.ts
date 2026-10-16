import type { WorkPreviewArtifactRef, BusinessWorkPreview } from '@/contracts/work-preview';
import type { FinanceAnalysisInput, FinanceAnalysisResult } from '../contracts';

function roundRobin<T>(groups: readonly (readonly T[])[], limit: number) {
  const selected: T[] = [];
  for (let offset = 0; selected.length < limit; offset++) {
    let found = false;
    for (const group of groups) {
      if (group[offset] === undefined) continue;
      selected.push(group[offset]!);
      found = true;
      if (selected.length === limit) break;
    }
    if (!found) break;
  }
  return selected;
}

export function createFinanceWorkPreview(
  input: FinanceAnalysisInput,
  result: FinanceAnalysisResult,
  editable: WorkPreviewArtifactRef,
): Extract<BusinessWorkPreview, { kind: 'finance' }> {
  const assumptions = roundRobin(input.scenarios.map((scenario) => scenario.assumptions.map((item) => ({
    scenarioId: scenario.id,
    id: item.id,
    title: item.title.slice(0, 160),
    effectiveOn: item.effectiveOn,
    direction: item.direction,
    amountMinorUnits: item.amount?.minorUnits ?? null,
    confirmed: item.confirmed,
  }))), 12);
  const calendar = roundRobin(result.scenarios.map((scenario) => scenario.calendar.map((row) => ({
    scenarioId: scenario.id,
    date: row.date,
    knownInflowsMinorUnits: row.knownInflowsMinorUnits,
    knownOutflowsMinorUnits: row.knownOutflowsMinorUnits,
    closingBalanceMinorUnits: row.closingBalanceMinorUnits,
    unknownCount: row.unknownItemIds.length,
  }))), 24);
  return {
    kind: 'finance',
    editable,
    currency: result.currency,
    period: result.period,
    scenarios: result.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      accounting: scenario.accounting,
      knownIncomeMinorUnits: scenario.knownIncomeMinorUnits,
      knownExpenseMinorUnits: scenario.knownExpenseMinorUnits,
      knownResultMinorUnits: scenario.knownResultMinorUnits,
      closingBalanceMinorUnits: scenario.closingBalanceMinorUnits,
      minimumBalanceMinorUnits: scenario.minimumBalanceMinorUnits,
      unknownCount: scenario.unknownItemIds.length,
    })),
    assumptions,
    assumptionCount: input.scenarios.reduce((count, scenario) => count + scenario.assumptions.length, 0),
    calendar,
    calendarRowCount: result.scenarios.reduce((count, scenario) => count + scenario.calendar.length, 0),
  };
}
