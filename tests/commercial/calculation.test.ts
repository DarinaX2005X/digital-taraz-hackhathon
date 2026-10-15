import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateCalculation, recalculateEstimate, type CalculationCell } from '../../src/features/commercial/domain/calculation';
import { buildOffer, verifyObservedNumber, type OfferInput } from '../../src/features/commercial/domain/offer';
import type { CalculationSpec } from '../../src/contracts/calculations';
import { createArtifactState } from '../../src/features/artifacts/domain/content-state';

function fixture() {
  const spec: CalculationSpec = { schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up', lines: [
    { id: 'line1', quantityCellId: 'q1', priceCellId: 'p1', amountCellId: 'a1', expectedFormula: '=ROUND(B2*C2,2)' },
    { id: 'line2', quantityCellId: 'q2', priceCellId: 'p2', amountCellId: 'a2', expectedFormula: '=ROUND(B3*C3,2)' },
  ], subtotalCellId: 'subtotal', subtotalFormula: '=SUM(D2:D3)', discount: { rateCellId: 'discountRate', amountCellId: 'discount', expectedFormula: '=ROUND(D4*B5/100,2)' }, tax: { rateCellId: 'taxRate', amountCellId: 'tax', expectedFormula: '=ROUND((D4-D5)*B6/100,2)' }, totalCellId: 'total', totalFormula: '=D4-D5+D6' };
  const cells: Record<string, CalculationCell> = { q1: { value: '2.5' }, p1: { value: '19.99' }, q2: { value: '1' }, p2: { value: '0.1' }, a1: { formula: spec.lines[0]!.expectedFormula }, a2: { formula: spec.lines[1]!.expectedFormula }, subtotal: { formula: spec.subtotalFormula }, discountRate: { value: '7.5' }, discount: { formula: spec.discount!.expectedFormula }, taxRate: { value: '12' }, tax: { formula: spec.tax!.expectedFormula }, total: { formula: spec.totalFormula } };
  return { spec, cells };
}
const observed = (value: string) => ({ value, evidence: { origin: 'goal' as const, sourceId: null, fragmentId: null, raw: value, decimalSeparator: '.' as const, groupSeparator: 'none' as const } });
function offer(): OfferInput {
  return { title: 'Custom service quote', currency: 'KZT', introduction: 'A draft for the requested work.', lines: [{ label: 'Custom work', unit: 'hour', quantity: observed('2.5'), price: observed('19.99') }], discountRate: null, taxRate: null, terms: ['Delivery timing needs confirmation.'], requirements: [{ text: 'Requested custom work', status: 'answered', response: 'Included in the estimate.' }] };
}

