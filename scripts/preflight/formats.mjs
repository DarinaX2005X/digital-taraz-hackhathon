import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import mammoth from "mammoth";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { FabricObject, FabricText, Group, Rect, util } from "fabric/node";
import ARIMA from "arima";
import { mean } from "simple-statistics";
import { FORMULA_CASES, proveFormulas } from "./formulas.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const UNICODE_LINES = [
  "Коммерческое предложение: сумма 12500 тенге",
  "Қазақша: Ә Ғ Қ Ң Ө Ұ Ү Һ І ә ғ қ ң ө ұ ү һ і",
  "English: price 12500 KZT, valid until 2026-11-01",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalized = (text) => text.replace(/\s+/gu, " ").trim();

export async function proveOffice(formulaProof) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tirlik synthetic preflight";
  const data = workbook.addWorksheet("Data");
  const rates = workbook.addWorksheet("Rates");
  [10, 20, -5, 10].forEach((value, i) => {
    data.getCell(i + 1, 1).value = value;
    data.getCell(i + 1, 2).value = i < 2 ? "retail" : "service";
  });
  rates.getCell("A1").value = 1.25;
  formulaProof.results.forEach((item, i) => {
    data.getCell(i + 1, 4).value = { formula: item.formula.slice(1), result: item.actual };
  });
  data.getCell("A20").value = UNICODE_LINES[1];
  data.mergeCells("A20:B20");
  data.getCell("A20").font = { name: "Noto Sans", bold: true, size: 12 };
  data.getCell("A1").numFmt = '#,##0.00 "KZT"';
  data.getCell("A21").value = new Date("2026-10-13T00:00:00Z");
  data.getCell("A21").numFmt = "yyyy-mm-dd";
  [10, 50, 90].forEach((value, i) => { data.getCell(i + 1, 5).value = value; });
  data.addConditionalFormatting({ ref: "E1:E3", rules: [{ type: "iconSet", iconSet: "3Triangles", cfvo: [{ type: "percent", value: 0 }, { type: "percent", value: 33 }, { type: "percent", value: 67 }] }] });
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(xlsx);
  const savedSheet = loaded.getWorksheet("Data");
  const cells = FORMULA_CASES.map(([name, formula, expected], index) => {
    const value = savedSheet.getCell(index + 1, 4).value;
    assert.equal(value.formula, formula.slice(1));
    assert.equal(value.result, expected);
    return { name, formula: value.formula, cachedResult: value.result };
  });
  assert.equal(savedSheet.getCell("A20").value, UNICODE_LINES[1]);
  assert.equal(savedSheet.getCell("A20").font.bold, true);
  assert.equal(savedSheet.getCell("A1").numFmt, '#,##0.00 "KZT"');
  assert.equal(savedSheet.getCell("A21").value.toISOString(), "2026-10-13T00:00:00.000Z");
  assert.equal(savedSheet.getCell("B20").master.address, "A20");
  const zip = await JSZip.loadAsync(xlsx);
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(xml, /x14:iconSet iconSet="3Triangles"/u);
  assert.match(xml, /id="\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}"/u);
  assert.equal(savedSheet.conditionalFormattings[0].rules[0].iconSet, "3Triangles");

  const marker = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#107965" } }).png().toBuffer();
  const doc = new Document({
    creator: "Tirlik synthetic preflight",
    styles: { default: { document: { run: { font: "Noto Sans", size: 22 } } } },
    sections: [{ children: [
      ...UNICODE_LINES.map((text) => new Paragraph({ children: [new TextRun(text)] })),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("TOTAL")] }), new TableCell({ children: [new Paragraph("12500 KZT")] })] })] }),
      new Paragraph({ children: [new ImageRun({ type: "png", data: marker, transformation: { width: 16, height: 16 } })] }),
    ] }],
  });
  const docx = await Packer.toBuffer(doc);
  const extracted = await mammoth.extractRawText({ buffer: docx });
  for (const line of UNICODE_LINES) assert.ok(normalized(extracted.value).includes(normalized(line)));
  const docZip = await JSZip.loadAsync(docx);
  const docXml = await docZip.file("word/document.xml").async("string");
  assert.match(docXml, /<w:tbl>/u);
  assert.match(docXml, /<w:drawing>/u);
  const mediaCount = Object.keys(docZip.files).filter((name) => name.startsWith("word/media/") && !docZip.files[name].dir).length;
  assert.equal(mediaCount, 1);

  const pdf = new PDFDocument({ size: "A4", margin: 42, info: { Title: "Tirlik synthetic multilingual preflight" } });
  const chunks = [];
  const completed = new Promise((resolve, reject) => { pdf.on("data", (chunk) => chunks.push(chunk)); pdf.on("end", resolve); pdf.on("error", reject); });
  pdf.font(path.join(root, "public/fonts/noto-sans/NotoSans-Regular.ttf")).fontSize(12);
  for (const line of UNICODE_LINES) pdf.text(line).moveDown();
  pdf.text("TOTAL 12500 KZT").image(marker, { width: 16, height: 16 });
  pdf.addPage().text("Second page: retained continuation");
  pdf.end();
  await completed;
  const pdfBytes = Buffer.concat(chunks);
  const loading = getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const parsed = await loading.promise;
  try {
    const texts = [];
    for (let page = 1; page <= parsed.numPages; page++) {
      const textContent = await (await parsed.getPage(page)).getTextContent();
      texts.push(textContent.items.filter((item) => "str" in item).map((item) => item.str).join(" "));
    }
    for (const line of UNICODE_LINES) assert.ok(normalized(texts.join(" ")).includes(normalized(line)));
    assert.equal(parsed.numPages, 2);
    return {
      evidence: {
        xlsx: { bytes: xlsx.length, sha256: digest(xlsx), formulas: cells, mergedCells: true, numberFormat: true, dateValue: true, x14IconSetRoundtrip: true },
        docx: { bytes: docx.length, sha256: digest(docx), extractedText: extracted.value.trim(), table: true, mediaCount, warnings: extracted.messages.length },
        pdf: { bytes: pdfBytes.length, sha256: digest(pdfBytes), pages: parsed.numPages, extractedText: texts, embeddedFont: "Noto Sans Regular / OFL-1.1" },
        uiOrPixelLayoutVerified: false,
        supportedSubset: "Editable text, simple tables, embedded PNG, basic XLSX formulas/cached values, styles, merges and dates; full Office fidelity is not claimed.",
      },
      files: { "synthetic-formulas.xlsx": xlsx, "synthetic-unicode.docx": docx, "synthetic-unicode.pdf": pdfBytes },
    };
  } finally {
    await loading.destroy();
  }
}

