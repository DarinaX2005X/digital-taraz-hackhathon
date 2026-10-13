import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogChangeOracle, eligibilityOracle, manualEditOracle } from "../../scripts/fixtures/change-oracle.mjs";
import { csvBuffer } from "../../scripts/fixtures/data.mjs";
import { DEFAULT_SEED } from "../../scripts/fixtures/definitions.mjs";
import { stableZip } from "../../scripts/fixtures/formats.mjs";
import { CHANGE_ROOT } from "../../scripts/fixtures/generate-changes.mjs";
import { parseCsv } from "../../scripts/fixtures/oracle.mjs";
import { inspectStressArchive, STRESS_CSV, stressCsvChunks } from "../../scripts/fixtures/stress.mjs";
import { verifyChangeFixtures } from "../../scripts/fixtures/verify-changes.mjs";

describe("controlled synthetic change fixtures, not a production importer", () => {
  it("reproduces all additions, preserves baseline bytes and streams 100000 exact records", async () => {
    const report = await verifyChangeFixtures();
    expect(report.files).toBe(65);
    expect(report.baselineFilesUnchanged).toBe(79);
    expect(report.businesses).toHaveLength(3);
    expect(report.stress).toMatchObject({ rows: 100000, csvBytes: 10103061, netRevenueKzt: "1209650960.00", netCostKzt: "734598070.00" });
    expect(report.stress.zipBytes).toBeLessThan(3_000_000);
  }, 30000);

  it("never resolves stable record identity from physical row order", async () => {
    const base = await readFile(path.join(CHANGE_ROOT, "homegoods/catalog.csv"));
    const reordered = await readFile(path.join(CHANGE_ROOT, "changes/homegoods/catalog-reordered.csv"));
    const normal = catalogChangeOracle(base, base, { collection: "homegoods-catalog", mode: "upsert" });
    const moved = catalogChangeOracle(base, reordered, { collection: "homegoods-catalog", mode: "upsert" });
    expect(moved.preservedRecordIds).toEqual(normal.preservedRecordIds);
    expect(moved.lineage[0].recordId).not.toBe(normal.lineage[0].recordId);
    expect(moved.updated).toEqual([]);
    const rows = parseCsv(base);
    rows[0].sku = String(Number(rows[0].sku));
    const columns = Object.keys(rows[0]);
    expect(() => catalogChangeOracle(base, csvBuffer(columns, rows.map((row) => columns.map((column) => row[column]))), { collection: "homegoods-catalog", mode: "upsert" })).toThrow(/destructively normalized/);
  });

  it("does not infer deletion from upsert, unconfirmed completeness or non-unique snapshot keys", async () => {
    const base = await readFile(path.join(CHANGE_ROOT, "services/catalog.csv"));
    const missing = await readFile(path.join(CHANGE_ROOT, "changes/services/catalog-missing-row.csv"));
    for (const options of [{ mode: "upsert", complete: true }, { mode: "replace-snapshot", complete: false }]) {
      const result = catalogChangeOracle(base, missing, { ...options, collection: "services-catalog" });
      expect(result.tombstonedRecordIds).toEqual([]);
      expect(result.retainedAbsentRecordIds).toHaveLength(1);
    }
    const rows = parseCsv(missing);
    rows.push({ ...rows[0], priceKzt: "999.00" });
    const columns = Object.keys(rows[0]);
    const duplicate = catalogChangeOracle(base, csvBuffer(columns, rows.map((row) => columns.map((column) => row[column]))), { collection: "services-catalog", mode: "replace-snapshot", complete: true });
    expect(duplicate.unresolved).toHaveLength(1);
    expect(duplicate.tombstonedRecordIds).toEqual([]);
    expect(duplicate.retainedAbsentRecordIds).toHaveLength(1);
  });

  it("keeps keyless renames unresolved rather than matching similar names or prices", async () => {
    const before = await readFile(path.join(CHANGE_ROOT, "changes/manufacturing/catalog-no-key-before.csv"));
    const incoming = await readFile(path.join(CHANGE_ROOT, "changes/manufacturing/catalog-no-key-renamed.csv"));
    const result = catalogChangeOracle(before, incoming, { collection: "keyless", mode: "upsert", hasKey: false });
    expect(result.unresolved).toEqual([{ sourceRecordNumber: 1, reason: "no-confirmed-business-key", automaticIdentity: null }]);
    expect(result.lineage).toHaveLength(3);
    expect(result.preservedRecordIds).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  it("protects human wording and rejects stale mixed proposals as a whole", async () => {
    const snapshot = JSON.parse(await readFile(path.join(CHANGE_ROOT, "changes/services/manual-edit.json")));
    const result = manualEditOracle(snapshot, { knownTotalKzt: "143600.00" });
    expect(result.staleProposal).toMatchObject({ status: "conflict", appliedOperations: 0 });
    expect(result.sourceOnlyRefresh.preservedText).toBe(snapshot.manualField.value);
    expect(result.sourceOnlyRefresh.status).toBe("proposal-awaiting-human-acceptance");
    const unsafe = structuredClone(snapshot);
    unsafe.freshProposal.targets.push(unsafe.manualField.fieldId);
    expect(() => manualEditOracle(unsafe, { knownTotalKzt: "143600.00" })).toThrow();
  });

  it("uses conservative duration boundaries and does not fabricate missing observations", () => {
    const series = (count, step) => csvBuffer(["date", "enquiries"], Array.from({ length: count }, (_, index) => [new Date(Date.UTC(2024, 0, 1 + index * step)).toISOString().slice(0, 10), String(index + 1)]));
    expect(eligibilityOracle(series(55, 1), { frequency: "daily" }).eligibleForRegularModel).toBe(false);
    expect(eligibilityOracle(series(56, 1), { frequency: "daily" }).eligibleForRegularModel).toBe(true);
    expect(eligibilityOracle(series(25, 7), { frequency: "weekly" }).eligibleForRegularModel).toBe(false);
    expect(eligibilityOracle(series(26, 7), { frequency: "weekly" }).eligibleForRegularModel).toBe(true);
    const monthly = (count) => csvBuffer(["date", "enquiries"], Array.from({ length: count }, (_, index) => [new Date(Date.UTC(2020, index, 1)).toISOString().slice(0, 10), "10"]));
    expect(eligibilityOracle(monthly(23), { frequency: "monthly" }).eligibleForRegularModel).toBe(false);
    expect(eligibilityOracle(monthly(24), { frequency: "monthly" }).eligibleForRegularModel).toBe(true);
    expect(eligibilityOracle(monthly(35), { frequency: "monthly", requestAnnualSeasonality: true }).eligibleForRequestedModel).toBe(false);
    expect(eligibilityOracle(monthly(36), { frequency: "monthly", requestAnnualSeasonality: true }).eligibleForRequestedModel).toBe(true);
  });

  it("generates seeded stress batches with bounded size and rejects invalid seeds", () => {
    const batch = (seed) => {
      const iterator = stressCsvChunks({ seed });
      const header = iterator.next().value;
      const bytes = iterator.next().value;
      iterator.return();
      expect(header.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(bytes.length).toBeLessThan(40000);
      return bytes;
    };
    expect(batch(DEFAULT_SEED)).toEqual(batch(DEFAULT_SEED));
    expect(batch(DEFAULT_SEED)).not.toEqual(batch(DEFAULT_SEED + 1));
    expect(() => stressCsvChunks({ seed: -1 }).next()).toThrow(/Invalid stress seed/);
  });

  it("rejects truncated, corrupted and unexpected ZIP entries without buffering the full CSV", async () => {
    const iterator = stressCsvChunks();
    const header = iterator.next().value;
    const firstBatch = iterator.next().value;
    iterator.return();
    const truncated = Buffer.concat([header, firstBatch]);
    await expect(inspectStressArchive(await stableZip([[STRESS_CSV, truncated]]))).rejects.toThrow(/Truncated stress input/);
    const corrupted = Buffer.from(truncated.toString("utf8").replace('"2400.00"', '"2400.01"'));
    await expect(inspectStressArchive(await stableZip([[STRESS_CSV, corrupted]]))).rejects.toThrow();
    await expect(inspectStressArchive(await stableZip([[STRESS_CSV, truncated], ["unexpected.txt", Buffer.from("synthetic")]]))).rejects.toThrow(/Unexpected stress ZIP entry/);
  });
});
