import Decimal from 'decimal.js';
import { z } from 'zod';
import { CurrencySchema, IdSchema, LocaleSchema } from '../../../contracts/primitives';
import type { SourceRef, FieldBinding } from '../../../contracts/artifacts';
import type { SourceFragment } from '../../../contracts/sources';
import { currencyMinorUnitScale, type CalculationSpec } from '../../../contracts/calculations';
import type { ArtifactContent, DocumentNode, TableCell } from '../../artifacts/domain/content-models';
import { tableCellTargetId } from '../../artifacts/domain/targets';
import { validateArtifactContent } from '../../artifacts/domain/semantic-validation';
import { parseExactNumber } from '../../materials/domain/mapping';
import { evaluateCalculation, type CalculationCell } from './calculation';

const EvidenceSchema = z.strictObject({ origin: z.enum(['goal', 'source', 'artifact']), sourceId: IdSchema.nullable(), artifactId: IdSchema.nullable().optional(), fragmentId: z.string().max(160).nullable(), raw: z.string().min(1).max(100), decimalSeparator: z.enum(['.', ',']), groupSeparator: z.enum(['none', 'space', '.', ',']) });
export const ObservedNumberSchema = z.strictObject({ value: z.string().max(60).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).nullable(), evidence: EvidenceSchema.nullable() });
export const OfferSchema = z.strictObject({
  title: z.string().min(1).max(240), currency: CurrencySchema,
  introduction: z.string().max(4000),
  lines: z.array(z.strictObject({ label: z.string().min(1).max(500), unit: z.string().min(1).max(40), quantity: ObservedNumberSchema, price: ObservedNumberSchema })).min(1).max(40),
  discountRate: ObservedNumberSchema.nullable(), taxRate: ObservedNumberSchema.nullable(),
  terms: z.array(z.string().min(1).max(2000)).max(20),
  requirements: z.array(z.strictObject({ text: z.string().min(1).max(1500), status: z.enum(['answered', 'question', 'excluded']), response: z.string().min(1).max(2000) })).min(1).max(40),
});
export type OfferInput = z.infer<typeof OfferSchema>;
export type EvidenceSource = { sourceRef: SourceRef; fragments: SourceFragment[] };
export type EvidenceArtifact = { artifactId: string; targets: { targetId: string; text: string; sourceRef: SourceRef | null }[] };

