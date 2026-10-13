import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import Decimal from "decimal.js";
import JSZip from "jszip";
import { csvBuffer, seededRandom } from "./data.mjs";
import { BUSINESSES, DEFAULT_SEED, FIXED_TIMESTAMP } from "./definitions.mjs";
import { exactMoney, scaled } from "./oracle.mjs";

export const STRESS_ROWS = 100000;
export const STRESS_CSV = "history-100000.csv";
export const STRESS_COLUMNS = ["operationId", "lineId", "date", "sku", "quantity", "unit", "unitPriceKzt", "netAmountKzt", "costAmountKzt", "currency", "kind", "originalOperationId"];
const MAX_CSV_BYTES = 20_000_000;
const CHUNK_ROWS = 250;
const id = (sequence) => `LOAD-${String(sequence).padStart(6, "0")}`;

// Only a 250-row batch is held at once, including when JSZip applies backpressure.
export function* stressCsvChunks({ seed = DEFAULT_SEED } = {}) {
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, "Invalid stress seed.");
  const random = seededRandom(seed + 991);
  const catalog = BUSINESSES[0].catalog;
  const header = csvBuffer(STRESS_COLUMNS, []);
  yield Buffer.concat([Buffer.from("\uFEFF"), header]);
  let batch = [];
  for (let index = 0; index < STRESS_ROWS; index++) {
    const item = catalog[Math.floor(index / 20) % catalog.length];
    const reduction = index % 20 === 19;
    const quantity = reduction ? -1 : 1 + Math.floor(random() * 9);
    const date = new Date(Date.UTC(2025, 0, 1 + Math.floor(index / 274))).toISOString().slice(0, 10);
    batch.push([id(index + 1), "01", date, item.sku, String(quantity), item.unit, item.price,
      new Decimal(item.price).times(quantity).toFixed(2), new Decimal(item.cost).times(quantity).toFixed(2),
      "KZT", reduction ? "return" : "sale", reduction ? id(index) : ""]);
    if (batch.length === CHUNK_ROWS) {
      yield csvBuffer(STRESS_COLUMNS, batch).subarray(header.length);
      batch = [];
    }
  }
  if (batch.length) yield csvBuffer(STRESS_COLUMNS, batch).subarray(header.length);
}

export function stressZipStream(options = {}) {
  const zip = new JSZip();
  zip.file(STRESS_CSV, Readable.from(stressCsvChunks(options), { objectMode: false }), {
    date: new Date(FIXED_TIMESTAMP), createFolders: false, unixPermissions: 0o100644,
  });
  return zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
}

export async function stressArchiveDigest(options = {}) {
  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(stressZipStream(options), new Writable({ write(chunk, _encoding, callback) {
    bytes += chunk.length;
    hash.update(chunk);
    callback();
  } }));
  return { bytes, sha256: hash.digest("hex") };
}

export async function writeStressArchive(destination, options = {}) {
  await pipeline(stressZipStream(options), createWriteStream(destination));
}

export async function inspectStressArchive(archiveBytes) {
  assert.ok(archiveBytes.length < 3_000_000, "Stress archive exceeds the repository size budget.");
  // JSZip holds the compact archive; decompressed CSV is never collected in memory.
  const zip = await JSZip.loadAsync(archiveBytes);
  assert.deepEqual(Object.keys(zip.files), [STRESS_CSV], "Unexpected stress ZIP entry.");
  const hash = createHash("sha256");
  let bytes = 0;
  let rows = 0;
  let reductions = 0;
  let previous;
  let revenue = 0n;
  let cost = 0n;
  const catalog = new Map(BUSINESSES[0].catalog.map((item) => [item.sku, item]));
  const bySku = new Map();
  const byMonth = new Map();
  const counter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > MAX_CSV_BYTES) return callback(new Error("Stress CSV exceeds the 20 MB import limit."));
    hash.update(chunk);
    callback(null, chunk);
  } });
  const parser = parse({ bom: true, columns(headers) {
    assert.deepEqual(headers, STRESS_COLUMNS);
    return headers;
  }, skip_empty_lines: false, max_record_size: 4096 });
  const sink = new Writable({ objectMode: true, write(row, _encoding, callback) {
    try {
      rows++;
      assert.ok(rows <= STRESS_ROWS, "More than 100000 input records.");
      assert.equal(row.operationId, `LOAD-${String(rows).padStart(6, "0")}`);
      assert.equal(row.lineId, "01");
      assert.equal(row.currency, "KZT");
      assert.ok(/^\d{6}$/.test(row.sku), "Leading-zero SKU was lost.");
      const item = catalog.get(row.sku);
      assert.ok(item, "Unknown stress SKU.");
      assert.equal(row.unit, item.unit);
      assert.equal(row.unitPriceKzt, item.price);
      const day = new Date(`${row.date}T00:00:00Z`);
      assert.equal(day.toISOString().slice(0, 10), row.date);
      assert.ok(row.date >= "2025-01-01" && row.date <= "2025-12-31");
      assert.ok(!previous || row.date >= previous.date, "Unordered stress dates.");
      const quantity = scaled(row.quantity, 0);
      const amount = quantity * scaled(row.unitPriceKzt);
      const lineCost = quantity * scaled(item.cost);
      assert.equal(scaled(row.netAmountKzt), amount, "Stress line amount is incorrect.");
      assert.equal(scaled(row.costAmountKzt), lineCost, "Stress line cost is incorrect.");
      if (rows % 20 === 0) {
        assert.equal(row.kind, "return");
        assert.equal(quantity, -1n);
        assert.equal(row.originalOperationId, previous.operationId);
        assert.equal(row.sku, previous.sku);
        assert.equal(previous.kind, "sale");
        reductions++;
      } else {
        assert.equal(row.kind, "sale");
        assert.ok(quantity >= 1n && quantity <= 9n);
        assert.equal(row.originalOperationId, "");
      }
      revenue += amount;
      cost += lineCost;
      for (const [group, key] of [[bySku, row.sku], [byMonth, row.date.slice(0, 7)]]) {
        const value = group.get(key) ?? { rows: 0, revenue: 0n, cost: 0n };
        value.rows++;
        value.revenue += amount;
        value.cost += lineCost;
        group.set(key, value);
      }
      previous = row;
      callback();
    } catch (error) { callback(error); }
  } });
  await pipeline(zip.file(STRESS_CSV).nodeStream(), counter, parser, sink);
  assert.equal(rows, STRESS_ROWS, "Truncated stress input.");
  const summaries = (groups) => [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, rows: value.rows, netRevenueKzt: exactMoney(value.revenue), netCostKzt: exactMoney(value.cost) }));
  return {
    file: STRESS_CSV, bytes, sha256: hash.digest("hex"), dataRows: rows, columns: STRESS_COLUMNS.length,
    uniqueEventKeys: rows, reductionRows: reductions, netRevenueKzt: exactMoney(revenue), netCostKzt: exactMoney(cost),
    marginKzt: exactMoney(revenue - cost), bySku: summaries(bySku), byMonth: summaries(byMonth),
  };
}

export async function readStressArchive(filename) {
  return inspectStressArchive(await readFile(filename));
}
