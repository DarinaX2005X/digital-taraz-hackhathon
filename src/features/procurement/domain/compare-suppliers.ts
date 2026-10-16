import Decimal from 'decimal.js';
import type { SourceRef } from '@/contracts/artifacts';
import { ProcurementComparisonInputSchema, ProcurementComparisonResultSchema, type ProcurementComparisonInput } from '../contracts';

const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
const dateAfter = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
};
const refs = (...sets: SourceRef[][]) => [...new Map(sets.flat().map((ref) => [JSON.stringify(ref), ref])).values()];

function convertMinorUnits(amount: { currency: string; minorUnits: string }, target: string, rate: string | null) {
  if (amount.currency === target) return BigInt(amount.minorUnits);
  if (rate === null) return null;
  return BigInt(new Exact(amount.minorUnits).times(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

export function compareSuppliers(raw: ProcurementComparisonInput) {
  const input = ProcurementComparisonInputSchema.parse(raw);
  const latestStockDate = new Map<string, string>();
  for (const line of input.stock) if (line.asOf <= input.asOf && (!latestStockDate.has(line.itemKey) || line.asOf > latestStockDate.get(line.itemKey)!)) latestStockDate.set(line.itemKey, line.asOf);
  const stock = new Map<string, { quantity: Decimal; unit: string }>();
  for (const line of input.stock) {
    if (line.asOf !== latestStockDate.get(line.itemKey)) continue;
    const current = stock.get(line.itemKey);
    if (!current) stock.set(line.itemKey, { quantity: new Exact(line.quantity.decimal), unit: line.quantity.unit });
    else if (current.unit === line.quantity.unit) current.quantity = current.quantity.plus(line.quantity.decimal);
  }
  const remainingStock = new Map([...stock.entries()].map(([key, value]) => [key, { quantity: new Exact(value.quantity), unit: value.unit }]));
  const netByNeed = new Map<string, Decimal>();
  for (const need of [...input.needs].sort((left, right) => (left.requiredBy ?? '9999-12-31').localeCompare(right.requiredBy ?? '9999-12-31') || left.id.localeCompare(right.id))) {
    const available = remainingStock.get(need.itemKey), required = new Exact(need.quantity.decimal);
    if (!available || available.unit !== need.quantity.unit) { netByNeed.set(need.id, required); continue; }
    const used = Decimal.min(required, available.quantity);
    netByNeed.set(need.id, required.minus(used)); available.quantity = available.quantity.minus(used);
  }
  const candidates: Array<{
    offerId: string; needId: string; supplierId: string; supplierName: string; itemKey: string; unit: string; netRequired: string;
    packs: number | null; deliveredQuantity: string | null; knownTotalMinorUnits: string | null; currency: string; leadDays: number | null;
    arrivesOn: string | null; paymentTerms: string | null; complete: boolean; eligible: boolean;
    missing: Array<'unit' | 'pack-size' | 'pack-price' | 'minimum-packs' | 'delivery' | 'lead-time' | 'payment-terms' | 'discount' | 'tax' | 'fx-rate' | 'delivery-destination' | 'expired'>; sourceRefs: SourceRef[];
  }> = [];

  for (const need of input.needs) {
    const available = stock.get(need.itemKey);
    const compatibleStock = !available || available.unit === need.quantity.unit;
    const netRequired = netByNeed.get(need.id) ?? new Exact(need.quantity.decimal);
    if (netRequired.isZero()) continue;
    for (const offer of input.offers.filter((item) => item.itemKey === need.itemKey)) {
      const missing: typeof candidates[number]['missing'] = [];
      if (offer.packQuantity.unit !== need.quantity.unit || !compatibleStock) missing.push('unit');
      if (new Exact(offer.packQuantity.decimal).lessThanOrEqualTo(0)) missing.push('pack-size');
      if (!offer.packPrice) missing.push('pack-price');
      if (offer.minimumPacks === null) missing.push('minimum-packs');
      if (!offer.delivery) missing.push('delivery');
      if (offer.leadDays === null) missing.push('lead-time');
      if (!offer.paymentTerms) missing.push('payment-terms');
      if (offer.discountRatePercent === null) missing.push('discount');
      if (offer.taxRatePercent === null) missing.push('tax');
      if (!input.deliveryDestination) missing.push('delivery-destination');
      if (offer.validThrough !== null && offer.validThrough < input.asOf) missing.push('expired');
      const packPrice = offer.packPrice ? convertMinorUnits(offer.packPrice, input.currency, offer.fxRateToTarget) : null;
      const delivery = offer.delivery ? convertMinorUnits(offer.delivery, input.currency, offer.fxRateToTarget) : null;
      if ((offer.packPrice !== null && offer.packPrice.currency !== input.currency || offer.delivery !== null && offer.delivery.currency !== input.currency) && offer.fxRateToTarget === null) missing.push('fx-rate');
      let packs: number | null = null, deliveredQuantity: string | null = null, knownTotalMinorUnits: string | null = null;
      if (!missing.includes('unit') && !missing.includes('pack-size') && offer.minimumPacks !== null) {
        const rawPacks = netRequired.div(offer.packQuantity.decimal).ceil();
        packs = Math.max(Number(rawPacks.toFixed(0)), offer.minimumPacks);
        deliveredQuantity = new Exact(offer.packQuantity.decimal).times(packs).toString();
      }
      if (packs !== null && packPrice !== null && delivery !== null && offer.discountRatePercent !== null && offer.taxRatePercent !== null) {
        const subtotal = new Exact((packPrice * BigInt(packs) + delivery).toString());
        const discounted = subtotal.minus(subtotal.times(offer.discountRatePercent).div(100));
        knownTotalMinorUnits = BigInt(discounted.plus(discounted.times(offer.taxRatePercent).div(100)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)).toString();
      }
      const complete = missing.length === 0 && knownTotalMinorUnits !== null && offer.leadDays !== null;
      const arrivesOn = offer.leadDays === null ? null : dateAfter(input.asOf, offer.leadDays);
      candidates.push({
        offerId: offer.id, needId: need.id, supplierId: offer.supplierId, supplierName: offer.supplierName, itemKey: need.itemKey,
        unit: need.quantity.unit, netRequired: netRequired.toString(), packs, deliveredQuantity, knownTotalMinorUnits,
        currency: input.currency, leadDays: offer.leadDays, arrivesOn, paymentTerms: offer.paymentTerms,
        complete, eligible: complete && (need.requiredBy === null || arrivesOn! <= need.requiredBy), missing: [...new Set(missing)],
        sourceRefs: refs(need.sourceRefs, offer.sourceRefs, input.stock.filter((line) => line.itemKey === need.itemKey).flatMap((line) => line.sourceRefs)),
      });
    }
  }

  const recommendedOfferIds: string[] = [], orderLines = [], unresolvedNeedIds: string[] = [];
  for (const need of input.needs) {
    if ((netByNeed.get(need.id) ?? new Exact(need.quantity.decimal)).isZero()) continue;
    const ranked = candidates.filter((item) => item.needId === need.id && item.eligible && item.knownTotalMinorUnits !== null)
      .sort((left, right) => {
        const delta = BigInt(left.knownTotalMinorUnits!) - BigInt(right.knownTotalMinorUnits!);
        return delta === 0n ? (left.leadDays! - right.leadDays!) : delta < 0n ? -1 : 1;
      });
    const winner = ranked[0];
    if (!winner || winner.packs === null || winner.deliveredQuantity === null || winner.arrivesOn === null || winner.paymentTerms === null || winner.knownTotalMinorUnits === null) { unresolvedNeedIds.push(need.id); continue; }
    recommendedOfferIds.push(winner.offerId);
    orderLines.push({
      needId: need.id, offerId: winner.offerId, itemKey: need.itemKey, description: need.description,
      supplierId: winner.supplierId, supplierName: winner.supplierName, packs: winner.packs,
      deliveredQuantity: { decimal: winner.deliveredQuantity, unit: winner.unit },
      knownTotal: { currency: input.currency, minorUnits: winner.knownTotalMinorUnits },
      requiredBy: need.requiredBy, arrivesOn: winner.arrivesOn, paymentTerms: winner.paymentTerms, sourceRefs: winner.sourceRefs,
    });
  }
  const status = unresolvedNeedIds.length === 0 ? 'ready' : orderLines.length ? 'partial' : 'blocked';
  return ProcurementComparisonResultSchema.parse({
    currency: input.currency,
    candidates,
    recommendedOfferIds,
    draftOrder: { status, destination: input.deliveryDestination, lines: orderLines, unresolvedNeedIds, externalAction: 'none' },
  });
}

