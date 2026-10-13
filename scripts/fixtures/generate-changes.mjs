import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Decimal from "decimal.js";
import { createBusinessData, csvBuffer, historyCsv } from "./data.mjs";
import { DEFAULT_SEED, FIXED_TIMESTAMP, SYNTHETIC_NOTICE } from "./definitions.mjs";
import { stableZip } from "./formats.mjs";
import { parseCsv, quoteOracle } from "./oracle.mjs";
import { catalogChangeOracle, eligibilityOracle, manualEditOracle, overlapOracle } from "./change-oracle.mjs";
import { readStressArchive, writeStressArchive } from "./stress.mjs";

export const CHANGE_ROOT = fileURLToPath(new URL("../../fixtures/business/", import.meta.url));
export const STRESS_ARCHIVE = "stress/history-100000.csv.zip";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const table = (columns, rows, options) => csvBuffer(columns, rows.map((row) => columns.map((column) => row[column])), options);
const CATALOG_COLUMNS = ["sku", "name", "unit", "priceKzt", "costKzt", "currency", "asOf"];
const QUOTE_COLUMNS = ["sku", "name", "quantity", "unit", "unitPriceKzt", "amountKzt"];
const mapping = { "На дату": "asOf", "Код позиции": "sku", "Позиция": "name", "Цена, тг": "priceKzt", "Валюта": "currency", "Ед. измерения": "unit", "Себестоимость, тг": "costKzt" };
const priceDelta = { homegoods: "275.50", services: "65.00", manufacturing: "1000.00" };
const manualText = {
  homegoods: "Кружки только 300 мл. Упаковку и дату согласуем отдельно; замену на 450 мл не принимать без подтверждения.",
  services: "Расчёт на подтверждённые 180 м². Дополнительную площадь и наружные окна обсудим отдельно, обещание стерильности не используем.",
  manufacturing: "Персонализацию обсудим после получения макета. Сушку оставляем отдельным ожиданием, а не трудозатратами сотрудника.",
};

