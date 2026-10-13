import { describe, expect, it } from "vitest";
import { createBusinessData, csvBuffer, historyCsv } from "../../scripts/fixtures/data.mjs";
import { historyOracle, parseCsv, procurementOracle, quoteOracle, scaled } from "../../scripts/fixtures/oracle.mjs";
import { verifyFixtureFiles } from "../../scripts/fixtures/verify.mjs";

describe("synthetic business inputs", () => {
  it("reproduces committed files and independently verifies amounts, Unicode, photos and split isolation", async () => {
    const result = await verifyFixtureFiles();
    expect(result.passed).toBe(true);
    expect(result.summaries).toHaveLength(3);
    expect(result.visualReviewPerformed).toBe(false);
  }, 30_000);

  it("keeps a seed deterministic while permitting a user's different input variant", () => {
    const first = createBusinessData(20261013);
    const repeat = createBusinessData(20261013);
    const other = createBusinessData(572001);
    expect(first).toEqual(repeat);
    expect(first[0].history.rows).not.toEqual(other[0].history.rows);
    expect(first[1].enquiries).not.toEqual(other[1].enquiries);
    expect(first[2].catalog).toEqual(other[2].catalog);
    expect(() => createBusinessData(-1)).toThrow("unsigned 32-bit");
    expect(() => createBusinessData(1.5)).toThrow("unsigned 32-bit");
  });

  it("preserves leading zeros, decimal commas and CSV quoting", () => {
    const input = csvBuffer(["sku", "description", "quantity"], [["000017", 'Набор; "дом"\nTwo lines', "1,25"]], { delimiter: ";", bom: true });
    expect(parseCsv(input, ";")).toEqual([{ sku: "000017", description: 'Набор; "дом"\nTwo lines', quantity: "1,25" }]);
    expect(scaled("-1,25", 3)).toBe(-1250n);
    expect(() => scaled("1.234", 2)).toThrow("exceeds");
  });

  it("checks half-up arithmetic independently and keeps unresolved tax out of a final total", () => {
    const quote = csvBuffer(["sku", "quantity", "unitPriceKzt", "amountKzt"], [["001", "0.125", "10.04", "1.26"]]);
    expect(quoteOracle(quote, "10.00", "0.10")).toMatchObject({ subtotalKzt: "1.26", discountKzt: "0.13", knownTotalKzt: "1.23", finalTotalKzt: null });
    const wrong = csvBuffer(["sku", "quantity", "unitPriceKzt", "amountKzt"], [["001", "0.125", "10.04", "1.25"]]);
    expect(() => quoteOracle(wrong, "0", "0")).toThrow("Incorrect quote amount");
  });

  it("rejects altered accepted amounts rather than trusting a generator golden", () => {
    const business = createBusinessData()[0];
    const catalog = csvBuffer(["sku", "unit", "costKzt"], business.catalog.map(({ sku, unit, cost }) => [sku, unit, cost]));
    business.history.rows[0].netAmount = "999999.00";
    expect(() => historyOracle(historyCsv(business.history.rows), catalog)).toThrow("Incorrect line arithmetic");
  });

  it("never ranks an expired or incomplete offer as the cheapest complete candidate", () => {
    const offers = csvBuffer(["supplierId", "sku", "packQuantity", "packPriceKzt", "minPacks", "deliveryKzt", "leadDays", "validThrough"], [
      ["STALE", "001", "3", "1.00", "1", "0", "2", "2025-12-31"],
      ["MISSING", "001", "3", "2.00", "1", "", "2", "2026-02-01"],
      ["CURRENT", "001", "3", "10.00", "4", "5.00", "3", "2026-02-01"],
    ]);
    const result = procurementOracle(offers, { sku: "001", needed: "5", unit: "piece" });
    expect(result[0]).toMatchObject({ expired: true, eligibleForCompleteCostRanking: false, totalKzt: null });
    expect(result[1]).toMatchObject({ eligibleForCompleteCostRanking: false, totalKzt: null });
    expect(result[2]).toMatchObject({ packs: 4, deliveredQuantity: "12", totalKzt: "45.00" });
  });
});
