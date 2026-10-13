import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { FIXED_TIMESTAMP, LOCALE_SAMPLE, SYNTHETIC_NOTICE } from "./definitions.mjs";
import { HISTORY_COLUMNS } from "./data.mjs";

const fixedDate = new Date(FIXED_TIMESTAMP);
export const REGULAR_FONT = fileURLToPath(new URL("../../public/fonts/noto-sans/NotoSans-Regular.ttf", import.meta.url));
export const BOLD_FONT = fileURLToPath(new URL("../../public/fonts/noto-sans/NotoSans-Bold.ttf", import.meta.url));

export async function stableZip(entries) {
  const zip = new JSZip();
  for (const [path, bytes] of [...entries].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    zip.file(path, bytes, { date: fixedDate, createFolders: false, unixPermissions: 0o100644 });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
}

async function canonicalizeOfficeZip(bytes) {
  const source = await JSZip.loadAsync(bytes);
  const entries = [];
  for (const entry of Object.values(source.files)) if (!entry.dir) entries.push([entry.name, await entry.async("nodebuffer")]);
  return stableZip(entries);
}

function sheetWithRows(workbook, name, headers, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.addRow(headers);
  sheet.addRows(rows);
  sheet.getRow(1).font = { name: "Noto Sans", bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12665D" } };
  sheet.getRow(1).height = 28;
  sheet.columns.forEach((column, index) => { column.width = index === 1 ? 48 : 22; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
  sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  sheet.headerFooter.oddFooter = "Учебные синтетические данные | &P / &N";
  return sheet;
}

export async function businessWorkbook(business) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tirlik synthetic fixtures";
  workbook.lastModifiedBy = "Tirlik synthetic fixtures";
  workbook.created = fixedDate;
  workbook.modified = fixedDate;
  workbook.calcProperties.fullCalcOnLoad = true;
  sheetWithRows(workbook, "О наборе", ["Поле", "Значение"], [
    ["Происхождение", SYNTHETIC_NOTICE], ["Компания", business.name], ["Задача", business.goal],
    ["На дату", business.asOf], ["Валюта", "KZT"], ["Языки", LOCALE_SAMPLE],
    ["Недостающие сведения", business.quote.unknowns.join(", ")],
    ["Суммы", "Известные суммы не включают неподтверждённые налоги, упаковку и дополнительный объём."],
  ]);
  const catalog = sheetWithRows(workbook, "Прайс", ["Артикул", "Наименование", "Единица", "Цена KZT", "Затраты KZT", "На дату"], business.catalog.map((row) => [row.sku, row.name, row.unit, Number(row.price), Number(row.cost), business.asOf]));
  catalog.getColumn(1).numFmt = "@";
  catalog.getColumn(4).numFmt = '#,##0.00 "KZT"';
  catalog.getColumn(5).numFmt = '#,##0.00 "KZT"';
  sheetWithRows(workbook, "Поставщики", ["Поставщик", "Наименование", "Артикул", "В упаковке", "Единица", "Цена упаковки KZT", "Минимум упаковок", "Доставка KZT", "Срок, дней", "Действует до"], business.suppliers.map((row) => [row.id, row.label, row.sku, row.pack === null ? null : Number(row.pack), row.packUnit, Number(row.price), row.minPacks, row.delivery === null ? null : Number(row.delivery), row.leadDays, row.validThrough]));
  sheetWithRows(workbook, "Остатки", ["Артикул", "Наименование", "Количество", "Единица", "На дату", "Примечание"], business.catalog.map((row) => [row.sku, row.name, Number(row.stock), row.unit, business.asOf, "Самостоятельный учебный снимок; история продаж не является полным складским регистром."]));
  const quote = sheetWithRows(workbook, "Смета", ["Артикул", "Наименование", "Количество", "Единица", "Цена KZT", "Сумма KZT"], business.quote.lines.map((row, index) => [row.sku, row.name, Number(row.quantity), row.unit, Number(row.unitPrice), { formula: `C${index + 2}*E${index + 2}`, result: Number(row.amount) }]));
  const subtotalRow = business.quote.lines.length + 3;
  quote.getCell(`B${subtotalRow}`).value = "Сумма позиций";
  quote.getCell(`F${subtotalRow}`).value = { formula: `SUM(F2:F${business.quote.lines.length + 1})`, result: Number(business.quote.subtotal) };
  quote.getCell(`B${subtotalRow + 1}`).value = `Учебная скидка ${business.quote.discountPercent}%`;
  quote.getCell(`F${subtotalRow + 1}`).value = { formula: `ROUND(F${subtotalRow}*${business.quote.discountPercent}/100,2)`, result: Number(business.quote.discount) };
  quote.getCell(`B${subtotalRow + 2}`).value = "Введённая доставка";
  quote.getCell(`F${subtotalRow + 2}`).value = Number(business.quote.delivery);
  quote.getCell(`B${subtotalRow + 3}`).value = "Известная сумма; не итоговый счёт";
  quote.getCell(`F${subtotalRow + 3}`).value = { formula: `F${subtotalRow}-F${subtotalRow + 1}+F${subtotalRow + 2}`, result: Number(business.quote.knownTotal) };
  quote.getCell(`B${subtotalRow + 5}`).value = "Налоговый статус, упаковка и противоречивые даты требуют уточнения.";
  quote.getColumn(5).numFmt = '#,##0.00 "KZT"';
  quote.getColumn(6).numFmt = '#,##0.00 "KZT"';
  sheetWithRows(workbook, "Команда", ["Ресурс", "Наименование", "Чел.-ч в день", "Дни", "С", "До", "Исключение, дата", "Доступно чел.-ч"], business.workResources.map((row) => [row.id, row.label, Number(row.capacityHours), row.availableDays, row.from, row.to, row.exceptionDate, Number(row.exceptionHours)]));
  sheetWithRows(workbook, "План", ["Работа", "Наименование", "Ресурс", "Чел.-ч", "Длительность, ч", "После работы", "Срок"], business.tasks.map((row) => [row.id, row.title, row.resourceId, Number(row.effortHours), Number(row.durationHours), row.dependsOn, row.dueDate]));
  if (business.bom.length) sheetWithRows(workbook, "Материалы", ["Изделие или услуга", "Материал", "На единицу", "Единица", "Отходы %", "Основание"], business.bom.map((row) => [row.productSku, row.materialSku, Number(row.quantityPerUnit), row.materialUnit, Number(row.wastePercent), row.note]));
  sheetWithRows(workbook, "Обязательства", ["Обязательство", "Вид", "Сумма KZT", "Валюта", "Срок", "Статус", "Контрагент", "Основание"], business.commitments.map((row) => [row.commitmentId, row.kind, Number(row.amount), row.currency, row.dueDate, row.status, row.counterpartyId, row.note]));
  const history = sheetWithRows(workbook, "История", HISTORY_COLUMNS.map(([, label]) => label), business.history.rows.map((row) => HISTORY_COLUMNS.map(([key]) => row[key])));
  history.getColumn(5).numFmt = "@";
  return canonicalizeOfficeZip(await workbook.xlsx.writeBuffer());
}

function paragraph(text, heading = false) {
  return new Paragraph({ children: [new TextRun({ text, font: "Noto Sans", size: heading ? 28 : 22 })], ...(heading ? { heading: HeadingLevel.HEADING_1 } : {}), spacing: { after: 140 } });
}

const deterministicCoreProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Synthetic business request</dc:title><dc:creator>Tirlik synthetic fixtures</dc:creator><dc:description>Fictional educational input; no real company or customer data.</dc:description><cp:lastModifiedBy>Tirlik synthetic fixtures</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_TIMESTAMP}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_TIMESTAMP}</dcterms:modified></cp:coreProperties>`;

export async function requestDocument(business, photo, photoMetadata) {
  const tableRows = [["Артикул", "Наименование", "Количество", "Единица"], ...business.quote.lines.map((line) => [line.sku, line.name, line.quantity, line.unit])];
  const imageWidth = 260;
  const imageHeight = Math.min(230, Math.round(imageWidth * photoMetadata.height / photoMetadata.width));
  const proportionalWidth = Math.round(imageHeight * photoMetadata.width / photoMetadata.height);
  const document = new Document({
    creator: "Tirlik synthetic fixtures", title: `${business.name}: запрос`, revision: 1,
    styles: { default: { document: { run: { font: "Noto Sans", size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 850, right: 850, bottom: 850, left: 850 } } }, children: [
      paragraph("Запрос на предложение", true), paragraph(business.name), paragraph(SYNTHETIC_NOTICE),
      paragraph(`Запрос ${business.quote.id}. Снимок материалов на ${business.asOf}.`), paragraph(business.quote.request),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows.map((row) => new TableRow({ children: row.map((text) => new TableCell({ children: [paragraph(text)] })) })) }),
      paragraph("Условия и вопросы", true), ...business.quote.terms.map((text) => paragraph(text)),
      paragraph(`Дата в запросе: ${business.quote.requestedDate}. Дата события: ${business.quote.requiredDate}. Требуется согласование.`),
      new Paragraph({ children: [new ImageRun({ type: "jpg", data: photo, transformation: { width: proportionalWidth, height: imageHeight }, altText: { id: "1", name: photoMetadata.id, title: photoMetadata.alt, description: photoMetadata.relationship } })] }),
      paragraph(`Учебная фотография категории: ${photoMetadata.title}; ${photoMetadata.author}; ${photoMetadata.license}. ${photoMetadata.page}`),
      paragraph(LOCALE_SAMPLE),
    ] }],
  });
  const bytes = await Packer.toBuffer(document, false, [{ path: "docProps/core.xml", data: deterministicCoreProperties }]);
  return canonicalizeOfficeZip(bytes);
}

export async function termsPdf(business, photo, photoMetadata) {
  const [regular, bold] = await Promise.all([readFile(REGULAR_FONT), readFile(BOLD_FONT)]);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const document = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, compress: true, info: {
      Title: `${business.name}: учебные условия`, Author: "Tirlik synthetic fixtures", Creator: "Tirlik fixture generator",
      Subject: "Synthetic educational business input; not an invoice or legal advice", CreationDate: fixedDate, ModDate: fixedDate,
    } });
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.registerFont("Noto", regular).registerFont("NotoBold", bold);
    document.font("NotoBold").fontSize(19).fillColor(business.brand.colors[0]).text("Условия и исходные сведения");
    document.moveDown(0.5).fontSize(13).text(business.name);
    document.moveDown(0.5).font("Noto").fontSize(9).fillColor("#303638").text(SYNTHETIC_NOTICE);
    document.moveDown().fontSize(10).text(`Снимок: ${business.asOf}. Валюта: KZT. Запрос: ${business.quote.id}.`);
    document.moveDown().font("NotoBold").fontSize(12).text("Что нужно подготовить");
    document.moveDown(0.3).font("Noto").fontSize(10).text(business.goal);
    document.moveDown().font("NotoBold").fontSize(12).text("Введённые условия");
    business.quote.terms.forEach((text, index) => { document.moveDown(0.4).font("Noto").fontSize(10).text(`${index + 1}. ${text}`); });
    document.moveDown().font("NotoBold").fontSize(12).text("Неподтверждённые сведения");
    document.moveDown(0.3).font("Noto").fontSize(10).text(business.quote.request);
    document.addPage();
    document.font("NotoBold").fontSize(16).fillColor(business.brand.colors[0]).text("Бренд и изображения");
    document.moveDown(0.5).font("Noto").fontSize(11).fillColor("#303638").text(`${business.brand.displayName}. ${business.brand.tone}`);
    const imageY = document.y + 16;
    document.image(photo, 44, imageY, { fit: [400, 285], align: "left" });
    document.y = imageY + 300;
    document.fontSize(9).text(photoMetadata.alt);
    document.moveDown(0.5).text(`${photoMetadata.author} | ${photoMetadata.license} | ${photoMetadata.title}`);
    document.moveDown(0.5).text(photoMetadata.page, { link: photoMetadata.page });
    document.moveDown(0.5).text(`Лицензия: ${photoMetadata.licenseUrl}`, { link: photoMetadata.licenseUrl });
    document.moveDown(0.5).text("Изменения: уменьшение изображения, удаление EXIF, перекодирование JPEG. Фотография не подтверждает свойства или наличие конкретного товара.");
    document.moveDown().fontSize(10).text(LOCALE_SAMPLE);
    const { start, count } = document.bufferedPageRange();
    for (let page = start; page < start + count; page++) {
      document.switchToPage(page);
      document.font("Noto").fontSize(8).fillColor("#596366").text(`Учебный пример | ${page + 1} / ${count}`, 44, 790, { lineBreak: false });
    }
    document.end();
  });
}