export async function buildChangeFiles({ root = CHANGE_ROOT, seed = DEFAULT_SEED } = {}) {
  const baseManifestBytes = await readFile(path.join(root, "manifest.json"));
  const baseManifest = JSON.parse(baseManifestBytes);
  assert.equal(baseManifest.checkpoint, "01.3.1");
  assert.equal(baseManifest.seed, seed, "Changes and baseline must use the same seed.");
  const files = new Map();
  const businesses = [];
  for (const business of createBusinessData(seed)) {
    const prefix = `changes/${business.id}`;
    const local = new Map();
    const add = (file, bytes) => local.set(file, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    const baselineBytes = await readFile(path.join(root, business.id, "catalog.csv"));
    assert.equal(hash(baselineBytes), baseManifest.files.find(({ file }) => file === `${business.id}/catalog.csv`).sha256);
    const catalog = parseCsv(baselineBytes);
    const changedSku = business.quote.lines[0].sku;
    const changedIndex = catalog.findIndex(({ sku }) => sku === changedSku);
    const changed = catalog.map((row, index) => index === changedIndex ? { ...row, priceKzt: new Decimal(row.priceKzt).plus(priceDelta[business.id]).toFixed(2) } : { ...row });
    const added = { ...catalog[0], sku: { homegoods: "009901", services: "019901", manufacturing: "029901" }[business.id], name: "Новая учебная позиция, не замена отсутствующей" };
    const removed = catalog.at(-1);
    const collection = `${business.id}-catalog`;
    const baseline = `${business.id}/catalog.csv`;
    add("catalog-reordered.csv", table(CATALOG_COLUMNS, [...catalog].reverse()));
    add("catalog-new-price.csv", table(CATALOG_COLUMNS, changed));
    add("catalog-upsert-partial.csv", table(CATALOG_COLUMNS, [changed[changedIndex], added]));
    add("catalog-missing-row.csv", table(CATALOG_COLUMNS, catalog.slice(0, -1)));
    add("catalog-duplicate-key.csv", table(CATALOG_COLUMNS, [...catalog, { ...catalog[0], name: "Другая учебная позиция с ошибочно повторённым артикулом" }]));
    const keyless = catalog.slice(0, 4).map(({ name, unit, priceKzt, currency }) => ({ name, unit, priceKzt, currency }));
    add("catalog-no-key-before.csv", table(Object.keys(keyless[0]), keyless));
    add("catalog-no-key-renamed.csv", table(Object.keys(keyless[0]), keyless.map((row, index) => index === 0 ? { ...row, name: `${row.name}, новое название`, priceKzt: changed[changedIndex].priceKzt } : row)));
    const drifted = catalog.map((row) => Object.fromEntries(Object.entries(mapping).map(([column, field]) => [column, field.endsWith("Kzt") ? row[field].replace(".", ",") : row[field]])));
    add("catalog-schema-drift.csv", table(Object.keys(mapping), drifted, { delimiter: ";", bom: true }));
    add("schema-mapping.json", json({
      synthetic: true, priorMappingRevision: 1, proposedMappingRevision: 2, requiresConfirmation: true,
      delimiter: ";", encoding: "UTF-8 with BOM", decimalSeparator: ",", columnMapping: mapping,
      requiredMissingPriorColumns: CATALOG_COLUMNS, recordKeySpec: { fields: ["sku"], type: "string", preserveLeadingZeros: true },
      priorMappingResult: "schema-drift-blocked-no-binding-updates", afterConfirmedMapping: "same-record-identities-and-values",
    }));
    const refreshedLines = business.quote.lines.map((line) => {
      const item = changed.find(({ sku }) => sku === line.sku);
      return { ...line, unitPriceKzt: item.priceKzt, amountKzt: new Decimal(line.quantity).times(item.priceKzt).toFixed(2) };
    });
    add("quote-new-price.csv", table(QUOTE_COLUMNS, refreshedLines));
    const refreshedQuote = quoteOracle(local.get("quote-new-price.csv"), business.quote.discountPercent, business.quote.delivery);
    const manual = {
      synthetic: true, format: "fixture-contract-not-runtime-artifact", artifactId: `fixture:${business.id}:proposal`,
      currentArtifactRevision: 2, sourceBefore: { collection, sourceRevision: 1, resolutionRevision: 1 },
      sourceAfterAcceptance: { collection, sourceRevision: 2, resolutionRevision: 2 },
      binding: { recordId: `fixture:${collection}:${changedSku}`, fieldId: "priceKzt", pinnedFactRevisionBefore: 1, pinnedFactRevisionAfter: 2 },
      manualField: { fieldId: "offer-introduction", revision: 2, origin: "human", value: manualText[business.id] },
      staleProposal: { baseArtifactRevision: 1, targets: ["offer-introduction", "quote-known-total"], proposedText: "Автоматическая переформулировка из устаревшего черновика. Не должна заменить ручной текст." },
      freshProposal: { baseArtifactRevision: 2, targets: ["quote-known-total"], preserveFields: ["offer-introduction"] },
      oldKnownTotalKzt: business.quote.knownTotal, newKnownTotalKzt: refreshedQuote.knownTotalKzt,
      contractScope: "Source acceptance and artifact proposal acceptance are distinct. These expectations do not perform an import or an editor command.",
    };
    add("manual-edit.json", json(manual));
    const events = business.history.rows.slice(0, 6).map((row) => ({ ...row }));
    const newEvents = [0, 1].map((offset) => ({ ...events[offset], operationId: `${business.id.toUpperCase()}-NEXT-${String(offset + 1).padStart(3, "0")}`, date: `2026-01-0${offset + 2}` }));
    const conflicting = { ...events[2], unitPrice: new Decimal(events[2].unitPrice).plus(100).toFixed(2) };
    conflicting.netAmount = new Decimal(conflicting.quantity).times(conflicting.unitPrice).times(new Decimal(1).minus(new Decimal(conflicting.discountPercent).div(100))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    add("history-overlap-before.csv", historyCsv(events));
    add("history-overlap-incoming.csv", historyCsv([events[4], newEvents[0], events[5], conflicting, newEvents[1]]));
    const cases = [
      { id: "reorder", baseline, incoming: "catalog-reordered.csv", mode: "upsert", complete: false, purpose: "Row order changes only raw lineage, never stable identity or field value." },
      { id: "same-file", baseline, incoming: "catalog-reordered.csv", repeatOf: "reorder", mode: "upsert", complete: false, purpose: "Retry the accepted reorder with the same bytes and operation key; zero new records, effects or revisions." },
      { id: "upsert-new-price", baseline, incoming: "catalog-new-price.csv", mode: "upsert", complete: false, purpose: "Confirmed SKU keeps recordId; only price fact revision and dependent proposals change." },
      { id: "upsert-partial", baseline, incoming: "catalog-upsert-partial.csv", mode: "upsert", complete: false, purpose: "Add one explicit new key and update one price; absent records are retained." },
      { id: "missing-full-snapshot", baseline, incoming: "catalog-missing-row.csv", mode: "replace-snapshot", complete: true, purpose: "Only explicit confirmed complete snapshot permits a tombstone; old bindings stay missing, never move to a different row." },
      { id: "missing-unconfirmed-snapshot", baseline, incoming: "catalog-missing-row.csv", mode: "replace-snapshot", complete: false, purpose: "Unconfirmed completeness or partial parsing cannot prove a deletion." },
      { id: "duplicate-record-key", baseline, incoming: "catalog-duplicate-key.csv", mode: "upsert", complete: false, purpose: "Non-unique key candidates are unresolved before any update of their bindings." },
      { id: "rename-no-key", baseline: `${prefix}/catalog-no-key-before.csv`, incoming: "catalog-no-key-renamed.csv", mode: "upsert", hasKey: false, purpose: "Neither a similar name nor a changed price proves identity; unchanged fingerprints are confirmation candidates only." },
    ].map((scenario) => ({
      ...scenario, collection, sourceVersionBefore: scenario.id === "same-file" ? 2 : 1, operationKey: `fixture:${business.id}:${scenario.repeatOf ?? scenario.id}`,
      recordKeySpec: scenario.hasKey === false ? null : { fields: ["sku"], type: "string", normalization: "none-preserve-leading-zeros" },
      expected: scenario.id === "same-file" ? {
        acceptedContentSha256: hash(local.get(scenario.incoming)), sameOperationAs: "reorder", reusesAcceptedSourceVersion: true, acceptedSourceVersion: 2,
        newRecords: 0, changedFactRevisions: 0, changedArtifactRevisions: 0, newResolutionVersions: 0, sideEffects: 0,
      } : catalogChangeOracle(scenario.hasKey === false ? local.get("catalog-no-key-before.csv") : baselineBytes, local.get(scenario.incoming), { ...scenario, collection }),
    }));
    const forecastCases = [
      { id: "daily-short", frequency: "daily", count: 55 }, { id: "weekly-short", frequency: "weekly", count: 25 },
      { id: "monthly-short", frequency: "monthly", count: 23 }, { id: "monthly-gap", frequency: "monthly", count: 25, gap: true },
      { id: "annual-season-short", frequency: "monthly", count: 35, requestAnnualSeasonality: true },
    ].map((spec) => {
      const rows = Array.from({ length: spec.count }, (_, index) => {
        const offset = index + (spec.gap && index >= 10 ? 1 : 0);
        const date = spec.frequency === "monthly" ? new Date(Date.UTC(2021, offset, 1)) : new Date(Date.UTC(2021, 0, 1 + offset * (spec.frequency === "weekly" ? 7 : 1)));
        return { date: date.toISOString().slice(0, 10), enquiries: business.enquiries[index].enquiries, provenance: "synthetic-not-business-observations" };
      });
      const file = `forecast/${spec.id}.csv`;
      add(file, table(["date", "enquiries", "provenance"], rows));
      return { file, ...spec, expected: eligibilityOracle(local.get(file), spec) };
    });
    const normalizedDrift = drifted.map((row) => Object.fromEntries(Object.entries(mapping).map(([source, target]) => [target, target.endsWith("Kzt") ? row[source].replace(",", ".") : row[source]])));
    const golden = {
      schemaVersion: 1, checkpoint: "01.3.2", synthetic: true, seed, businessId: business.id,
      scope: "Fixture contract expectations only, not evidence that a production importer/editor/forecast engine is implemented.",
      catalogCases: cases,
      missingRecord: { sku: removed.sku, recordId: `fixture:${collection}:${removed.sku}`, oldBindingAfterConfirmedRemoval: "missing-tombstoned-record-not-rebound-to-row-position" },
      overlap: { baseline: "history-overlap-before.csv", incoming: "history-overlap-incoming.csv", collection: `${business.id}-history`, mode: "append", recordKeySpec: ["Операция", "Строка"], expected: overlapOracle(local.get("history-overlap-before.csv"), local.get("history-overlap-incoming.csv"), `${business.id}-history`) },
      schemaDrift: { file: "catalog-schema-drift.csv", mapping: "schema-mapping.json", beforeConfirmation: { status: "schema-drift", bindingUpdates: 0 }, afterExplicitConfirmation: catalogChangeOracle(baselineBytes, table(CATALOG_COLUMNS, normalizedDrift), { collection, mode: "upsert" }) },
      priceChange: { sku: changedSku, beforeKzt: catalog[changedIndex].priceKzt, afterKzt: changed[changedIndex].priceKzt, deltaKzt: priceDelta[business.id], quoteBeforeKzt: business.quote.knownTotal, quoteAfter: refreshedQuote },
      manualEdit: { file: "manual-edit.json", expected: manualEditOracle(manual, refreshedQuote) }, forecastCases,
    };
    add("expected.json", json(golden));
    add("instructions.txt", `${SYNTHETIC_NOTICE}\n\nКонтрольные изменения: ${business.name}.\nИсходный прайс: ../../${baseline}\nКаждый catalog case начинается заново с исходного прайса, кроме same-file: это повтор уже принятого reorder с тем же ключом операции.\nНовая цена не утверждает вручную новый документ: ожидается предложение адресного обновления.\nmanual-edit.json и expected.json задают тестовые ожидания; не загружать их как деловые исходники.\nИзменённая схема требует подтверждения нового сопоставления. Без ключа имя и цена не доказывают идентичность.\nКороткие и нерегулярные ряды не дают разрешения рисовать прогноз.\nФайлы можно копировать и менять для собственных проверок; эталоны относятся только к исходным байтам.\nРеального бизнеса, клиентов, работников и эффекта на выручку здесь нет.\n`);
    const inputs = [...local].filter(([file]) => file.endsWith(".csv") || file === "instructions.txt");
    add("change-inputs.zip", await stableZip(inputs));
    for (const [file, bytes] of local) files.set(`${prefix}/${file}`, bytes);
    businesses.push({ id: business.id, baseline, inputs: `${prefix}/change-inputs.zip`, expected: `${prefix}/expected.json`, manualEdit: `${prefix}/manual-edit.json`, scenarioIds: cases.map(({ id }) => id) });
  }
  return { files, baseManifestSha256: hash(baseManifestBytes), businesses };
}

export function changeManifest({ files, baseManifestSha256, businesses, stressBytes, stress, seed }) {
  return {
    schemaVersion: 1, checkpoint: "01.3.2", generatorVersion: "1.0.0", synthetic: true, seed, timestamp: FIXED_TIMESTAMP,
    notice: SYNTHETIC_NOTICE, baseline: { file: "manifest.json", checkpoint: "01.3.1", sha256: baseManifestSha256, unchanged: true }, businesses,
    commands: { generateAll: "npm run fixtures:generate", verifyAll: "npm run fixtures:verify", generateChangesOnly: "node scripts/fixtures/generate-changes.mjs", verifyChangesOnly: "node scripts/fixtures/verify-changes.mjs" },
    reproducibility: { networkRequired: false, dependencies: "Pinned package-lock.json", fixedZipTimestamp: FIXED_TIMESTAMP, stressGenerationBatchRows: 250, stressVerification: "Streaming csv-parse + rational BigInt sums; retain one previous row and small SKU/month aggregates, never the full decompressed CSV." },
    stress: {
      archive: STRESS_ARCHIVE, businessId: "homegoods", collection: "synthetic-stress-history", suggestedImportMode: "append", recordKeySpec: ["operationId", "lineId"],
      scope: "Separate synthetic volume test, not a larger version of the normal business history; never concatenate it with baseline business history.",
      use: "Extract the single CSV locally and send that CSV through the ordinary import path. ZIP import support is not assumed.",
      initialImportLimitBytes: 20_000_000, csv: stress,
      exclusionsFromNormalImports: ["quick-start.zip", "working-inputs.zip", "change-inputs.zip"],
      importerThroughputOrMemoryClaimed: false,
    },
    interpretation: { specificationOnly: true, productionImporterImplemented: false, forecastAccuracyClaimed: false, businessEffectClaimed: false, noRealPII: true, noRealPartnersOrStaff: true, visualVerification: "Not performed. Data, archive structure, exact sums and file hashes only." },
    generatedContentLicence: "CC0-1.0; authored synthetic records and text only, no new third-party assets.",
    files: [...files].sort(([a], [b]) => a.localeCompare(b, "en")).map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes) })).concat([{ file: STRESS_ARCHIVE, bytes: stressBytes.length, sha256: hash(stressBytes) }]),
  };
}

