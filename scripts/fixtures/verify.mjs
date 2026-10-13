import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { FIXTURE_ROOT, generateFixtureFiles, sha256 } from "./generate.mjs";
import { LOCALE_SAMPLE, SYNTHETIC_NOTICE } from "./definitions.mjs";
import { forecastOracle, historyOracle, parseCsv, procurementOracle, quoteOracle } from "./oracle.mjs";

export const PINNED_GOLDENS = {
  homegoods: { rawRows: 1526, acceptedRows: 1520, netRevenueKzt: "34244571.00", netCostKzt: "20852455.00", knownTotalKzt: "141870.00", supplierTotals: ["43500.00", "58500.00", null] },
  services: { rawRows: 954, acceptedRows: 948, netRevenueKzt: "51671456.70", netCostKzt: "30808781.25", knownTotalKzt: "131900.00", supplierTotals: ["27400.00", "29040.00", null] },
  manufacturing: { rawRows: 764, acceptedRows: 758, netRevenueKzt: "58875825.00", netCostKzt: "33946500.00", knownTotalKzt: "563325.00", supplierTotals: ["102000.00", "110000.00", null] },
};

async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false });
  try {
    const document = await task.promise;
    const text = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      text.push(content.items.filter((item) => "str" in item).map(({ str }) => str).join(" "));
    }
    return { text: text.join("\n"), pageCount: document.numPages };
  } finally {
    await task.destroy();
  }
}

