import { describe, expect, it } from 'vitest';
import { compareSuppliers } from '@/features/procurement/domain/compare-suppliers';
import { buildProcurementArtifacts } from '@/features/procurement/domain/artifact-builders';

const q = (decimal: string, unit = 'piece') => ({ decimal, unit });
const m = (minorUnits: string, currency = 'KZT') => ({ minorUnits, currency });
const base = {
  currency: 'KZT', asOf: '2026-10-16', deliveryDestination: 'Almaty',
  needs: [{ id: 'need_a', itemKey: 'cups', description: 'Paper cups', quantity: q('23'), requiredBy: '2026-10-25', sourceRefs: [] }],
  stock: [{ id: 'stock_old', itemKey: 'cups', quantity: q('100'), asOf: '2026-10-01', sourceRefs: [] }, { id: 'stock_new', itemKey: 'cups', quantity: q('3'), asOf: '2026-10-15', sourceRefs: [] }],
};

describe('procurement comparison', () => {
  it('normalizes stock, pack size, MOQ, delivery, discount, tax and lead time', () => {
    const result = compareSuppliers({ ...base, offers: [
      { id: 'offer_complete', supplierId: 'one', supplierName: 'Complete', itemKey: 'cups', packQuantity: q('10'), packPrice: m('1000'), minimumPacks: 3, delivery: m('500'), leadDays: 4, paymentTerms: 'Net 7', discountRatePercent: '10', taxRatePercent: '12', validThrough: '2026-10-20', fxRateToTarget: null, sourceRefs: [] },
      { id: 'offer_incomplete', supplierId: 'two', supplierName: 'Cheap?', itemKey: 'cups', packQuantity: q('20'), packPrice: m('1'), minimumPacks: 1, delivery: null, leadDays: 1, paymentTerms: 'Prepaid', discountRatePercent: '0', taxRatePercent: '0', validThrough: null, fxRateToTarget: null, sourceRefs: [] },
    ] });
    expect(result.candidates.find((item) => item.offerId === 'offer_complete')).toMatchObject({ netRequired: '20', packs: 3, deliveredQuantity: '30', knownTotalMinorUnits: '3528', eligible: true });
    expect(result.candidates.find((item) => item.offerId === 'offer_incomplete')).toMatchObject({ complete: false, eligible: false, missing: ['delivery'] });
    expect(result.recommendedOfferIds).toEqual(['offer_complete']);
    expect(result.draftOrder).toMatchObject({ status: 'ready', externalAction: 'none', lines: [expect.objectContaining({ offerId: 'offer_complete' })] });
  });

  it('does not rank missing FX or a late offer and allocates stock once across needs', () => {
    const needs = [
      { id: 'first', itemKey: 'cups', description: 'First', quantity: q('6'), requiredBy: '2026-10-20', sourceRefs: [] },
      { id: 'second', itemKey: 'cups', description: 'Second', quantity: q('6'), requiredBy: '2026-10-21', sourceRefs: [] },
    ];
    const offers = [
      { id: 'foreign', supplierId: 'fx', supplierName: 'FX unknown', itemKey: 'cups', packQuantity: q('5'), packPrice: m('100', 'USD'), minimumPacks: 1, delivery: m('10', 'USD'), leadDays: 1, paymentTerms: 'Prepaid', discountRatePercent: '0', taxRatePercent: '0', validThrough: null, fxRateToTarget: null, sourceRefs: [] },
      { id: 'late', supplierId: 'late', supplierName: 'Late', itemKey: 'cups', packQuantity: q('5'), packPrice: m('100'), minimumPacks: 1, delivery: m('10'), leadDays: 30, paymentTerms: 'Net 7', discountRatePercent: '0', taxRatePercent: '0', validThrough: null, fxRateToTarget: null, sourceRefs: [] },
    ];
    const result = compareSuppliers({ ...base, needs, stock: [{ id: 'stock', itemKey: 'cups', quantity: q('8'), asOf: '2026-10-15', sourceRefs: [] }], offers });
    expect(result.candidates.find((item) => item.needId === 'second' && item.offerId === 'foreign')).toMatchObject({ netRequired: '4', complete: false, missing: ['fx-rate'] });
    expect(result.candidates.find((item) => item.offerId === 'late')).toMatchObject({ complete: true, eligible: false });
    expect(result.draftOrder).toMatchObject({ status: 'blocked', unresolvedNeedIds: ['second'] });
  });

  it('does not create an order when current stock fully covers the need', () => {
    const result = compareSuppliers({ ...base, stock: [{ id: 'stock', itemKey: 'cups', quantity: q('30'), asOf: '2026-10-15', sourceRefs: [] }], offers: [
      { id: 'unused', supplierId: 's', supplierName: 'Supplier', itemKey: 'cups', packQuantity: q('10'), packPrice: null, minimumPacks: null, delivery: null, leadDays: null, paymentTerms: null, discountRatePercent: null, taxRatePercent: null, validThrough: null, fxRateToTarget: null, sourceRefs: [] },
    ] });
    expect(result.candidates).toEqual([]);
    expect(result.draftOrder).toMatchObject({ status: 'ready', lines: [], unresolvedNeedIds: [], externalAction: 'none' });
  });

  it('builds a canonical comparison workbook and unsent order document', () => {
    const input = { ...base, offers: [
      { id: 'offer', supplierId: 'one', supplierName: 'Complete', itemKey: 'cups', packQuantity: q('10'), packPrice: m('1000'), minimumPacks: 1, delivery: m('500'), leadDays: 4, paymentTerms: 'Net 7', discountRatePercent: '0', taxRatePercent: '0', validThrough: null, fxRateToTarget: null, sourceRefs: [] },
    ] };
    const result = compareSuppliers(input), built = buildProcurementArtifacts(input, result, 'en');
    expect(built.workbook.workbook.sheetOrder).toEqual(['procurement_needs', 'procurement_candidates', 'procurement_order']);
    expect(JSON.stringify(built.order)).toContain('does not send anything');
    expect(result.draftOrder.externalAction).toBe('none');
  });
});

