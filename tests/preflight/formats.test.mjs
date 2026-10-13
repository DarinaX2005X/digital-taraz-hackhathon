import { describe, expect, it } from "vitest";
import { proveFabric, proveForecast, proveOffice } from "../../scripts/preflight/formats.mjs";
import { proveFormulas } from "../../scripts/preflight/formulas.mjs";

describe("real offline format and domain engines", () => {
  it("computes the supported formula golden set, follows edits and roundtrips actual Office files", async () => {
    const formulas = await proveFormulas();
    for (const cell of formulas.results) expect(cell.actual).toBe(cell.expected);
    expect(formulas.changed).toEqual({ sum: 55, crossSheet: 37.5 });
    const office = await proveOffice(formulas);
    expect(office.evidence.xlsx.x14IconSetRoundtrip).toBe(true);
    expect(office.evidence.docx.mediaCount).toBe(1);
    expect(office.evidence.pdf.pages).toBe(2);
  }, 20_000);

  it("preserves serializable Fabric text, nested shapes, ids and bindings without a UI surface", async () => {
    const result = await proveFabric();
    expect(result.roundtrip).toBe(true);
    expect(result.renderSurfaceCreated).toBe(false);
  });

  it("runs finite CTSA forecasts on two genuine historical holdouts and rejects tiny history", () => {
    const result = proveForecast();
    expect(result.folds).toHaveLength(2);
    expect(result.forecast.points).toHaveLength(7);
    expect(result.shortSeriesRejected).toBe(true);
    expect(result.calibratedIntervalClaimed).toBe(false);
  });
});
