import type { Locale } from '@/contracts/primitives';
import type { ArtifactContent } from '@/features/artifacts/domain/content-models';
import { bulletList, documentArtifact, heading, paragraph, uniqueSourceRefs, workbookArtifact } from '@/features/finance/domain/artifact-builders';
import type { ProcurementComparisonInput, ProcurementComparisonResult } from '../contracts';

const labels = {
  ru: { title: 'Сравнение закупки', needs: 'Потребность', candidates: 'Предложения', order: 'Черновик заказа', report: 'Черновик заказа поставщику', noSend: 'Черновик ничего не отправляет поставщику.', unresolved: 'Нерешённые позиции' },
  kk: { title: 'Сатып алуды салыстыру', needs: 'Қажеттілік', candidates: 'Ұсыныстар', order: 'Тапсырыс жобасы', report: 'Жеткізушіге тапсырыс жобасы', noSend: 'Жоба жеткізушіге ештеңе жібермейді.', unresolved: 'Шешілмеген позициялар' },
  en: { title: 'Procurement comparison', needs: 'Needs', candidates: 'Offers', order: 'Draft order', report: 'Supplier order draft', noSend: 'The draft does not send anything to a supplier.', unresolved: 'Unresolved lines' },
} as const;

export function buildProcurementArtifacts(input: ProcurementComparisonInput, result: ProcurementComparisonResult, locale: Locale): { workbook: Extract<ArtifactContent, { kind: 'table' }>; order: Extract<ArtifactContent, { kind: 'document' }>; sourceRefs: ProcurementComparisonInput['offers'][number]['sourceRefs'] } {
  const copy = labels[locale], moneyUnit = { kind: 'money', currency: input.currency };
  const needRows = input.needs.map((need, index) => ({ id: `need_${index}`, values: [need.id, need.itemKey, need.description, need.quantity.decimal, need.quantity.unit, need.requiredBy] }));
  const candidateRows = result.candidates.map((candidate, index) => ({ id: `candidate_${index}`, values: [candidate.offerId, candidate.needId, candidate.supplierName, candidate.netRequired, candidate.packs, candidate.deliveredQuantity, candidate.knownTotalMinorUnits, candidate.leadDays, candidate.arrivesOn, candidate.paymentTerms, candidate.complete, candidate.eligible, candidate.missing.join(', ')] }));
  const orderRows = result.draftOrder.lines.map((line, index) => ({ id: `order_${index}`, values: [line.needId, line.supplierName, line.itemKey, line.packs, line.deliveredQuantity.decimal, line.deliveredQuantity.unit, line.knownTotal.minorUnits, line.requiredBy, line.arrivesOn, line.paymentTerms] }));
  const workbook = workbookArtifact(copy.title, locale, [
    { id: 'procurement_needs', name: copy.needs, columns: [{ id: 'id', title: 'ID' }, { id: 'item', title: 'Item' }, { id: 'description', title: 'Description', width: 260 }, { id: 'quantity', title: 'Quantity' }, { id: 'unit', title: 'Unit' }, { id: 'required', title: 'Required by', unit: { kind: 'date' } }], rows: needRows },
    { id: 'procurement_candidates', name: copy.candidates, columns: [{ id: 'offer', title: 'Offer' }, { id: 'need', title: 'Need' }, { id: 'supplier', title: 'Supplier', width: 220 }, { id: 'net', title: 'Net need' }, { id: 'packs', title: 'Packs' }, { id: 'delivered', title: 'Delivered' }, { id: 'total', title: `Known total (${input.currency} minor)`, unit: moneyUnit }, { id: 'lead', title: 'Lead days' }, { id: 'arrival', title: 'Arrival', unit: { kind: 'date' } }, { id: 'payment', title: 'Payment terms', width: 200 }, { id: 'complete', title: 'Complete' }, { id: 'eligible', title: 'Eligible' }, { id: 'missing', title: 'Missing', width: 260 }], rows: candidateRows.length ? candidateRows : [{ id: 'candidates_empty', values: [null, null, null, null, null, null, null, null, null, null, false, false, 'stock-covered'] }] },
    { id: 'procurement_order', name: copy.order, columns: [{ id: 'need', title: 'Need' }, { id: 'supplier', title: 'Supplier' }, { id: 'item', title: 'Item' }, { id: 'packs', title: 'Packs' }, { id: 'quantity', title: 'Quantity' }, { id: 'unit', title: 'Unit' }, { id: 'total', title: `Total (${input.currency} minor)`, unit: moneyUnit }, { id: 'required', title: 'Required by', unit: { kind: 'date' } }, { id: 'arrival', title: 'Arrival', unit: { kind: 'date' } }, { id: 'payment', title: 'Payment terms' }], rows: orderRows.length ? orderRows : [{ id: 'order_empty', values: [null, null, null, 0, '0', null, '0', null, null, null] }] },
  ]);
  const order = documentArtifact([
    heading(copy.report), paragraph(`${input.asOf} · ${input.currency} · ${result.draftOrder.status}`), paragraph(copy.noSend), paragraph(`Destination: ${result.draftOrder.destination ?? 'unknown'}.`),
    ...result.draftOrder.lines.flatMap((line) => [heading(line.supplierName, 2), paragraph(`${line.description}: ${line.packs} packs / ${line.deliveredQuantity.decimal} ${line.deliveredQuantity.unit}; ${line.knownTotal.minorUnits} ${line.knownTotal.currency} minor units; arrival ${line.arrivesOn}; ${line.paymentTerms}.`)]),
    ...(result.draftOrder.unresolvedNeedIds.length ? [heading(copy.unresolved, 2), bulletList(result.draftOrder.unresolvedNeedIds)] : []),
  ]);
  return { workbook, order, sourceRefs: uniqueSourceRefs([...input.needs.flatMap((line) => line.sourceRefs), ...input.stock.flatMap((line) => line.sourceRefs), ...input.offers.flatMap((offer) => offer.sourceRefs)]) };
}

