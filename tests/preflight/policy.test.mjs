import { describe, expect, it } from "vitest";
import { IMAGE_MODEL, TEXT_MODEL, assertAllowedModel, assertFreshPricing, imageReservation, readiness, reconcile, reserve, textReservation } from "../../scripts/preflight/policy.mjs";

const textModel = { id: TEXT_MODEL, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } };
const textEndpoint = { tag: "xiaomi/fp8", context_length: 1_048_576, pricing: { prompt: "0.00000014", completion: "0.00000028" }, supported_parameters: ["tools", "tool_choice", "response_format", "max_tokens"] };
const imageModel = { id: IMAGE_MODEL, architecture: { output_modalities: ["image"] } };
const imageEndpoint = { provider_tag: "seed", supported_parameters: { resolution: { values: ["1K", "2K"] }, n: { min: 1, max: 10 } }, pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.04 }, { billable: "input_image", unit: "image", cost_usd: 0 }] };

describe("paid preflight authorization boundaries", () => {
  it("only allows the two reviewed model identities", () => {
    for (const model of ["openai/gpt-5", "anthropic/claude", "openrouter/auto", "unknown/cheap"]) expect(() => assertAllowedModel(model)).toThrow("MODEL_NOT_ALLOWLISTED");
    expect(() => assertAllowedModel(TEXT_MODEL)).not.toThrow();
  });

  it("reserves a conservative full-context bound instead of guessing vision tokens", () => {
    expect(textReservation(textModel, textEndpoint)).toBeCloseTo(0.146943999, 7);
    expect(() => textReservation(textModel, { ...textEndpoint, pricing: {} })).toThrow("INPUT_PRICE_UNKNOWN");
    expect(() => textReservation(textModel, textEndpoint, 513)).toThrow("OUTPUT_LIMIT_INVALID");
    expect(() => textReservation(textModel, { ...textEndpoint, pricing: { ...textEndpoint.pricing, completion: 1 } })).toThrow("TEXT_PRICE_INCREASED");
  });

  it("refuses missing capability and unknown price components", () => {
    expect(() => textReservation(textModel, { ...textEndpoint, supported_parameters: ["tools"] })).toThrow("TEXT_CAPABILITY_UNAVAILABLE");
    expect(() => textReservation(textModel, { ...textEndpoint, pricing: { ...textEndpoint.pricing, request: "0.2" } })).toThrow("TEXT_BILLABLE_UNKNOWN");
    expect(() => imageReservation(imageModel, { ...imageEndpoint, pricing: [{ billable: "output_image", unit: "token", cost_usd: 0.00001 }] })).toThrow("IMAGE_UNIT_UNSUPPORTED");
    expect(() => imageReservation(imageModel, { ...imageEndpoint, pricing: [{ billable: "output_image", unit: "image", cost_usd: NaN }] })).toThrow("IMAGE_PRICE_UNKNOWN");
  });

  it("caps the complete image including all declared billables", () => {
    expect(imageReservation(imageModel, imageEndpoint)).toBe(0.04);
    expect(() => imageReservation(imageModel, imageEndpoint, "1K")).toThrow("IMAGE_RESOLUTION_UNAVAILABLE");
    expect(() => imageReservation(imageModel, { ...imageEndpoint, pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.06 }] })).toThrow("IMAGE_PRICE_EXCEEDS_CAP");
    expect(() => imageReservation(imageModel, { ...imageEndpoint, pricing: [...imageEndpoint.pricing, { billable: "prompt", unit: "token", cost_usd: 0.001 }] })).toThrow("IMAGE_UNIT_UNSUPPORTED");
  });

  it("keeps ambiguous and completed reservations and forbids repeat cases", () => {
    const ledger = { maxUsd: 0.1, calls: [] };
    const first = reserve(ledger, "image", IMAGE_MODEL, 0.04);
    first.status = "ambiguous";
    expect(() => reserve(ledger, "image", IMAGE_MODEL, 0.04)).toThrow("CASE_ALREADY_ATTEMPTED");
    const second = reserve(ledger, "text", TEXT_MODEL, 0.05);
    reconcile(second, { usage: { cost: 0.00001, prompt_tokens: 4 } }, 200);
    expect(() => reserve(ledger, "more", TEXT_MODEL, 0.02)).toThrow("BATCH_CAP_EXCEEDED");
  });

  it("does not turn missing or malformed usage into free success", () => {
    const receipt = { reservedUsd: 0.04 };
    reconcile(receipt, {}, 200);
    expect(receipt.status).toBe("cost-unresolved");
    reconcile(receipt, { usage: { cost: 0.06 } }, 200);
    expect(receipt.status).toBe("cost-cap-breached");
  });

  it("rejects stale pricing and surfaces imminent model retirement", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    expect(() => assertFreshPricing("2026-10-11T00:00:00Z", now)).toThrow("PRICING_STALE");
    expect(() => assertFreshPricing("2026-10-13T01:00:00Z", now)).toThrow("PRICING_STALE");
    expect(readiness({ id: TEXT_MODEL, expiration_date: "2026-10-21" }, now)).toMatchObject({ lifecycle: "replacement-needed-soon", daysRemaining: 8, productionReady: false });
  });
});
