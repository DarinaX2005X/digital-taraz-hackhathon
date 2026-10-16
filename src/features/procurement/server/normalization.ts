import Decimal from 'decimal.js';
import type { SourceRef } from '@/contracts/artifacts';
import type { BoundFact, MaterialCell, MaterialValue } from '@/contracts/materials';
import type { BuildProcurementWorkInput } from '@/contracts/business-work';
import type { ProcurementComparisonInput, StockLine, SupplierOffer } from '../contracts';

const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
const normalized = (value: string) => value.toLowerCase().replace(/[^a-zа-яёәғқңөұүһ0-9]+/g, '');
const alias = (...values: string[]) => new Set(values.map(normalized));
const fields = {
  supplierId: alias('supplier_id', 'supplierId', 'поставщик_id', 'жеткізуші_id'), supplierName: alias('supplier_name', 'supplier', 'поставщик', 'жеткізуші'),
  itemKey: alias('item_key', 'sku', 'item', 'product_code', 'товар', 'артикул', 'тауар'), packQuantity: alias('pack_quantity', 'pack_size', 'units_per_pack', 'упаковка', 'қаптама'),
  packPrice: alias('pack_price', 'price', 'цена_упаковки', 'бағасы'), minimumPacks: alias('minimum_packs', 'moq', 'minimum_order', 'минзаказ', 'еңазтапсырыс'),
  delivery: alias('delivery', 'delivery_cost', 'доставка', 'жеткізу'), leadDays: alias('lead_days', 'delivery_days', 'срок_поставки', 'жеткізукүні'),
  paymentTerms: alias('payment_terms', 'terms', 'условия_оплаты', 'төлемшарттары'), discount: alias('discount_rate', 'discount_percent', 'скидка', 'жеңілдік'),
  tax: alias('tax_rate', 'tax_percent', 'vat', 'ндс', 'налог', 'салық'), validThrough: alias('valid_through', 'valid_until', 'действует_до', 'дейінжарамды'),
  fx: alias('fx_rate', 'exchange_rate', 'курс', 'бағам'), stockQuantity: alias('stock_quantity', 'on_hand', 'quantity', 'остаток', 'қалдық'), stockDate: alias('as_of', 'stock_date', 'дата_остатка', 'қалдықкүні'),
} as const;

type Group = { id: string; label: string; refs: SourceRef[]; cells: Map<string, MaterialCell> };
function groupFacts(facts: BoundFact[]) {
  const groups = new Map<string, Group>();
  for (const fact of facts) {
    const ref = fact.requestedRef, cell = fact.pinned;
    if (!ref.recordId || !ref.fieldId || !cell || !fact.canBind) continue;
    let group = groups.get(ref.recordId);
    if (!group) { group = { id: ref.recordId, label: cell.labels.record, refs: [], cells: new Map() }; groups.set(ref.recordId, group); }
    group.refs.push(ref); group.cells.set(normalized(ref.fieldId), cell);
  }
  return [...groups.values()];
}

function cell(group: Group, names: ReadonlySet<string>) { return [...group.cells.entries()].find(([name]) => names.has(name))?.[1]; }
function value(group: Group, names: ReadonlySet<string>) { return cell(group, names)?.value; }
function text(raw: MaterialValue | undefined) { return raw?.kind === 'text' ? raw.text.trim() : null; }
function decimal(raw: MaterialValue | undefined) { return raw?.kind === 'decimal' ? raw.decimal : raw?.kind === 'quantity' ? raw.decimal : null; }
function integer(raw: MaterialValue | undefined) { const candidate = decimal(raw); return candidate !== null && new Exact(candidate).isInteger() ? Number(candidate) : null; }
function money(raw: MaterialValue | undefined) { return raw?.kind === 'money' && !new Exact(raw.minorUnits).isNegative() ? { currency: raw.currency, minorUnits: raw.minorUnits } : null; }
function date(raw: MaterialValue | undefined) { return raw?.kind === 'date' ? raw.date : null; }
function quantity(raw: MaterialValue | undefined, fallbackUnit: string) { return raw?.kind === 'quantity' && !new Exact(raw.decimal).isNegative() ? { decimal: raw.decimal, unit: raw.unit } : { decimal: '0', unit: fallbackUnit }; }

export function normalizeProcurementFacts(input: BuildProcurementWorkInput, offerFacts: BoundFact[], stockFacts: BoundFact[], asOf: string) {
  const unresolved: { code: string; targetIds: string[]; sourceRefs: SourceRef[] }[] = [];
  const needUnit = new Map(input.needLines.map((line) => [line.itemKey, line.quantity.unit]));
  const offers: SupplierOffer[] = [];
  for (const group of groupFacts(offerFacts)) {
    const itemKey = text(value(group, fields.itemKey));
    if (!itemKey) { unresolved.push({ code: 'procurement.offer.item_unknown', targetIds: [group.id], sourceRefs: group.refs }); continue; }
    const fallbackUnit = needUnit.get(itemKey) ?? 'unknown';
    offers.push({
      id: group.id, supplierId: text(value(group, fields.supplierId)) ?? group.id, supplierName: text(value(group, fields.supplierName)) ?? group.label,
      itemKey, packQuantity: quantity(value(group, fields.packQuantity), fallbackUnit), packPrice: money(value(group, fields.packPrice)), minimumPacks: integer(value(group, fields.minimumPacks)),
      delivery: money(value(group, fields.delivery)), leadDays: integer(value(group, fields.leadDays)), paymentTerms: text(value(group, fields.paymentTerms)),
      discountRatePercent: decimal(value(group, fields.discount)), taxRatePercent: decimal(value(group, fields.tax)), validThrough: date(value(group, fields.validThrough)), fxRateToTarget: decimal(value(group, fields.fx)),
      sourceRefs: group.refs,
    });
  }
  const stock: StockLine[] = [];
  for (const group of groupFacts(stockFacts)) {
    const itemKey = text(value(group, fields.itemKey)), rawQuantity = value(group, fields.stockQuantity), stockDate = date(value(group, fields.stockDate));
    if (!itemKey || rawQuantity?.kind !== 'quantity' || !stockDate || new Exact(rawQuantity.decimal).isNegative()) {
      unresolved.push({ code: 'procurement.stock.incomplete', targetIds: [group.id], sourceRefs: group.refs }); continue;
    }
    stock.push({ id: group.id, itemKey, quantity: { decimal: rawQuantity.decimal, unit: rawQuantity.unit }, asOf: stockDate, sourceRefs: group.refs });
  }
  const comparison: ProcurementComparisonInput = {
    currency: input.currency, asOf, deliveryDestination: input.deliveryDestination,
    needs: input.needLines.map((line) => ({ ...line, description: line.itemKey })), stock, offers,
  };
  if (!offers.length) unresolved.push({ code: 'procurement.offers.unavailable', targetIds: input.needLines.map((line) => line.id), sourceRefs: input.offerSourceRefs });
  return { comparison, unresolved };
}

