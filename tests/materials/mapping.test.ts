import { describe, expect, it } from 'vitest';
import { ImportMappingSchema, MaterialFieldSchema } from '../../src/contracts/materials';
import { cellsHash, compatibleFields, mapFragment, normalizeValue, parseExactNumber, recordKey } from '../../src/features/materials/domain/mapping';

const field = (changes: Record<string, unknown> = {}) => MaterialFieldSchema.parse({ id: 'price', label: 'Price', column: 1, header: 'Price', kind: 'money', ...changes });
const mapping = ImportMappingSchema.parse({ fields: [field({ id: 'sku', column: 0, header: 'SKU', kind: 'text' }), field()], headers: ['SKU', 'Price'], headerRow: 1, importMode: 'upsert', recordKeySpec: { kind: 'fields', fieldIds: ['sku'], trim: true, caseSensitive: true, confirmed: true } });
const sourceRef = { sourceId: '1055508f-463f-489a-af19-cb6dcc52d713', sourceVersionId: 'a564e8ae-e224-426c-b65d-57887ec922be', revision: 1 };
const row = (values: string[], index = 2) => mapFragment({ id: `row-${index}`, row: index, values, review: 'observed' }, mapping, sourceRef);

describe('confirmed mapping and exact business values', () => {
  it('normalizes decimal comma, grouped KZT and preserves exact integer minor units', () => {
    expect(normalizeValue('1 234,50 ₸', field({ decimalSeparator: ',', groupSeparator: 'space' }))).toEqual({ kind: 'money', minorUnits: '123450', currency: 'KZT' });
    expect(normalizeValue('9999999999999999.99', field())).toEqual({ kind: 'money', minorUnits: '999999999999999999', currency: 'KZT' });
    expect(normalizeValue('0', field())).toEqual({ kind: 'money', minorUnits: '0', currency: 'KZT' });
  });
  it('keeps unknown separate from zero and does not silently round money or accept malformed grouping', () => {
    expect(normalizeValue('', field())).toEqual({ kind: 'unknown', reason: 'empty' });
    expect(normalizeValue('12.345', field())).toEqual({ kind: 'unknown', reason: 'precision' });
    expect(parseExactNumber('12 34,50', field({ decimalSeparator: ',', groupSeparator: 'space' }))).toBeNull();
    expect(normalizeValue('USD 12', field())).toEqual({ kind: 'unknown', reason: 'number' });
  });
  it('requires an explicit return or correction meaning for negative amounts', () => {
    expect(normalizeValue('-50', field())).toEqual({ kind: 'unknown', reason: 'negative' });
    expect(normalizeValue('-50', field({ adjustmentReason: 'return' }))).toEqual({ kind: 'money', minorUnits: '-5000', currency: 'KZT', adjustmentReason: 'return' });
  });
  it('converts only declared compatible units and rejects conflicting suffixes', () => {
    expect(normalizeValue('2500 г', field({ kind: 'quantity', sourceUnit: 'g', unit: 'kg' }))).toEqual({ kind: 'quantity', decimal: '2.5', unit: 'kg' });
    expect(normalizeValue('4 л', field({ kind: 'quantity', sourceUnit: 'kg', unit: 'kg' }))).toEqual({ kind: 'unknown', reason: 'unit' });
    expect(normalizeValue('4', field({ kind: 'quantity', sourceUnit: 'l', unit: 'kg' }))).toEqual({ kind: 'unknown', reason: 'unit' });
  });
  it('checks real calendar dates without guessing month/day order', () => {
    expect(normalizeValue('29.02.2024', field({ kind: 'date', dateFormat: 'DD.MM.YYYY' }))).toEqual({ kind: 'date', date: '2024-02-29', precision: 'day' });
    expect(normalizeValue('29.02.2023', field({ kind: 'date', dateFormat: 'DD.MM.YYYY' }))).toEqual({ kind: 'unknown', reason: 'date' });
    expect(normalizeValue('03/04/2026', field({ kind: 'date', dateFormat: 'MM/DD/YYYY' }))).toEqual({ kind: 'date', date: '2026-03-04', precision: 'day' });
  });
  it('keeps record identity independent of row order and price while retaining original coordinates', () => {
    const old = row(['001', '10']), moved = row(['001', '12'], 99);
    expect(recordKey(old, mapping)).toEqual(recordKey(moved, mapping));
    expect(recordKey(old, mapping).hash).not.toBe(recordKey(row(['1', '10']), mapping).hash);
    expect(old.price!.lineage.row).toBe(2); expect(moved.price!.lineage.row).toBe(99);
    expect(cellsHash(old)).not.toBe(cellsHash(moved)); expect(cellsHash(old)).toBe(cellsHash(row(['001', '10'], 99)));
  });
  it('does not merge renamed or repriced rows using a fingerprint', () => {
    const withoutKey = ImportMappingSchema.parse({ ...mapping, recordKeySpec: { kind: 'fingerprint', confirmed: true } });
    expect(recordKey(row(['Lamp', '10']), withoutKey).hash).not.toBe(recordKey(row(['Lamp', '11']), withoutKey).hash);
    expect(recordKey(row(['Lamp', '10']), withoutKey).hash).not.toBe(recordKey(row(['Lamps', '10']), withoutKey).hash);
  });
  it('permits explicit column reorder but rejects replacing key semantics or units under an existing identity', () => {
    expect(compatibleFields(mapping, { ...mapping, fields: mapping.fields.map((item) => ({ ...item, column: 1 - item.column })), headers: ['Price', 'SKU'] })).toBe(true);
    expect(compatibleFields(mapping, { ...mapping, recordKeySpec: { kind: 'fingerprint', confirmed: true } })).toBe(false);
    expect(compatibleFields(mapping, { ...mapping, fields: mapping.fields.map((item) => ({ ...item, currency: 'USD' })) })).toBe(false);
  });
});
