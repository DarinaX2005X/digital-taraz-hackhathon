import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { CalculationSpecSchema, currencyMinorUnitScale, evaluateExactCalculation } from '@/contracts/calculations';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { assertPreparedCalculation, prepareCalculation } from '@/features/sheets/domain/calculation';
import { createBlankTable, stableCellId } from '@/features/sheets/domain/model';
import { materialValue } from '@/features/sheets/server/handlers';
import type { MaterialCell } from '@/contracts/materials';

function canonicalQuote(price = 420, staleTotal = '999999.00') {
  const content = createBlankTable('Commercial quote', { rows: 8, columns: 3 }), sheetId = content.workbook.sheetOrder[0]!, sheet = content.workbook.sheets[sheetId]!;
  const id = (row: number, column: number) => stableCellId(content, { sheetId, row, column });
  const lines = [
    { id: 'service', quantity: 180, price },
    { id: 'windows', quantity: 12, price: 1800 },
    { id: 'specialist', quantity: 8, price: 3900 },
    { id: 'delivery', quantity: 1, price: 3500 },
  ];
  for (const [row, line] of lines.entries()) sheet.cellData[row] = { 0: { v: line.quantity, t: 2 }, 1: { v: line.price, t: 2 }, 2: { f: `=ROUND(A${row + 1}*B${row + 1},2)`, v: 1, t: 2 } };
  sheet.cellData[4] = { 2: { f: '=SUM(C1:C4)', v: staleTotal, t: 1 } };
  sheet.cellData[5] = { 2: { f: '=C5', v: staleTotal, t: 1 } };
  sheet.calculation = {
    schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up',
    lines: lines.map((line, row) => ({ id: line.id, quantityCellId: id(row, 0), priceCellId: id(row, 1), amountCellId: id(row, 2), expectedFormula: `=ROUND(A${row + 1}*B${row + 1},2)` })),
    subtotalCellId: id(4, 2), subtotalFormula: '=SUM(C1:C4)', totalCellId: id(5, 2), totalFormula: '=C5',
  };
  return { content, sheetId, priceCellId: id(0, 1), totalCellId: id(5, 2) };
}

function prepared(price = 420) {
  const fixture = canonicalQuote(price);
  return {
    fixture,
    value: prepareCalculation({
      artifactId: randomUUID(), projectId: randomUUID(), baseRevision: 3,
      contentHash: hashJson(fixture.content as unknown as JsonValue), preparedAt: '2026-10-15T12:00:00.000Z',
      expectedSourceRevisions: {}, content: fixture.content, sheetId: fixture.sheetId,
    }),
  };
}

describe('server-authoritative prepared calculations', () => {
  it('ignores a forged cached total and derives the canonical fixture change exactly', () => {
    const before = prepared(420), after = prepared(485);
    expect(before.value.result.total).toBe('131900.00');
    expect(after.value.result.total).toBe('143600.00');
    expect(new Decimal(after.value.result.total!).minus(before.value.result.total!).toFixed(2)).toBe('11700.00');
    expect(before.value.exactInputs.find((input) => input.cellId === before.fixture.priceCellId)?.value).toBe('420');
    expect(before.value.formulaGraph.at(-1)).toMatchObject({ outputCellId: before.fixture.totalCellId, formula: '=C5' });
  });

  it('makes cached outputs and the complete prepared envelope tamper-evident', () => {
    const { value } = prepared(), forged = structuredClone(value);
    forged.result.total = '1.00';
    expect(() => assertPreparedCalculation(forged)).toThrow('sheets.errors.calculationPreparedHash');
    expect(assertPreparedCalculation(value)).toEqual(value);
  });

  it('uses ISO minor-unit scales and exact half-up rounding for JPY and KWD', () => {
    expect(currencyMinorUnitScale('JPY')).toBe(0);
    expect(currencyMinorUnitScale('KWD')).toBe(3);
    const calculation = (currency: 'JPY' | 'KWD', scale: number, quantity: string, price: string) => {
      const spec = CalculationSpecSchema.parse({ schemaVersion: 1, currency, scale, rounding: 'half-up', lines: [{ id: 'line', quantityCellId: 'qty', priceCellId: 'price', amountCellId: 'amount', expectedFormula: '=qty*price' }], subtotalCellId: 'subtotal', subtotalFormula: '=amount', totalCellId: 'total', totalFormula: '=subtotal' });
      return evaluateExactCalculation(spec, { qty: { value: quantity }, price: { value: price }, amount: { formula: '=qty*price' }, subtotal: { formula: '=amount' }, total: { formula: '=subtotal' } });
    };
    expect(calculation('JPY', 0, '1', '12.5').total).toBe('13');
    expect(calculation('KWD', 3, '1.005', '2.345').total).toBe('2.357');
    expect(() => CalculationSpecSchema.parse({ schemaVersion: 1, currency: 'JPY', scale: 2, rounding: 'half-up', lines: [{ id: 'line', quantityCellId: 'qty', priceCellId: 'price', amountCellId: 'amount', expectedFormula: '=qty*price' }], subtotalCellId: 'subtotal', subtotalFormula: '=amount', totalCellId: 'total', totalFormula: '=subtotal' })).toThrow();
    const cell = (currency: 'JPY' | 'KWD', minorUnits: string) => ({ value: { kind: 'money', currency, minorUnits }, reviewState: 'confirmed' } as MaterialCell);
    expect(materialValue(cell('JPY', '1250'))).toMatchObject({ v: 1250, t: 2 });
    expect(materialValue(cell('KWD', '1250'))).toMatchObject({ v: 1.25, t: 2 });
  });
});