describe('exact commercial calculations', () => {
  it('rounds each line and adjustment half-up, then totals the rounded amounts', () => {
    const { spec, cells } = fixture();
    expect(evaluateCalculation(spec, cells)).toMatchObject({ state: 'verified', subtotal: '50.08', total: '51.88', values: { a1: '49.98', a2: '0.10', discount: '3.76', tax: '5.56' } });
  });
  it('keeps values beyond binary integer precision exact', () => {
    const { spec, cells } = fixture(); delete spec.discount; delete spec.tax;
    cells.q1!.value = '9007199254740993'; cells.p1!.value = '0.01'; cells.q2!.value = '0';
    expect(evaluateCalculation(spec, cells).total).toBe('90071992547409.93');
  });
  it('distinguishes zero, unknown prices, deleted outputs and custom formulas', () => {
    const { spec, cells } = fixture(); cells.q1!.value = '0';
    expect(evaluateCalculation(spec, cells).values.a1).toBe('0.00');
    cells.p1!.value = '';
    expect(evaluateCalculation(spec, cells)).toMatchObject({ state: 'incomplete', total: null, missingIds: ['p1'] });
    cells.p1!.value = '19.99'; delete cells.a1;
    expect(evaluateCalculation(spec, cells)).toMatchObject({ state: 'incomplete', total: null, missingIds: ['a1'] });
    cells.a1 = { formula: '=999', value: '999' };
    expect(evaluateCalculation(spec, cells)).toMatchObject({ state: 'modified', modifiedIds: ['a1'] });
  });
  it('does not treat a user formula input as verified observed evidence', () => {
    const { spec, cells } = fixture(); cells.p1 = { formula: '=100/2', value: 50 };
    expect(evaluateCalculation(spec, cells)).toMatchObject({ state: 'modified', total: null, modifiedIds: ['p1'] });
  });
  it('builds two canonical editable artifacts and recalculates a direct price edit', () => {
    const result = buildOffer(offer(), { goal: '2.5 hours at 19.99 KZT', sources: [], locale: 'en', id: randomUUID });
    expect(result.calculation.total).toBe('49.98');
    expect(createArtifactState(result.table, result.sourceRefs, result.tableBindings).content.kind).toBe('table');
    expect(createArtifactState(result.document, result.sourceRefs, result.documentBindings).content.kind).toBe('document');
    const sheetId = result.table.workbook.sheetOrder[0]!, sheet = result.table.workbook.sheets[sheetId]!;
    sheet.cellData[1]![2]!.v = '20.00';
    expect(recalculateEstimate(result.table).results[sheetId]).toMatchObject({ state: 'verified', total: '50.00' });
    sheet.cellData[1]![3]!.f = '=7'; sheet.cellData[1]![3]!.v = '7';
    const modified = recalculateEstimate(result.table);
    expect(modified.results[sheetId]?.state).toBe('modified');
    expect(modified.content.workbook.sheets[sheetId]!.cellData[1]![3]).toMatchObject({ f: '=7', v: '7' });
  });
  it('uses the ISO currency scale instead of assuming two decimal places', () => {
    const jpy = offer(); jpy.currency = 'JPY'; jpy.lines[0]!.quantity = observed('2'); jpy.lines[0]!.price = observed('101');
    const yen = buildOffer(jpy, { goal: '2 hours at 101 JPY', sources: [], locale: 'en', id: randomUUID });
    expect(yen.calculation.total).toBe('202');
    expect(yen.table.workbook.sheets[yen.table.workbook.sheetOrder[0]!]!.calculation?.scale).toBe(0);
    const kwd = offer(); kwd.currency = 'KWD'; kwd.lines[0]!.quantity = observed('2'); kwd.lines[0]!.price = observed('1.234');
    const dinar = buildOffer(kwd, { goal: '2 hours at 1.234 KWD', sources: [], locale: 'en', id: randomUUID });
    expect(dinar.calculation.total).toBe('2.468');
    expect(dinar.table.workbook.sheets[dinar.table.workbook.sheetOrder[0]!]!.calculation?.scale).toBe(3);
  });
});

describe('numeric provenance', () => {
  it('rejects invented numbers, token substrings and unreviewed OCR', () => {
    expect(() => verifyObservedNumber(observed('125'), '1250 KZT', [])).toThrow('numericEvidence');
    expect(() => verifyObservedNumber({ value: '100', evidence: null }, '100 KZT', [])).toThrow('missingEvidence');
    const sourceRef = { sourceId: randomUUID(), sourceVersionId: randomUUID(), revision: 1 };
    const number = { value: '1250', evidence: { ...observed('1250').evidence, origin: 'source' as const, sourceId: sourceRef.sourceId, fragmentId: 'price-row', raw: '1 250', groupSeparator: 'space' as const } };
    const sources = [{ sourceRef, fragments: [{ id: 'price-row', values: ['Work', '1 250'], review: 'needs-review' as const }] }];
    expect(() => verifyObservedNumber(number, '', sources)).toThrow('numericEvidence');
    expect(verifyObservedNumber(number, '', [{ ...sources[0]!, fragments: [{ ...sources[0]!.fragments[0]!, review: 'observed' }] }])).toEqual(sourceRef);
  });
  it('leaves missing prices unknown and refuses invented currency', () => {
    const input = offer(); input.lines[0]!.price = { value: null, evidence: null };
    const draft = buildOffer(input, { goal: '2.5 hours, currency KZT; price unknown', sources: [], locale: 'en', id: randomUUID });
    expect(draft.calculation).toMatchObject({ state: 'incomplete', total: null });
    expect(JSON.stringify(draft.document)).toContain('Needs clarification');
    expect(() => buildOffer(input, { goal: '2.5 hours', sources: [], locale: 'en', id: randomUUID })).toThrow('currencyEvidence');
  });
});
