import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { IdentityError } from '@/features/identity/server/http';
import type { ExportWarning } from '@/features/exports/contracts';
import type { ExportAdapter, RenderInput, RenderedFile } from '@/features/exports/server/types';
import { EXPORT_MAX_BYTES } from '@/features/exports/server/storage';
import { loadDocumentFonts } from '@/features/exports/server/documents/fonts';
import type { PlanExportResourceResolution } from '../contracts';
import { canonicalAssignments, requirePlan, type OperationalPlanContent } from '../domain/model';
import { exportPlanCalendar } from '../icalendar';

type PlanRenderInput = RenderInput & { planResources?: PlanExportResourceResolution };

const messages = {
  ru: { task: 'Задача', description: 'Описание', status: 'Статус', start: 'Начало', end: 'Окончание', duration: 'Длительность, мин', effort: 'Трудозатраты', quantity: 'Объём', assignees: 'Исполнители', dependencies: 'Зависимости', checklist: 'Чек-лист', unknown: 'Не указано', revision: 'Версия', timezone: 'Часовой пояс', noLabels: 'Имена ресурсов не были зафиксированы в экспортном снимке и не включены в файл.' },
  kk: { task: 'Тапсырма', description: 'Сипаттама', status: 'Күйі', start: 'Басталуы', end: 'Аяқталуы', duration: 'Ұзақтығы, мин', effort: 'Еңбек шығыны', quantity: 'Көлемі', assignees: 'Орындаушылар', dependencies: 'Тәуелділіктер', checklist: 'Тексеру тізімі', unknown: 'Көрсетілмеген', revision: 'Нұсқа', timezone: 'Уақыт белдеуі', noLabels: 'Ресурс атаулары экспорт нобайында бекітілмегендіктен файлға қосылмады.' },
  en: { task: 'Task', description: 'Description', status: 'Status', start: 'Start', end: 'End', duration: 'Duration, min', effort: 'Effort', quantity: 'Quantity', assignees: 'Assignees', dependencies: 'Dependencies', checklist: 'Checklist', unknown: 'Not specified', revision: 'Revision', timezone: 'Time zone', noLabels: 'Resource labels were not frozen in the export snapshot and were omitted from the file.' },
} as const;

export function createOperationsExportAdapter(): ExportAdapter {
  return {
    kind: 'plan',
    formats: ['ics', 'xlsx', 'pdf'],
    async render(raw): Promise<RenderedFile> {
      const input = raw as PlanRenderInput;
      if (input.content.kind !== 'plan' || !['ics', 'xlsx', 'pdf'].includes(input.format)) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable');
      const plan = requirePlan(input.content), resources = input.planResources;
      const warnings: ExportWarning[] = resources?.warnings.map((warning) => ({ code: warning.code, targetId: warning.resourceId })) ?? [];
      if (!resources && plan.entries.some((entry) => canonicalAssignments(entry).length)) warnings.push({ code: 'operations-resource-labels-unavailable', message: messages[input.locale].noLabels });
      input.signal?.throwIfAborted();
      if (input.format === 'ics') return {
        bytes: exportPlanCalendar(plan, { artifactId: stableExportArtifactId(input), title: input.title, revision: input.revision, createdAt: input.createdAt, locale: input.locale, includeInternalNotes: input.privateFieldsPolicy === 'include-authorized' }),
        mediaType: 'text/calendar; charset=utf-8', warnings,
      };
      if (input.format === 'xlsx') return { bytes: await renderXlsx(plan, input), mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', warnings };
      return { bytes: await renderPdf(plan, input), mediaType: 'application/pdf', warnings };
    },
  };
}

export const operationsExportAdapter = createOperationsExportAdapter();

function stableExportArtifactId(input: RenderInput) {
  if (!input.artifactId) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.integrity');
  return input.artifactId;
}

function resourceNames(input: PlanRenderInput) {
  const exact = new Map((input.planResources?.resources ?? []).map((resource) => [`${resource.resourceId}:${resource.resourceRevision}`, resource.displayName]));
  const current = new Map<string, { revision: number; name: string }>();
  for (const resource of input.planResources?.resources ?? []) {
    const previous = current.get(resource.resourceId);
    if (!previous || resource.resourceRevision > previous.revision) current.set(resource.resourceId, { revision: resource.resourceRevision, name: resource.displayName });
  }
  return { exact, current };
}

function entryRows(plan: OperationalPlanContent, input: PlanRenderInput) {
  const names = resourceNames(input), titles = new Map(plan.entries.map((entry) => [entry.id, entry.title]));
  return plan.entries.map((entry) => ({
    task: entry.title,
    description: entry.description ?? '',
    internalNotes: input.privateFieldsPolicy === 'include-authorized' ? entry.notes ?? '' : '',
    status: entry.status,
    start: entry.startDate ?? entry.startAt ?? '',
    end: entry.endDate ?? entry.endAt ?? '',
    duration: entry.durationMinutes ?? null,
    effort: entry.effort ? `${entry.effort.decimal} ${entry.effort.unit}` : canonicalAssignments(entry).map((assignment) => assignment.effort ? `${assignment.effort.decimal} ${assignment.effort.unit}` : '').filter(Boolean).join('; '),
    quantity: entry.quantity ? `${entry.quantity.decimal} ${entry.quantity.unit}` : '',
    assignees: canonicalAssignments(entry).map((assignment) => assignment.resourceRevision === undefined
      ? names.current.get(assignment.resourceId)?.name
      : names.exact.get(`${assignment.resourceId}:${assignment.resourceRevision}`)).filter((name): name is string => Boolean(name)).join(', '),
    dependencies: entry.dependencies.map((id) => titles.get(id) ?? id).join(', '),
    checklist: entry.checklist.map((item) => `${item.done ? '[x]' : '[ ]'} ${item.text}`).join('\n'),
  }));
}

async function renderXlsx(plan: OperationalPlanContent, input: PlanRenderInput) {
  const t = messages[input.locale], book = new ExcelJS.Workbook();
  book.creator = 'Tirlik'; book.created = new Date(input.createdAt); book.modified = new Date(input.createdAt);
  const sheet = book.addWorksheet(input.title.slice(0, 31) || t.task, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: t.task, key: 'task', width: 28 }, { header: t.description, key: 'description', width: 42 },
    ...(input.privateFieldsPolicy === 'include-authorized' ? [{ header: input.locale === 'ru' ? 'Внутренние заметки' : input.locale === 'kk' ? 'Ішкі ескертпелер' : 'Internal notes', key: 'internalNotes', width: 42 }] : []),
    { header: t.status, key: 'status', width: 16 },
    { header: t.start, key: 'start', width: 23 }, { header: t.end, key: 'end', width: 23 }, { header: t.duration, key: 'duration', width: 18 },
    { header: t.effort, key: 'effort', width: 20 }, { header: t.quantity, key: 'quantity', width: 18 }, { header: t.assignees, key: 'assignees', width: 28 },
    { header: t.dependencies, key: 'dependencies', width: 30 }, { header: t.checklist, key: 'checklist', width: 42 },
  ];
  for (const row of entryRows(plan, input)) { input.signal?.throwIfAborted(); sheet.addRow(row); }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF086A70' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  for (const row of sheet.getRows(2, sheet.rowCount - 1) ?? []) { row.alignment = { vertical: 'top', wrapText: true }; }
  const metadata = book.addWorksheet('_tirlik'); metadata.state = 'veryHidden';
  metadata.addRows([[t.revision, input.revision], [t.timezone, plan.timezone], ['createdAt', input.createdAt], ['historicalDraft', input.historicalDraft]]);
  const buffer = await book.xlsx.writeBuffer(); input.signal?.throwIfAborted();
  if (buffer.byteLength > EXPORT_MAX_BYTES) throw new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge');
  return new Uint8Array(buffer);
}

