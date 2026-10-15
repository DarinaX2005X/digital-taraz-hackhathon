import { describe, expect, it } from 'vitest';
import { materialFilterValue, moneyFilterScalar, valueText } from '../../src/features/materials/domain/display';

describe('exact values displayed and searched in the materials table', () => {
  it('displays large prices without passing through a floating point number', () => {
    expect(valueText({ kind:'money', minorUnits:'999999999999999999', currency:'KZT' }, 'Unknown')).toBe('9999999999999999.99 KZT');
    expect(valueText({ kind:'money', minorUnits:'0', currency:'JPY' }, 'Unknown')).toBe('0 JPY');
    expect(valueText({ kind:'money', minorUnits:'-5', currency:'KZT', adjustmentReason:'return' }, 'Unknown')).toBe('-0.05 KZT');
    expect(valueText({ kind:'unknown', reason:'empty' }, 'Неизвестно')).toBe('Неизвестно');
  });
  it('converts a person’s money filter to exact minor units without guessing or rounding', () => {
    expect(moneyFilterScalar('1,25','KZT')).toBe('125');
    expect(moneyFilterScalar('9999999999999999.99','KZT')).toBe('999999999999999999');
    expect(moneyFilterScalar('-0.00','KZT')).toBe('0');
    expect(moneyFilterScalar('12.345','KZT')).toBeNull();
    expect(moneyFilterScalar('12.5','JPY')).toBeNull();
    expect(moneyFilterScalar('1e3','KZT')).toBeNull();
  });
  it('turns typed facet values into reusable filter input without changing units', () => {
    expect(materialFilterValue({ kind:'money', minorUnits:'12345', currency:'KZT' })).toBe('123.45');
    expect(materialFilterValue({ kind:'quantity', decimal:'2.5', unit:'kg' })).toBe('2.5');
    expect(materialFilterValue({ kind:'unknown', reason:'empty' })).toBeNull();
  });
});