export async function proveFabric() {
  const previous = FabricObject.customProperties;
  FabricObject.customProperties = ["stableId", "assetId", "binding"];
  try {
    const label = new FabricText(UNICODE_LINES[1], { left: 24, top: 40, fontSize: 22, fontFamily: "sans-serif", fill: "#141B18" });
    label.set({ stableId: "headline", binding: { fieldId: "offer-title", revision: 1 } });
    const shape = new Rect({ left: 12, top: 20, width: 120, height: 60, fill: "#107965", angle: 12, scaleX: 1.25, opacity: 0.8 });
    shape.set({ stableId: "accent" });
    const group = new Group([shape], { left: 5, top: 9 });
    group.set({ stableId: "group-1" });
    const serialized = [label.toObject(), group.toObject()];
    const restored = await util.enlivenObjects(JSON.parse(JSON.stringify(serialized)));
    assert.deepEqual(restored.map((item) => item.toObject()), serialized);
    restored[0].set("text", "Manual revised heading");
    assert.equal(restored[0].binding.fieldId, "offer-title");
    assert.equal(restored[1].getObjects()[0].angle, 12);
    assert.equal(restored[0].stableId, "headline");
    return { objects: 2, nestedObjects: 1, roundtrip: true, unicodeTextRetained: true, stableIdsRetained: true, manualTextEdit: true, bindingRetained: true, renderSurfaceCreated: false, browserUsed: false, fontMetricsVerified: false };
  } finally {
    FabricObject.customProperties = previous;
  }
}

export function proveForecast() {
  const series = Array.from({ length: 112 }, (_, i) => 80 + i * 0.7 + 3 * Math.sin(i * 0.6) + 0.4 * Math.cos(i * 1.4));
  const parameters = { p: 2, d: 1, q: 0, auto: false, verbose: false };
  const fit = (train, horizon) => {
    const model = new ARIMA(parameters);
    try {
      const [points, mse] = model.train(train).predict(horizon);
      assert.equal(points.length, horizon);
      assert.equal(mse.length, horizon);
      assert.ok(points.every(Number.isFinite));
      assert.ok(mse.every((value) => Number.isFinite(value) && value >= 0));
      return { points, modelMeanSquareErrors: mse };
    } finally {
      model.destroy();
    }
  };
  const folds = [98, 105].map((origin) => {
    const prediction = fit(series.slice(0, origin), 7);
    const actual = series.slice(origin, origin + 7);
    const mae = mean(actual.map((value, i) => Math.abs(value - prediction.points[i])));
    const baselineMae = mean(actual.map((value) => Math.abs(value - series[origin - 1])));
    return { origin, horizon: 7, mae, baselineMae };
  });
  const modelMae = mean(folds.map((fold) => fold.mae));
  const baselineMae = mean(folds.map((fold) => fold.baselineMae));
  const forecast = fit(series, 7);
  const shortModel = new ARIMA(parameters);
  try {
    assert.throws(() => shortModel.train([1, 2, 3]));
  } finally {
    shortModel.destroy();
  }
  return { engine: "arima/CTSA WASM", synthetic: true, observations: series.length, parameters, folds, modelMae, baselineMae, selected: modelMae <= baselineMae ? "ARIMA(2,1,0)" : "last-value-baseline", forecast, shortSeriesRejected: true, calibratedIntervalClaimed: false, futureStageNeeded: "Eligibility, candidate bounds, calibrated ranges and broader business backtests remain stage05.3 work." };
}

export async function proveFormats() {
  const formulas = await proveFormulas();
  for (const result of formulas.results) assert.equal(result.actual, result.expected);
  assert.deepEqual(formulas.changed, { sum: 55, crossSheet: 37.5 });
  const office = await proveOffice(formulas);
  return { evidence: { formulas, office: office.evidence, fabric: await proveFabric(), forecast: proveForecast() }, files: office.files };
}
