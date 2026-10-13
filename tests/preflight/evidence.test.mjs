import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const evidence = new URL("./evidence/", import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, evidence), "utf8"));

describe("recorded preflight evidence without paid replay", () => {
  it("matches actual generated Office bytes to the parsed proof", async () => {
    const proof = await readJson("formats.json");
    for (const [kind, name] of [["xlsx", "synthetic-formulas.xlsx"], ["docx", "synthetic-unicode.docx"], ["pdf", "synthetic-unicode.pdf"]]) {
      const bytes = await readFile(new URL(name, evidence));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(proof.office[kind].sha256);
      expect(bytes.length).toBe(proof.office[kind].bytes);
    }
  });

  it("retains all attempted call reservations inside the original batch cap", async () => {
    const ledger = await readJson("live-receipts.json");
    expect(ledger.maxUsd).toBe(1);
    expect(ledger.calls.reduce((sum, call) => sum + call.reservedUsd, 0)).toBeLessThanOrEqual(ledger.maxUsd);
    expect(new Set(ledger.calls.map((call) => call.caseId)).size).toBe(ledger.calls.length);
    const unknown = ledger.calls.filter((call) => call.actualCostUsd === null).reduce((sum, call) => sum + call.reservedUsd, 0);
    expect(unknown).toBeCloseTo(ledger.unresolvedReservedUsd, 9);
    const timeout = ledger.calls.find((call) => call.caseId === "corrected-json-object");
    expect(timeout.status).toBe("ambiguous-cost-reserved-no-retry");
    expect(timeout.actualCostUsd).toBeNull();
  });

  it("verifies generated image bytes without rendering or claiming visual quality", async () => {
    const ledger = await readJson("live-receipts.json");
    const image = ledger.calls.find((call) => call.caseId === "corrected-image-generation-2k");
    expect(image.status).toBe("passed");
    expect(image.validatedResult.visualQualityVerified).toBe(false);
    const extension = image.validatedResult.format === "jpeg" ? "jpg" : image.validatedResult.format;
    const bytes = await readFile(new URL(`generated-synthetic-cup.${extension}`, evidence));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.validatedResult.sha256);
  });
});