export async function writeChangeFixtureFiles({ root = CHANGE_ROOT, seed = DEFAULT_SEED } = {}) {
  root = path.resolve(root);
  const bundle = await buildChangeFiles({ root, seed });
  for (const [file, bytes] of bundle.files) {
    const destination = path.resolve(root, file);
    assert.ok(destination.startsWith(`${root}${path.sep}`), "Changes output escaped destination.");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  await mkdir(path.join(root, "stress"), { recursive: true });
  await writeStressArchive(path.join(root, STRESS_ARCHIVE), { seed });
  const stress = await readStressArchive(path.join(root, STRESS_ARCHIVE));
  const stressBytes = await readFile(path.join(root, STRESS_ARCHIVE));
  const manifest = changeManifest({ ...bundle, stress, stressBytes, seed });
  await writeFile(path.join(root, "changes/manifest.json"), json(manifest));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { seed: { type: "string" }, root: { type: "string" } } });
  const manifest = await writeChangeFixtureFiles({ seed: values.seed === undefined ? DEFAULT_SEED : Number(values.seed), root: values.root ?? CHANGE_ROOT });
  console.log(`Generated ${manifest.businesses.length} synthetic change packs and ${manifest.stress.csv.dataRows} stress rows, ${manifest.files.length + 1} additive files.`);
}
