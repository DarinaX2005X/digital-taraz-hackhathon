import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import JSZip from "jszip";
import { csvBuffer } from "./data.mjs";
import { DEFAULT_SEED } from "./definitions.mjs";
import { catalogChangeOracle, eligibilityOracle, manualEditOracle, overlapOracle } from "./change-oracle.mjs";
import { buildChangeFiles, changeManifest, CHANGE_ROOT, STRESS_ARCHIVE } from "./generate-changes.mjs";
import { parseCsv, quoteOracle } from "./oracle.mjs";
import { inspectStressArchive, stressArchiveDigest } from "./stress.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const quoteTotals = { homegoods: "148151.40", services: "143600.00", manufacturing: "602125.00" };
const overlapTotals = { homegoods: "157500.00", services: "296175.76", manufacturing: "594230.00" };

export async function verifyChangeFixtures({ root = CHANGE_ROOT } = {}) {
  root = path.resolve(root);
  const manifestBytes = await readFile(path.join(root, "changes/manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.checkpoint, "01.3.2");
  assert.equal(manifest.synthetic, true);
  const baselineBytes = await readFile(path.join(root, "manifest.json"));
  assert.equal(hash(baselineBytes), manifest.baseline.sha256, "Baseline manifest changed.");
  const baseline = JSON.parse(baselineBytes);
  for (const entry of baseline.files) {
    const bytes = await readFile(path.join(root, entry.file));
    assert.equal(hash(bytes), entry.sha256, `Baseline bytes changed: ${entry.file}`);
  }
  if (manifest.seed === DEFAULT_SEED) assert.equal(manifest.baseline.sha256, "1009f2e2a963d51b6637cee0c620fbc473a6c0e40a460db55f8516d6951bf416", "Previously accepted default baseline was rewritten.");
  const actual = new Map();
  for (const entry of manifest.files) {
    assert.ok(entry.file.startsWith("changes/") || entry.file === STRESS_ARCHIVE);
    const filename = path.resolve(root, entry.file);
    assert.ok(filename.startsWith(`${root}${path.sep}`));
    const bytes = await readFile(filename);
    assert.equal(bytes.length, entry.bytes, `File size changed: ${entry.file}`);
    assert.equal(hash(bytes), entry.sha256, `File hash changed: ${entry.file}`);
    actual.set(entry.file, bytes);
  }
  assert.equal(actual.size, manifest.files.length, "Duplicate manifest entry.");
  const regenerated = await buildChangeFiles({ root, seed: manifest.seed });
  for (const [file, bytes] of regenerated.files) assert.deepEqual(actual.get(file), bytes, `Non-reproducible change fixture: ${file}`);
  const stressBytes = actual.get(STRESS_ARCHIVE);
  const stress = await inspectStressArchive(stressBytes);
  assert.deepEqual(stress, manifest.stress.csv);
  const digest = await stressArchiveDigest({ seed: manifest.seed });
  assert.equal(digest.sha256, hash(stressBytes), "Stress archive is not byte-reproducible.");
  assert.equal(digest.bytes, stressBytes.length);
  if (manifest.seed === DEFAULT_SEED) {
    assert.equal(stress.netRevenueKzt, "1209650960.00");
    assert.equal(stress.netCostKzt, "734598070.00");
    assert.equal(stress.bytes, 10103061);
    assert.equal(stress.sha256, "e4a8e61e6d5ac1cdfe6859b514eef34f41e348a95dd10fd12f6810fd7e1b4783");
  }
  assert.equal(stress.reductionRows, 5000);
  assert.equal(stress.bySku.length, 8);
  assert.equal(stress.byMonth.length, 12);
  assert.deepEqual(manifestBytes, json(changeManifest({ ...regenerated, stressBytes, stress, seed: manifest.seed })));

  const evidence = [];
  for (const business of manifest.businesses) {
    const prefix = `changes/${business.id}/`;
    const local = (file) => actual.get(`${prefix}${file}`);
    const golden = JSON.parse(actual.get(business.expected));
    const catalog = await readFile(path.join(root, business.baseline));
    for (const scenario of golden.catalogCases) {
      const input = local(scenario.incoming);
      if (scenario.id === "same-file") {
        const first = golden.catalogCases.find(({ id }) => id === scenario.repeatOf);
        assert.equal(first.operationKey, scenario.operationKey);
        assert.deepEqual(local(first.incoming), input);
        assert.equal(hash(input), scenario.expected.acceptedContentSha256);
        assert.equal(scenario.sourceVersionBefore, scenario.expected.acceptedSourceVersion);
        assert.equal(scenario.expected.sideEffects, 0);
      } else {
        const before = scenario.hasKey === false ? local("catalog-no-key-before.csv") : catalog;
        assert.deepEqual(catalogChangeOracle(before, input, scenario), scenario.expected);
      }
    }
    const findCase = (id) => golden.catalogCases.find((scenario) => scenario.id === id).expected;
    const reorder = findCase("reorder");
    assert.equal(reorder.preservedRecordIds.length, 8);
    assert.equal(reorder.updated.length, 0);
    assert.equal(reorder.lineage[0].recordId, `fixture:${business.id}-catalog:${parseCsv(catalog).at(-1).sku}`);
    const price = findCase("upsert-new-price");
    assert.equal(price.preservedRecordIds.length, 8);
    assert.equal(price.updated.length, 1);
    assert.equal(price.updated[0].fields.length, 1);
    assert.equal(price.updated[0].fields[0].fieldId, "priceKzt");
    const partial = findCase("upsert-partial");
    assert.equal(partial.createdRecordIds.length, 1);
    assert.equal(partial.updated.length, 1);
    assert.equal(partial.retainedAbsentRecordIds.length, 7);
    assert.equal(partial.tombstonedRecordIds.length, 0);
    assert.deepEqual(findCase("missing-full-snapshot").tombstonedRecordIds, [golden.missingRecord.recordId]);
    assert.deepEqual(findCase("missing-unconfirmed-snapshot").retainedAbsentRecordIds, [golden.missingRecord.recordId]);
    assert.equal(findCase("missing-unconfirmed-snapshot").tombstonedRecordIds.length, 0);
    assert.equal(findCase("duplicate-record-key").unresolved.length, 1);
    assert.equal(findCase("duplicate-record-key").updated.length, 0);
    assert.equal(findCase("rename-no-key").unresolved.length, 1);
    assert.equal(findCase("rename-no-key").lineage.length, 3);
    assert.equal(findCase("rename-no-key").createdRecordIds.length, 0);

    const remap = JSON.parse(local("schema-mapping.json"));
    assert.equal(remap.requiresConfirmation, true);
    const drifted = parseCsv(local("catalog-schema-drift.csv"), remap.delimiter);
    assert.ok(remap.requiredMissingPriorColumns.every((column) => !(column in drifted[0])));
    const remapped = drifted.map((row) => Object.fromEntries(Object.entries(remap.columnMapping).map(([source, target]) => [target, target.endsWith("Kzt") ? row[source].replace(",", ".") : row[source]])));
    const columns = Object.keys(parseCsv(catalog)[0]);
    const remappedCsv = csvBuffer(columns, remapped.map((row) => columns.map((column) => row[column])));
    assert.deepEqual(remappedCsv, catalog, "Confirmed schema mapping changes underlying data.");
    assert.deepEqual(catalogChangeOracle(catalog, remappedCsv, { collection: `${business.id}-catalog`, mode: "upsert" }), golden.schemaDrift.afterExplicitConfirmation);
    assert.equal(golden.schemaDrift.beforeConfirmation.bindingUpdates, 0);

    assert.deepEqual(overlapOracle(local(golden.overlap.baseline), local(golden.overlap.incoming), golden.overlap.collection), golden.overlap.expected);
    assert.equal(golden.overlap.expected.repeatedEventKeys.length, 2);
    assert.equal(golden.overlap.expected.addedEventKeys.length, 2);
    assert.equal(golden.overlap.expected.conflicts.length, 1);
    assert.equal(golden.overlap.expected.acceptedRowsAfter, 8);
    if (manifest.seed === DEFAULT_SEED) assert.equal(golden.overlap.expected.netRevenueKztAfter, overlapTotals[business.id]);

    const conditions = JSON.parse(await readFile(path.join(root, business.id, "quote-conditions.json")));
    const quote = quoteOracle(local("quote-new-price.csv"), conditions.discountPercent, conditions.enteredDeliveryKzt);
    assert.deepEqual(quote, golden.priceChange.quoteAfter);
    assert.equal(quote.knownTotalKzt, quoteTotals[business.id]);
    assert.equal(quote.finalTotalKzt, null);
    const manual = JSON.parse(local("manual-edit.json"));
    assert.deepEqual(manualEditOracle(manual, quote), golden.manualEdit.expected);
    assert.equal(golden.manualEdit.expected.staleProposal.appliedOperations, 0);
    assert.equal(golden.manualEdit.expected.sourceOnlyRefresh.preservedText, manual.manualField.value);
    assert.equal(manual.binding.recordId, price.updated[0].recordId);

    for (const series of golden.forecastCases) {
      assert.deepEqual(eligibilityOracle(local(series.file), series), series.expected);
      assert.equal(series.expected.eligibleForRequestedModel, false);
      assert.equal(series.expected.forecastValues, null);
      if (series.id === "annual-season-short") assert.equal(series.expected.eligibleForRegularModel, true);
      else assert.equal(series.expected.eligibleForRegularModel, false);
    }
    const archive = await JSZip.loadAsync(actual.get(business.inputs));
    const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir);
    const expectedInputs = [...regenerated.files.keys()].filter((file) => file.startsWith(prefix) && (file.endsWith(".csv") || file.endsWith("/instructions.txt"))).map((file) => file.slice(prefix.length));
    assert.deepEqual(names.sort(), expectedInputs.sort());
    for (const name of names) assert.deepEqual(await archive.file(name).async("nodebuffer"), local(name));
    for (const filename of ["quick-start.zip", "working-inputs.zip"]) {
      const normal = await JSZip.loadAsync(await readFile(path.join(root, business.id, filename)));
      assert.ok(!Object.keys(normal.files).some((file) => /stress|100000|changes|expected\.json|manual-edit/.test(file)), "Stress or test oracles leaked into normal inputs.");
    }
    evidence.push({ businessId: business.id, catalogCases: golden.catalogCases.length, forecastCases: golden.forecastCases.length, newQuoteKnownTotalKzt: quote.knownTotalKzt, overlapAcceptedRows: golden.overlap.expected.acceptedRowsAfter });
  }
  return { files: manifest.files.length + 1, baselineFilesUnchanged: baseline.files.length + 1, businesses: evidence, stress: { rows: stress.dataRows, csvBytes: stress.bytes, zipBytes: stressBytes.length, netRevenueKzt: stress.netRevenueKzt, netCostKzt: stress.netCostKzt }, method: "No production importer, browser, UI renderer or forecast model was executed." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  console.log(JSON.stringify(await verifyChangeFixtures({ root: values.root ?? CHANGE_ROOT }), null, 2));
}