function containsToken(text: string, token: string) {
  let start = text.indexOf(token);
  while (start >= 0) {
    const before = text[start - 1] ?? '', after = text[start + token.length] ?? '';
    if (!/[\d.,]/.test(before) && !/[\d.,]/.test(after)) return true;
    start = text.indexOf(token, start + 1);
  }
  return false;
}
export function verifyObservedNumber(number: z.infer<typeof ObservedNumberSchema>, goal: string, sources: EvidenceSource[], artifacts: EvidenceArtifact[] = []): SourceRef | null {
  if (number.value === null) { if (number.evidence !== null) throw new Error('commercial.errors.unknownEvidence'); return null; }
  const evidence = number.evidence;
  if (!evidence) throw new Error('commercial.errors.missingEvidence');
  const parsed = parseExactNumber(evidence.raw, evidence);
  if (parsed === null || !new Decimal(parsed).equals(number.value)) throw new Error('commercial.errors.numericEvidence');
  if (evidence.origin === 'goal') {
    if (evidence.sourceId !== null || evidence.artifactId || evidence.fragmentId !== null || !containsToken(goal, evidence.raw)) throw new Error('commercial.errors.numericEvidence');
    return null;
  }
  if (evidence.origin === 'artifact') {
    const target = artifacts.find((artifact) => artifact.artifactId === evidence.artifactId)?.targets.find((item) => item.targetId === evidence.fragmentId);
    if (evidence.sourceId !== null || !target || !containsToken(target.text, evidence.raw)) throw new Error('commercial.errors.numericEvidence');
    return target.sourceRef;
  }
  if (evidence.artifactId) throw new Error('commercial.errors.numericEvidence');
  const source = sources.find((item) => item.sourceRef.sourceId === evidence.sourceId);
  const fragment = source?.fragments.find((item) => item.id === evidence.fragmentId);
  if (!source || !fragment || fragment.review !== 'observed' || ![fragment.text ?? '', ...(fragment.values ?? [])].some((text) => containsToken(text, evidence.raw))) throw new Error('commercial.errors.numericEvidence');
  return { ...source.sourceRef, ...(IdSchema.safeParse(fragment.id).success ? { fragmentId: fragment.id } : {}) };
}
const copy = {
  ru: { item: 'Работа / товар', quantity: 'Количество', price: 'Цена', amount: 'Сумма', subtotal: 'Подытог', discount: 'Скидка', tax: 'Налог', total: 'Итого', estimate: 'Смета', terms: 'Условия', requirements: 'Запрос и ответы', unknown: 'Нужно уточнить', unanswered: 'Вопрос', excluded: 'Не входит', rate: 'Ставка, %', noTax: 'Налог и скидка не включены, если ставка не указана в исходных данных.' },
  kk: { item: 'Жұмыс / тауар', quantity: 'Саны', price: 'Бағасы', amount: 'Сома', subtotal: 'Аралық сома', discount: 'Жеңілдік', tax: 'Салық', total: 'Барлығы', estimate: 'Смета', terms: 'Шарттар', requirements: 'Сұрау және жауаптар', unknown: 'Нақтылау қажет', unanswered: 'Сұрақ', excluded: 'Қамтылмайды', rate: 'Мөлшерлеме, %', noTax: 'Бастапқы деректерде мөлшерлеме көрсетілмесе, салық пен жеңілдік қосылмаған.' },
  en: { item: 'Work / item', quantity: 'Quantity', price: 'Price', amount: 'Amount', subtotal: 'Subtotal', discount: 'Discount', tax: 'Tax', total: 'Total', estimate: 'Estimate', terms: 'Terms', requirements: 'Request and responses', unknown: 'Needs clarification', unanswered: 'Question', excluded: 'Excluded', rate: 'Rate, %', noTax: 'Tax and discount are not included unless a rate is supplied in the inputs.' },
};
export function buildOffer(raw: OfferInput, options: { goal: string; sources: EvidenceSource[]; artifacts?: EvidenceArtifact[]; locale: z.infer<typeof LocaleSchema>; id: () => string }) {
  const input = OfferSchema.parse(raw), { id } = options, text = copy[options.locale];
  const scale = currencyMinorUnitScale(input.currency);
  const allText = [options.goal, ...options.sources.flatMap((source) => source.fragments.flatMap((fragment) => [fragment.text ?? '', ...(fragment.values ?? [])])), ...(options.artifacts ?? []).flatMap((artifact) => artifact.targets.map((target) => target.text))].join('\n');
  const currencyTokens: Record<string, string[]> = { KZT: ['KZT', '₸', 'тенге', 'теңге', 'тг'], USD: ['USD', '$'], EUR: ['EUR', '€'], RUB: ['RUB', '₽', 'руб'] };
  if (!(currencyTokens[input.currency] ?? [input.currency]).some((token) => allText.toLocaleLowerCase().includes(token.toLocaleLowerCase()))) throw new Error('commercial.errors.currencyEvidence');
  const sheetId = id(), count = input.lines.length, rowCount = count + 8, rows = Array.from({ length: rowCount }, id), columns = Array.from({ length: 5 }, id);
  const cellId = (row: number, column: number) => tableCellTargetId(sheetId, rows[row]!, columns[column]!);
  const cellData: Record<string, Record<string, TableCell>> = {}, cells: Record<string, CalculationCell> = {}, tableBindings: FieldBinding[] = [];
  const set = (row: number, column: number, value: string | null, formula?: string) => {
    const cell = { v: value ?? '', t: 1, ...(formula ? { f: formula } : {}) }; (cellData[row] ??= {})[column] = cell;
    cells[cellId(row, column)] = { value, formula };
  };
  [text.item, text.quantity, text.price, text.amount, input.currency].forEach((value, column) => set(0, column, value));
  const spec: CalculationSpec = { schemaVersion: 1, currency: input.currency, scale, rounding: 'half-up', lines: [], subtotalCellId: cellId(count + 1, 3), subtotalFormula: `=IF(COUNT(D2:D${count + 1})=${count},SUM(D2:D${count + 1}),"")`, totalCellId: cellId(count + 4, 3), totalFormula: '' };
  const amountFields: { tableCellId: string; documentFieldId: string; sourceRef: SourceRef | null }[] = [];
  const sourceRefs = options.sources.map((source) => source.sourceRef);
  const includeRef = (ref: SourceRef | null) => { if (ref && !sourceRefs.some((item) => JSON.stringify(item) === JSON.stringify(ref))) sourceRefs.push(ref); };
  for (const [index, line] of input.lines.entries()) {
    const row = index + 1, n = row + 1;
    const quantityRef = verifyObservedNumber(line.quantity, options.goal, options.sources, options.artifacts), priceRef = verifyObservedNumber(line.price, options.goal, options.sources, options.artifacts);
    includeRef(quantityRef); includeRef(priceRef);
    const formula = `=IF(B${n}="","",IF(C${n}="","",ROUND(B${n}*C${n},${scale})))`;
    set(row, 0, `${line.label} (${line.unit})`); set(row, 1, line.quantity.value); set(row, 2, line.price.value); set(row, 3, null, formula);
    spec.lines.push({ id: id(), quantityCellId: cellId(row, 1), priceCellId: cellId(row, 2), amountCellId: cellId(row, 3), expectedFormula: formula });
    for (const [column, ref] of [[1, quantityRef], [2, priceRef]] as const) if (ref) tableBindings.push({ targetElementId: cellId(row, column), sourceRef: ref, transformId: 'source-number', updateMode: 'propose' });
    amountFields.push({ tableCellId: cellId(row, 3), documentFieldId: id(), sourceRef: priceRef ?? quantityRef ?? sourceRefs[0] ?? null });
  }
  const subtotalRow = count + 1, discountRow = count + 2, taxRow = count + 3, totalRow = count + 4;
  set(subtotalRow, 0, text.subtotal); set(subtotalRow, 3, null, spec.subtotalFormula);
  const adjustment = (number: OfferInput['taxRate'], row: number, label: string, base: string) => {
    if (!number) return undefined;
    const ref = verifyObservedNumber(number, options.goal, options.sources, options.artifacts);
    includeRef(ref);
    if (number.value && new Decimal(number.value).greaterThan(100)) throw new Error('commercial.errors.rate');
    const expectedFormula = `=IF(${base}="","",IF(B${row + 1}="","",ROUND(${base}*B${row + 1}/100,${scale})))`;
    set(row, 0, label); set(row, 1, number.value); set(row, 3, null, expectedFormula);
    if (ref) tableBindings.push({ targetElementId: cellId(row, 1), sourceRef: ref, transformId: 'source-number', updateMode: 'propose' });
    return { rateCellId: cellId(row, 1), amountCellId: cellId(row, 3), expectedFormula };
  };
  const discount = adjustment(input.discountRate, discountRow, text.discount, `D${subtotalRow + 1}`);
  if (discount) spec.discount = discount;
  const base = spec.discount ? `(D${subtotalRow + 1}-D${discountRow + 1})` : `D${subtotalRow + 1}`;
  const tax = adjustment(input.taxRate, taxRow, text.tax, base);
  if (tax) spec.tax = tax;
  const guards = [`D${subtotalRow + 1}`, ...(spec.discount ? [`D${discountRow + 1}`] : []), ...(spec.tax ? [`D${taxRow + 1}`] : [])];
  spec.totalFormula = '=' + guards.reduceRight((expression, guard) => `IF(${guard}="","",${expression})`, `${base}${spec.tax ? `+D${taxRow + 1}` : ''}`);
  set(totalRow, 0, text.total); set(totalRow, 3, null, spec.totalFormula);
  set(totalRow + 2, 0, text.noTax);
  const calculation = evaluateCalculation(spec, cells);
  for (const [row, rowCells] of Object.entries(cellData)) for (const [column, cell] of Object.entries(rowCells)) if (cell.f) cell.v = calculation.values[cellId(Number(row), Number(column))] ?? '';
  const table = validateArtifactContent({ kind: 'table', schemaVersion: 1, workbook: { id: id(), name: `${input.title} — ${text.estimate}`, appVersion: '1.0.4', locale: 'enUS', sheetOrder: [sheetId], sheets: { [sheetId]: { id: sheetId, name: text.estimate, rowCount, columnCount: 5, cellData, calculation: spec, columnData: { 0: { w: 340 }, 1: { w: 120 }, 2: { w: 140 }, 3: { w: 160 }, 4: { w: 90 } } } } }, stableIds: { [sheetId]: { rows, columns } } }) as Extract<ArtifactContent, { kind: 'table' }>;
  const paragraph = (value: string): DocumentNode => ({ type: 'paragraph', attrs: { id: id() }, content: value ? [{ type: 'text', text: value }] : [] });
  const heading = (value: string, level = 2): DocumentNode => ({ type: 'heading', attrs: { id: id(), level }, content: [{ type: 'text', text: value }] });
  const documentNodes: DocumentNode[] = [heading(input.title, 1), paragraph(input.introduction)];
  const documentBindings: FieldBinding[] = [];
  for (const [index, line] of input.lines.entries()) {
    const field = amountFields[index]!, amount = calculation.values[field.tableCellId];
    documentNodes.push({ type: 'paragraph', attrs: { id: id() }, content: [{ type: 'text', text: `${line.label} — ${line.quantity.value ?? text.unknown} ${line.unit}: ` }, { type: 'dataField', attrs: { id: field.documentFieldId, value: amount === null ? text.unknown : `${amount} ${input.currency}` } }] });
    if (field.sourceRef) documentBindings.push({ targetElementId: field.documentFieldId, sourceRef: field.sourceRef, transformId: 'money-format', updateMode: 'deterministic' });
  }
  const totalFieldId = id();
  amountFields.push({ tableCellId: spec.totalCellId, documentFieldId: totalFieldId, sourceRef: sourceRefs[0] ?? null });
  documentNodes.push({ type: 'paragraph', attrs: { id: id() }, content: [{ type: 'text', text: `${text.total}: ` }, { type: 'dataField', attrs: { id: totalFieldId, value: calculation.total === null ? text.unknown : `${calculation.total} ${input.currency}` } }] });
  if (sourceRefs[0]) documentBindings.push({ targetElementId: totalFieldId, sourceRef: sourceRefs[0], transformId: 'money-format', updateMode: 'deterministic' });
  documentNodes.push(paragraph(text.noTax), heading(text.terms), ...input.terms.map(paragraph), heading(text.requirements));
  for (const requirement of input.requirements) documentNodes.push(paragraph(`${requirement.text} — ${requirement.status === 'question' ? `${text.unanswered}: ` : requirement.status === 'excluded' ? `${text.excluded}: ` : ''}${requirement.response}`));
  const document = validateArtifactContent({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: id() }, content: documentNodes } });
  return { input, table, document, sourceRefs, tableBindings, documentBindings, amountFields, calculation };
}