async function renderPdf(plan: OperationalPlanContent, input: PlanRenderInput) {
  const t = messages[input.locale], rows = entryRows(plan, input), fonts = await loadDocumentFonts();
  const margin = input.options.layout.marginMm * 72 / 25.4;
  const pdf = new PDFDocument({ size: input.options.layout.pageSize, layout: input.options.layout.orientation, margins: { top: margin, bottom: margin, left: margin, right: margin }, bufferPages: true, compress: true, info: { Title: input.title, Author: 'Tirlik', CreationDate: new Date(input.createdAt), Subject: `${t.revision} ${input.revision}` } });
  pdf.registerFont('body', fonts.regular); pdf.registerFont('bold', fonts.bold);
  const chunks: Buffer[] = []; let size = 0;
  const completed = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => { size += chunk.length; if (size > EXPORT_MAX_BYTES) pdf.destroy(new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge')); else chunks.push(chunk); });
    pdf.on('error', reject); pdf.on('end', () => resolve(Buffer.concat(chunks)));
  });
  void completed.catch(() => undefined);
  const width = () => pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const ensure = (height: number) => { if (pdf.y + height > pdf.page.height - pdf.page.margins.bottom) pdf.addPage(); };
  try {
    pdf.font('bold').fontSize(18).fillColor('#202624').text(input.title, { width: width() });
    pdf.moveDown(0.3).font('body').fontSize(9).fillColor('#58625E').text(`${t.revision}: ${input.revision}   ${t.timezone}: ${plan.timezone}`);
    pdf.moveDown(0.8);
    for (const row of rows) {
      input.signal?.throwIfAborted(); ensure(88);
      const top = pdf.y; pdf.save().fillColor('#F4F7F5').roundedRect(pdf.page.margins.left, top, width(), 2, 1).fill().restore(); pdf.y = top + 8;
      pdf.font('bold').fontSize(11).fillColor('#202624').text(row.task, { width: width() });
      pdf.font('body').fontSize(9).fillColor('#58625E').text(`${t.status}: ${row.status}   ${t.start}: ${row.start || t.unknown}   ${t.end}: ${row.end || t.unknown}`, { width: width() });
      const facts = [[t.assignees, row.assignees], [t.effort, row.effort], [t.duration, row.duration === null ? '' : String(row.duration)], [t.quantity, row.quantity], [t.dependencies, row.dependencies]].filter(([, value]) => value !== '' && value !== null);
      if (facts.length) pdf.fillColor('#202624').text(facts.map(([label, value]) => `${label}: ${value}`).join('   '), { width: width() });
      if (row.description) pdf.moveDown(0.25).text(row.description, { width: width() });
      if (row.internalNotes) pdf.moveDown(0.25).fillColor('#58625E').text(row.internalNotes, { width: width() });
      if (row.checklist) pdf.moveDown(0.25).text(`${t.checklist}:\n${row.checklist}`, { width: width() });
      pdf.moveDown(0.8);
    }
    const range = pdf.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      pdf.switchToPage(index); pdf.font('body').fontSize(8).fillColor('#58625E');
      if (input.options.layout.pageNumbers) pdf.text(`${index + 1} / ${range.count}`, margin, pdf.page.height - 24, { width: width(), align: 'right', lineBreak: false });
    }
    pdf.end(); return new Uint8Array(await completed);
  } catch (error) { pdf.destroy(); throw error; }
}
