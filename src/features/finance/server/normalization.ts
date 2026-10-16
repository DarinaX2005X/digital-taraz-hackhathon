import Decimal from 'decimal.js';
import type { SourceRef } from '@/contracts/artifacts';
import { currencyMinorUnitScale, evaluateExactCalculation } from '@/contracts/calculations';
import type { BuildFinanceWorkInput } from '@/contracts/business-work';
import type { DatasetRecord, MaterialCell, MaterialValue } from '@/contracts/materials';
import type { FinanceAssumption, FinanceTransaction } from '../contracts';

const Exact = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
const refKey = (ref: SourceRef) => [ref.sourceId, ref.sourceVersionId, ref.revision, ref.fragmentId ?? '', ref.collectionId ?? '', ref.recordId ?? '', ref.fieldId ?? '', ref.factRevision ?? ''].join('|');
const key = (value: string) => value.toLowerCase().replace(/[^a-zа-яёәғқңөұүһ0-9]+/g, '');
const aliases = (values: string[]) => new Set(values.map(key));
const kinds = aliases(['kind', 'type', 'transaction_kind', 'transaction_type', 'operation', 'операция', 'тип', 'түрі']);
const occurred = aliases(['occurred_on', 'occurredAt', 'date', 'transaction_date', 'sale_date', 'дата', 'күні']);
const cash = aliases(['cash_date', 'paid_on', 'payment_date', 'settlement_date', 'дата_оплаты', 'төлем_күні']);
const amount = aliases(['amount', 'sum', 'total', 'money', 'сумма', 'сомасы']);
const note = aliases(['note', 'description', 'comment', 'описание', 'комментарий', 'түсініктеме']);

function selectedCell(record: DatasetRecord, names: Set<string>, allowed?: ReadonlySet<string>) {
  return Object.entries(record.cells).find(([id, cell]) => names.has(key(id)) && (!allowed || allowed.has(refKey(cell.sourceRef))))?.[1];
}

const textValue = (cell: MaterialCell | undefined) => cell?.value.kind === 'text' ? cell.value.text.trim() : null;
const dateValue = (cell: MaterialCell | undefined) => cell?.value.kind === 'date' ? cell.value.date : null;
const refs = (record: DatasetRecord, allowed?: ReadonlySet<string>) => [...new Map(Object.values(record.cells).filter((cell) => !allowed || allowed.has(refKey(cell.sourceRef))).map((cell) => [refKey(cell.sourceRef), cell.sourceRef])).values()];

const kindMap: Record<string, FinanceTransaction['kind']> = {
  sale: 'sale', revenue: 'sale', income: 'sale', продажа: 'sale', сату: 'sale',
  return: 'return', refund: 'return', возврат: 'return', қайтарым: 'return',
  cost: 'cost', expense: 'cost', расход: 'cost', шығын: 'cost',
  tax: 'tax', налог: 'tax', салық: 'tax',
  receivable: 'receivable', дебиторка: 'receivable',
  payable: 'payable', кредиторка: 'payable',
  paymentin: 'payment-in', receipt: 'payment-in', поступление: 'payment-in',
  paymentout: 'payment-out', payment: 'payment-out', оплата: 'payment-out', төлем: 'payment-out',
};

function moneyValue(value: MaterialValue | undefined, currency: string) {
  if (!value || value.kind === 'unknown') return null;
  if (value.kind === 'money') return { currency: value.currency, minorUnits: new Exact(value.minorUnits).abs().toFixed(0) };
  if (value.kind === 'decimal') {
    const scale = currencyMinorUnitScale(currency);
    return { currency, minorUnits: new Exact(value.decimal).abs().times(new Exact(10).pow(scale)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0) };
  }
  return null;
}

export function normalizeFinanceRecords(records: DatasetRecord[], input: BuildFinanceWorkInput) {
  const allowedRefs = new Set(input.sourceRefs.map(refKey));
  const transactions: FinanceTransaction[] = [], unresolved: { code: string; targetIds: string[]; sourceRefs: SourceRef[] }[] = [];
  for (const record of records) {
    const recordRefs = refs(record, allowedRefs), kindCell = selectedCell(record, kinds, allowedRefs), dateCell = selectedCell(record, occurred, allowedRefs);
    const rawKind = textValue(kindCell), transactionKind = rawKind ? kindMap[key(rawKind)] : undefined, occurredOn = dateValue(dateCell);
    if (!transactionKind || !occurredOn) {
      unresolved.push({ code: !transactionKind ? 'finance.transaction.kind_unknown' : 'finance.transaction.date_unknown', targetIds: [record.recordId], sourceRefs: recordRefs });
      continue;
    }
    const amountCell = selectedCell(record, amount, allowedRefs), cashCell = selectedCell(record, cash, allowedRefs), noteCell = selectedCell(record, note, allowedRefs);
    transactions.push({
      id: record.recordId, kind: transactionKind, occurredOn, cashDate: dateValue(cashCell), amount: moneyValue(amountCell?.value, input.currency),
      status: Object.values(record.cells).some((cell) => cell.origin === 'assumed') ? 'assumed' : 'observed', sourceRefs: recordRefs, note: textValue(noteCell) ?? record.label,
    });
  }
  return { transactions, unresolved };
}