export async function verifyFixtureFiles({ fixtureRoot = FIXTURE_ROOT, regenerate = true } = {}) {
  const manifestBytes = await readFile(path.join(fixtureRoot, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.businesses.length, 3);
  const files = new Map();
  for (const descriptor of manifest.files) {
    assert.equal(path.isAbsolute(descriptor.file), false);
    assert.equal(descriptor.file.split("/").includes(".."), false);
    const bytes = await readFile(path.join(fixtureRoot, descriptor.file));
    assert.equal(bytes.length, descriptor.bytes, descriptor.file);
    assert.equal(sha256(bytes), descriptor.sha256, descriptor.file);
    assert.ok(bytes.length > 0 && bytes.length < 20 * 1024 * 1024, descriptor.file);
    files.set(descriptor.file, bytes);
  }
  files.set("manifest.json", manifestBytes);
  if (regenerate) {
    const repeated = await generateFixtureFiles({ seed: manifest.seed });
    assert.deepEqual([...files.keys()].sort(), [...repeated.files.keys()].sort());
    for (const [file, bytes] of repeated.files) assert.ok(bytes.equals(files.get(file)), `Non-reproducible fixture: ${file}`);
  }
  const summaries = [];
  for (const business of manifest.businesses) {
    const get = (name) => files.get(`${business.id}/${name}`);
    const golden = JSON.parse(get("golden.json"));
    const conditions = JSON.parse(get("quote-conditions.json"));
    const history = historyOracle(get("history.csv"), get("catalog.csv"));
    assert.deepEqual(history, golden.history);
    assert.equal(history.exclusions.length, 4);
    assert.equal(history.duplicateCopiesRemoved, 1);
    assert.equal(history.monthly.length, 60);
    assert.equal(history.reductionRows > 0, true);
    const quote = quoteOracle(get("quote-lines.csv"), conditions.discountPercent, conditions.enteredDeliveryKzt);
    assert.deepEqual(quote, golden.quote);
    assert.equal(quote.finalTotalKzt, null);
    const procurement = procurementOracle(get("supplier-offers.csv"), golden.procurement.target);
    assert.deepEqual(procurement, golden.procurement.candidates);
    assert.equal(procurement.at(-1).eligibleForCompleteCostRanking, false);
    if (manifest.seed === 20261013) {
      const expected = PINNED_GOLDENS[business.id];
      for (const key of ["rawRows", "acceptedRows", "netRevenueKzt", "netCostKzt"]) assert.equal(history[key], expected[key]);
      assert.equal(quote.knownTotalKzt, expected.knownTotalKzt);
      assert.deepEqual(procurement.map(({ totalKzt }) => totalKzt), expected.supplierTotals);
    }
    const splits = forecastOracle({ train: get("forecast/train.csv"), validation: get("forecast/validation.csv"), holdout: get("forecast/holdout.csv") });
    assert.deepEqual(splits, golden.forecast.independentlyParsedSplits);
    assert.deepEqual(Object.values(splits).map(({ count }) => count), [36, 12, 12]);
    assert.equal(golden.forecast.outliers.length, 2);
    assert.equal(golden.forecast.accuracyClaimed, false);
    assert.equal(golden.forecast.rollingOrigins.length, 2);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(get("business-materials.xlsx"));
    assert.ok(workbook.getWorksheet("Прайс"));
    const sku = parseCsv(get("catalog.csv"))[0].sku;
    assert.equal(workbook.getWorksheet("Прайс").getCell("A2").value, sku);
    assert.equal(sku.startsWith("0"), true);
    assert.equal(workbook.getWorksheet("История").rowCount - 1, history.rawRows);
    const estimate = workbook.getWorksheet("Смета");
    assert.equal(estimate.getCell("F9").result.toFixed(2), quote.knownTotalKzt);
    assert.equal(estimate.getCell("F9").formula, "F6-F7+F8");
    const officeZip = await JSZip.loadAsync(get("business-materials.xlsx"));
    assert.equal(Object.keys(officeZip.files).some((file) => /vbaProject|externalLinks/.test(file)), false);

    const documentZip = await JSZip.loadAsync(get("request.docx"));
    const documentXml = await documentZip.file("word/document.xml").async("string");
    assert.ok(documentXml.includes('<wp:docPr id="1"'));
    assert.ok(Object.keys(documentZip.files).some((name) => name.startsWith("word/media/")));
    const extracted = await mammoth.extractRawText({ buffer: get("request.docx") });
    assert.ok(extracted.value.includes(LOCALE_SAMPLE));
    assert.ok(extracted.value.includes(conditions.requestId));
    assert.ok(extracted.value.includes(conditions.requestedDate));
    assert.ok(extracted.value.includes(conditions.eventDate));
    assert.ok(extracted.value.includes(SYNTHETIC_NOTICE));
    const pdf = await pdfText(get("terms.pdf"));
    assert.equal(pdf.pageCount, 2);
    assert.ok(pdf.text.includes(LOCALE_SAMPLE));
    assert.ok(pdf.text.includes("Учебные синтетические данные"));
    const metadata = await sharp(get("product-photo.jpg")).metadata();
    assert.ok(metadata.width * metadata.height < 20_000_000);
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.iptc, undefined);
    const licence = JSON.parse(get("photo-licence.json"));
    assert.equal(sha256(get("product-photo.jpg")), licence.sha256);
    assert.ok(licence.evidence && licence.author && licence.pageRevision && licence.licenseUrl);
    assert.ok(["CC0-1.0", "LicenseRef-Public-Domain-Self"].includes(licence.license));
    const archive = await JSZip.loadAsync(get("working-inputs.zip"));
    assert.equal(archive.file("golden.json"), null);
    assert.equal(archive.file("forecast/holdout.csv"), null);
    assert.equal(archive.file("forecast/validation.csv"), null);
    assert.ok((await archive.file("history.csv").async("nodebuffer")).equals(get("history.csv")));
    const quick = await JSZip.loadAsync(get("quick-start.zip"));
    assert.equal(quick.file("history.csv"), null);
    assert.ok(quick.file("request.docx"));
    assert.ok(quick.file("catalog.csv"));
    summaries.push({ business: business.id, inputRows: history.rawRows, acceptedRows: history.acceptedRows, netRevenueKzt: history.netRevenueKzt, knownQuoteTotalKzt: quote.knownTotalKzt, pdfPages: pdf.pageCount, forecastSplitCounts: Object.values(splits).map(({ count }) => count) });
  }
  return { passed: true, verifiedFiles: files.size, regeneratedInMemory: regenerate, summaries, visualReviewPerformed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyFixtureFiles(), null, 2));
  const { verifyChangeFixtures } = await import("./verify-changes.mjs");
  console.log(JSON.stringify(await verifyChangeFixtures(), null, 2));
}
