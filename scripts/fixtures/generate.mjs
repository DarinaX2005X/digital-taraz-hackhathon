import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createBusinessData, csvBuffer, historyCsv } from "./data.mjs";
import { businessWorkbook, requestDocument, stableZip, termsPdf } from "./formats.mjs";
import { DEFAULT_SEED, FIXED_TIMESTAMP, LOCALE_SAMPLE, PHOTO_SOURCES, SYNTHETIC_NOTICE } from "./definitions.mjs";
import { forecastOracle, historyOracle, procurementOracle, quoteOracle } from "./oracle.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export const FIXTURE_ROOT = path.join(repository, "fixtures", "business");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function table(columns, rows) {
  return csvBuffer(columns, rows.map((row) => columns.map((column) => row[column])));
}

function mediaType(file) {
  return {
    ".json": "application/json", ".csv": "text/csv", ".txt": "text/plain", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".pdf": "application/pdf", ".zip": "application/zip",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }[path.extname(file)];
}

function logoSvg(business) {
  const label = { homegoods: "ДОМ", services: "ЧИСТО", manufacturing: "ФОРМА" }[business.id];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="150" viewBox="0 0 540 150" role="img" aria-label="${label}: учебная марка"><rect width="540" height="150" fill="white"/><path d="M24 108V42h18v48h48v18z" fill="${business.brand.colors[0]}"/><path d="M53 42h37v37H72V60H53z" fill="${business.brand.colors[1]}"/><text x="118" y="84" font-family="Noto Sans,sans-serif" font-size="38" font-weight="700" fill="${business.brand.colors[0]}">${label}</text><text x="119" y="111" font-family="Noto Sans,sans-serif" font-size="17" fill="#53605C">Учебная марка</text></svg>\n`, "utf8");
}

function inputDescriptor(file, role, collection, key, mode = "replace-snapshot") {
  return { file, role, collection, suggestedImportMode: mode, recordKeySpec: key, confirmationRequired: true, revision: 1 };
}

async function loadAssets() {
  const provenanceBytes = await readFile(path.join(FIXTURE_ROOT, "assets", "provenance.json"));
  const provenance = JSON.parse(provenanceBytes);
  const assets = new Map();
  for (const source of PHOTO_SOURCES) {
    const record = provenance.assets.find(({ id }) => id === source.id);
    if (!record || record.page !== source.page || record.sha1 !== source.sha1 || record.license !== source.license) {
      throw new Error(`Missing or stale licence record: ${source.id}`);
    }
    const bytes = await readFile(path.join(FIXTURE_ROOT, record.file));
    if (sha256(bytes) !== record.sha256 || bytes.length !== record.bytes) throw new Error(`Asset hash changed: ${source.id}`);
    assets.set(source.id, { record, bytes });
  }
  return { assets, provenanceBytes };
}

export async function generateFixtureFiles({ seed = DEFAULT_SEED } = {}) {
  const files = new Map();
  const data = createBusinessData(seed);
  const { assets, provenanceBytes } = await loadAssets();
  const fontManifest = JSON.parse(await readFile(path.join(repository, "public/fonts/noto-sans/manifest.json"), "utf8"));
  const fontLicense = await readFile(path.join(repository, "public/fonts/noto-sans/OFL.txt"));
  files.set("assets/provenance.json", provenanceBytes);
  for (const { record, bytes } of assets.values()) files.set(record.file, bytes);
  const businesses = [];

  for (const business of data) {
    const prefix = business.id;
    const { record: photoRecord, bytes: photo } = assets.get(business.brand.photoId);
    const local = new Map();
    const add = (file, bytes) => local.set(file, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8"));
    const catalog = table(["sku", "name", "unit", "priceKzt", "costKzt", "currency", "asOf"], business.catalog.map((row) => ({ ...row, priceKzt: row.price, costKzt: row.cost, currency: "KZT", asOf: business.asOf })));
    const suppliers = table(["supplierId", "supplierName", "sku", "description", "packQuantity", "unit", "packPriceKzt", "minPacks", "deliveryKzt", "leadDays", "validThrough", "taxBasis"], business.suppliers.map((row) => ({
      supplierId: row.id, supplierName: row.name, sku: row.sku, description: row.label, packQuantity: row.pack,
      unit: row.packUnit, packPriceKzt: row.price, minPacks: row.minPacks, deliveryKzt: row.delivery, leadDays: row.leadDays,
      validThrough: row.validThrough, taxBasis: "entered-gross-price-no-tax-inference",
    })));
    const quoteLines = table(["sku", "name", "quantity", "unit", "unitPriceKzt", "amountKzt"], business.quote.lines.map((row) => ({ ...row, unitPriceKzt: row.unitPrice, amountKzt: row.amount })));
    add("catalog.csv", catalog);
    add("supplier-offers.csv", suppliers);
    add("history.csv", historyCsv(business.history.rows));
    add("stock.csv", table(["sku", "quantity", "unit", "asOf", "scope"], business.catalog.map((row) => ({ sku: row.sku, quantity: row.stock, unit: row.unit, asOf: business.asOf, scope: "independent-synthetic-snapshot-not-a-reservation-ledger" }))));
    add("quote-lines.csv", quoteLines);
    add("cash-commitments.csv", table(["commitmentId", "kind", "amount", "currency", "dueDate", "status", "basis", "counterpartyId", "note"], business.commitments));
    add("work-resources.csv", table(["id", "label", "capacityHours", "availableDays", "from", "to", "exceptionDate", "exceptionHours"], business.workResources));
    add("work-plan.csv", table(["id", "title", "resourceId", "effortHours", "durationHours", "dependsOn", "dueDate"], business.tasks));
    if (business.bom.length) add("bill-of-materials.csv", table(["productSku", "materialSku", "quantityPerUnit", "materialUnit", "wastePercent", "note"], business.bom));
    const seriesColumns = ["month", "enquiries", "quality", "note"];
    add("forecast/train.csv", table(seriesColumns, business.enquiries.filter(({ split }) => split === "train")));
    add("forecast/validation.csv", table(seriesColumns, business.enquiries.filter(({ split }) => split === "validation")));
    add("forecast/holdout.csv", table(seriesColumns, business.enquiries.filter(({ split }) => split === "holdout")));
    add("request.txt", `${SYNTHETIC_NOTICE}\n\n${business.name}\n${business.goal}\n\n${business.quote.request}\n\n${business.quote.terms.join("\n")}\n\n${LOCALE_SAMPLE}\n`);
    add("quote-conditions.json", json({
      synthetic: true, requestId: business.quote.id, asOf: business.asOf, currency: "KZT", discountPercent: business.quote.discountPercent,
      enteredDeliveryKzt: business.quote.delivery, requestedDate: business.quote.requestedDate, eventDate: business.quote.requiredDate,
      taxStatus: business.quote.taxStatus, unresolvedFields: business.quote.unknowns, terms: business.quote.terms, calculation: business.quote.calculation,
    }));
    add("brand-kit.json", json({
      schemaVersion: 1, synthetic: true, ...business.brand, locale: "ru", availableUiLocales: ["ru", "kk", "en"], contentLanguageChangesOnlyByExplicitRequest: true,
      logo: { file: "brand-logo.svg", origin: "Authored educational vector wordmark, not the identity of a real business.", license: "CC0-1.0" },
      fonts: { family: "Noto Sans", source: fontManifest.source, revision: fontManifest.revision, license: fontManifest.license, applicationPath: "public/fonts/noto-sans", embedding: "PDF embeds checked local fonts; DOCX names the font; no proprietary font fallback promised." },
      images: [{ ...photoRecord, file: "product-photo.jpg" }],
      claims: { knownProductPropertiesOnly: true, fabricateTestimonials: false, impliedBusinessOwnershipOfPhoto: false },
    }));
    add("brand-logo.svg", logoSvg(business));
    add("product-photo.jpg", photo);
    add("photo-licence.json", json({ ...photoRecord, file: "product-photo.jpg" }));
    add("FONT-LICENSE.txt", fontLicense);
    add("business-materials.xlsx", await businessWorkbook(business));
    add("request.docx", await requestDocument(business, photo, photoRecord));
    add("terms.pdf", await termsPdf(business, photo, photoRecord));

    const history = historyOracle(local.get("history.csv"), catalog);
    const quote = quoteOracle(quoteLines, business.quote.discountPercent, business.quote.delivery);
    if (quote.knownTotalKzt !== business.quote.knownTotal || quote.subtotalKzt !== business.quote.subtotal || quote.discountKzt !== business.quote.discount) {
      throw new Error(`${business.id} quote failed independent arithmetic.`);
    }
    const procurement = procurementOracle(suppliers, business.supplierTarget);
    const golden = {
      schemaVersion: 1, synthetic: true, businessId: business.id, seed, history, quote,
      procurement: { target: business.supplierTarget, priceMeaning: "Entered gross prices and entered delivery only; no statutory tax rate is assumed.", candidates: procurement },
      missing: business.history.issues.filter(({ type }) => type.startsWith("missing-")),
      issues: business.history.issues, outliers: business.history.outliers,
      revisions: { sources: 1, mapping: 1, rawRecordKey: ["operationId", "lineId"], catalogRecordKey: ["sku"], supplierRecordKey: ["supplierId", "sku"] },
      forecast: {
        target: "monthly-enquiries-in-existing-channels", unit: "enquiry", frequency: "month", sampleCount: 60,
        sourceRelationship: "Independent synthetic count of enquiries; not inferred sales, historical revenue or measured customer data. No personal identifiers.",
        annualSeasonality: true, patternSource: "Authored synthetic month-of-year factors; not regional statistics.",
        train: { file: "forecast/train.csv", from: "2021-01-01", to: "2023-12-01", count: 36 },
        validation: { file: "forecast/validation.csv", from: "2024-01-01", to: "2024-12-01", count: 12 },
        holdout: { file: "forecast/holdout.csv", from: "2025-01-01", to: "2025-12-01", count: 12, usage: "Final assessment only, never fit or select models on this file." },
        rollingOrigins: [{ trainEnd: "2023-12-01", testFrom: "2024-01-01", testTo: "2024-06-01" }, { trainEnd: "2024-06-01", testFrom: "2024-07-01", testTo: "2024-12-01" }],
        outliers: business.enquiries.filter(({ quality }) => quality === "flagged-outlier").map(({ month, enquiries }) => ({ month, value: enquiries })),
        generationHasFutureValues: true, initialModelFitAllowedFiles: ["forecast/train.csv"], modelSelectionAllowedFiles: ["forecast/validation.csv"],
        rollingFitMayUseEarlierValidation: "Only observations on or before the current rolling-origin training cutoff; never later observations in that fold.",
        finalRefitAllowedFiles: ["forecast/train.csv", "forecast/validation.csv"],
        forecastsGenerated: false, accuracyClaimed: false, businessEffectClaimed: false,
        independentlyParsedSplits: forecastOracle({ train: local.get("forecast/train.csv"), validation: local.get("forecast/validation.csv"), holdout: local.get("forecast/holdout.csv") }),
      },
    };
    add("golden.json", json(golden));
    const quickStart = ["catalog.csv", "request.docx", "terms.pdf", "brand-kit.json", "brand-logo.svg", "product-photo.jpg", "photo-licence.json", "FONT-LICENSE.txt", "quote-conditions.json"];
    add("quick-start.zip", await stableZip(quickStart.map((name) => [name, local.get(name)])));
    const fullInputs = [...local].filter(([name]) => name !== "golden.json" && name !== "quick-start.zip" && name !== "forecast/holdout.csv" && name !== "forecast/validation.csv");
    add("working-inputs.zip", await stableZip(fullInputs));
    for (const [name, bytes] of local) files.set(`${prefix}/${name}`, bytes);
    businesses.push({
      id: business.id, sector: business.sector, name: business.name, description: business.description, freeformExampleGoal: business.goal,
      synthetic: true, asOf: business.asOf, timezone: "Asia/Qyzylorda", currency: "KZT", sourceLocale: "ru", seed: business.seed,
      quickStart: { archive: `${prefix}/quick-start.zip`, entries: quickStart.map((file) => `${prefix}/${file}`), purpose: "Small initial request, price list, conditions and brand inputs. History is not required to draft a useful proposal." },
      workingInputs: { archive: `${prefix}/working-inputs.zip`, purpose: "The same standalone inputs intended for normal import services; excludes test goldens and future evaluation splits." },
      forecastEvaluationOnly: [`${prefix}/forecast/validation.csv`, `${prefix}/forecast/holdout.csv`],
      golden: `${prefix}/golden.json`,
      inputs: [
        inputDescriptor(`${prefix}/catalog.csv`, "catalog", `${prefix}-catalog`, ["sku"]),
        inputDescriptor(`${prefix}/supplier-offers.csv`, "supplier-offers", `${prefix}-supplier-offers`, ["supplierId", "sku"]),
        inputDescriptor(`${prefix}/history.csv`, "operation-history", `${prefix}-history`, ["Операция", "Строка"], "append"),
        inputDescriptor(`${prefix}/stock.csv`, "stock-snapshot", `${prefix}-stock`, ["sku"]),
        inputDescriptor(`${prefix}/cash-commitments.csv`, "cash-commitments", `${prefix}-commitments`, ["commitmentId"], "upsert"),
      ],
      expectedIssues: { history: business.history.issues, quote: business.quote.unknowns, suppliers: procurement.filter(({ eligibleForCompleteCostRanking }) => !eligibleForCompleteCostRanking) },
      knownQuoteTotalKzt: quote.knownTotalKzt, finalQuoteTotalKzt: null,
    });
  }

  const manifest = {
    schemaVersion: 1, generatorVersion: "1.0.0", checkpoint: "01.3.1", seed, timestamp: FIXED_TIMESTAMP, synthetic: true,
    notice: SYNTHETIC_NOTICE, locales: ["ru", "kk", "en"], sourceLanguage: "ru", businesses,
    commands: { generate: "node scripts/fixtures/generate.mjs", verify: "node scripts/fixtures/verify.mjs", regenerateAssets: "node scripts/fixtures/fetch-assets.mjs" },
    reproducibility: { fixedOfficeTimestamps: true, orderedZipEntries: true, explicitDrawingIds: true, runtime: "Node22.13+", dependencies: "Pinned package-lock.json", normalGenerationUsesNetwork: false },
    interpretation: {
      acceptedHistory: "Exact duplicates collapse only by a confirmed event key. All differing candidates for one event key are quarantined; rows missing date/SKU/currency are excluded until reviewed. Goldens describe this policy, not a silent production import decision.",
      noBusinessClaims: true, noRealCustomersOrStaff: true, noInterviewsOrPartners: true,
      originalAuthorAttributionIsPublicLicenceMetadata: true,
      forecastEvaluationIsNotTraining: true, formulaResultsAreCachedKnownAnswersNotCalculatedByExcelJS: true,
      UIOrOfficeVisualVerification: "Not performed; file structures, extracted text, exact amounts and reproducibility are checked without a browser or renderer.",
      followupCheckpoint: "01.3.2 adds controlled changes, schema drift, insufficient series and a separate100000-row stress input after checkpoint release.",
    },
    generatedContentLicence: { identifier: "CC0-1.0", scope: "Authored synthetic records, prose and sample vector logos; third-party photographs and fonts retain their separately recorded licences." },
    fontLicence: { family: fontManifest.family, license: fontManifest.license, source: fontManifest.source, revision: fontManifest.revision, licenseSha256: sha256(fontLicense), licenceFiles: businesses.map(({ id }) => `${id}/FONT-LICENSE.txt`), vendorFontsCopied: false },
    files: [...files].sort(([a], [b]) => a.localeCompare(b, "en")).map(([file, bytes]) => ({ file, mediaType: mediaType(file), bytes: bytes.length, sha256: sha256(bytes), provenance: file.endsWith("FONT-LICENSE.txt") ? "public/fonts/noto-sans/manifest.json" : file.startsWith("assets/") || file.endsWith("product-photo.jpg") ? "assets/provenance.json" : "seeded-synthetic-generator" })),
  };
  files.set("manifest.json", json(manifest));
  return { files, manifest };
}

export async function writeFixtureFiles({ outputDirectory = FIXTURE_ROOT, seed = DEFAULT_SEED } = {}) {
  const { files, manifest } = await generateFixtureFiles({ seed });
  const root = path.resolve(outputDirectory);
  for (const [file, bytes] of files) {
    const destination = path.resolve(root, file);
    if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Fixture output escaped its destination.");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { seed: { type: "string" }, out: { type: "string" } } });
  const manifest = await writeFixtureFiles({ seed: values.seed === undefined ? DEFAULT_SEED : Number(values.seed), outputDirectory: values.out === undefined ? FIXTURE_ROOT : path.resolve(values.out) });
  console.log(`Generated ${manifest.businesses.length} synthetic businesses, ${manifest.files.length + 1} files, seed ${manifest.seed}.`);
}