function direction(value: string): FinanceAssumption['direction'] | null {
  const normalized = key(value);
  if (/(outflow|expense|cost|payable|purchase|tax|расход|затрат|закуп|шығын|салық)/.test(normalized)) return 'outflow';
  if (/(inflow|income|revenue|sale|receivable|доход|выруч|продаж|кіріс|сату)/.test(normalized)) return 'inflow';
  return null;
}

function majorToMinor(value: string, currency: string) {
  return new Exact(value).times(new Exact(10).pow(currencyMinorUnitScale(currency))).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
}

/** Evaluates caller-provided exact formula graphs and exposes only dated, directed, confirmed cash assumptions. */
export function normalizeFinanceScenarios(input: BuildFinanceWorkInput) {
  const unresolved: { code: string; targetIds: string[]; sourceRefs: SourceRef[] }[] = [];
  const scenarios = input.assumptionSets.map((set) => {
    const cells: Record<string, { value?: string | number | boolean | null; formula?: string }> = {};
    let currenciesMatch = true;
    for (const variable of set.variables) {
      if (variable.value && typeof variable.value === 'object' && 'minorUnits' in variable.value) {
        if (variable.value.currency === input.currency) cells[variable.id] = { value: new Exact(variable.value.minorUnits).div(new Exact(10).pow(currencyMinorUnitScale(variable.value.currency))).toFixed() };
        else {
          currenciesMatch = false;
          unresolved.push({ code: 'finance.assumption.currency_mismatch', targetIds: [set.id, variable.id], sourceRefs: variable.sourceRef ? [variable.sourceRef] : [] });
        }
      }
      else if (variable.value && typeof variable.value === 'object' && 'decimal' in variable.value) cells[variable.id] = { value: variable.value.decimal };
    }
    for (const line of set.calculation.lines) cells[line.amountCellId] = { formula: line.expectedFormula };
    cells[set.calculation.subtotalCellId] = { formula: set.calculation.subtotalFormula };
    if (set.calculation.discount) cells[set.calculation.discount.amountCellId] = { formula: set.calculation.discount.expectedFormula };
    if (set.calculation.tax) cells[set.calculation.tax.amountCellId] = { formula: set.calculation.tax.expectedFormula };
    cells[set.calculation.totalCellId] = { formula: set.calculation.totalFormula };
    const calculation = evaluateExactCalculation(set.calculation, cells);
    const flow = direction(`${set.id} ${set.title}`), date = set.variables.find((variable) => typeof variable.value === 'string' && variable.confirmed)?.value as string | undefined;
    const sourceRefs = set.variables.flatMap((variable) => variable.sourceRef ? [variable.sourceRef] : []);
    const confirmed = currenciesMatch && calculation.state === 'verified' && calculation.total !== null && flow !== null && date !== undefined && set.variables.every((variable) => variable.confirmed);
    if (calculation.state !== 'verified') unresolved.push({ code: 'finance.assumption.calculation_incomplete', targetIds: [set.id, ...calculation.missingIds], sourceRefs });
    if (!flow) unresolved.push({ code: 'finance.assumption.direction_unknown', targetIds: [set.id], sourceRefs });
    if (!date) unresolved.push({ code: 'finance.assumption.date_unknown', targetIds: [set.id], sourceRefs });
    const assumption: FinanceAssumption = {
      id: `${set.id}_total`, title: set.title, effectiveOn: date ?? input.period.end, direction: flow ?? 'outflow',
      amount: calculation.total === null ? null : { currency: input.currency, minorUnits: majorToMinor(calculation.total, input.currency) }, confirmed,
      ...(sourceRefs[0] ? { sourceRef: sourceRefs[0] } : {}),
    };
    return { id: set.id, title: set.title, assumptions: [assumption] };
  });
  return { scenarios, unresolved };
}

