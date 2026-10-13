export const TEXT_MODEL = "xiaomi/mimo-v2.5";
export const IMAGE_MODEL = "bytedance-seed/seedream-4.5";
export const MAX_BATCH_USD = 1;
export const MAX_IMAGE_USD = 0.05;
export const MAX_OUTPUT_TOKENS = 512;
export const PRICING_TTL_MS = 24 * 60 * 60 * 1000;

export function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function amount(value, code) {
  requireCondition(value !== null && value !== undefined && value !== "", code);
  const result = Number(value);
  requireCondition(Number.isFinite(result) && result >= 0, code);
  return result;
}

export function assertAllowedModel(model) {
  requireCondition([TEXT_MODEL, IMAGE_MODEL].includes(model), "MODEL_NOT_ALLOWLISTED");
}

export function assertFreshPricing(fetchedAt, now = Date.now()) {
  const timestamp = Date.parse(fetchedAt);
  requireCondition(Number.isFinite(timestamp) && timestamp <= now && now - timestamp < PRICING_TTL_MS, "PRICING_STALE");
}

export function textReservation(model, endpoint, maxOutput = MAX_OUTPUT_TOKENS) {
  assertAllowedModel(model.id);
  requireCondition(model.id === TEXT_MODEL, "TEXT_MODEL_MISMATCH");
  requireCondition(endpoint.tag === "xiaomi/fp8", "TEXT_ENDPOINT_NOT_ALLOWLISTED");
  requireCondition(model.architecture.input_modalities.includes("image") && model.architecture.output_modalities.includes("text"), "TEXT_MODALITY_UNAVAILABLE");
  requireCondition(["tools", "tool_choice", "response_format", "max_tokens"].every((key) => endpoint.supported_parameters.includes(key)), "TEXT_CAPABILITY_UNAVAILABLE");
  requireCondition(Number.isInteger(maxOutput) && maxOutput > 0 && maxOutput <= MAX_OUTPUT_TOKENS, "OUTPUT_LIMIT_INVALID");
  const inputPrice = amount(endpoint.pricing.prompt, "INPUT_PRICE_UNKNOWN");
  const outputPrice = amount(endpoint.pricing.completion, "OUTPUT_PRICE_UNKNOWN");
  requireCondition(inputPrice <= 0.14 / 1e6 && outputPrice <= 0.28 / 1e6, "TEXT_PRICE_INCREASED");
  // Reserve the endpoint's entire context, including vision tokens: no guessed tokenizer bound.
  const context = amount(endpoint.context_length, "CONTEXT_LIMIT_UNKNOWN");
  requireCondition(Number.isInteger(context) && context > 0 && context <= 1_050_000, "CONTEXT_LIMIT_INVALID");
  for (const [key, value] of Object.entries(endpoint.pricing)) {
    if (["input_cache_read", "input_cache_write"].includes(key)) requireCondition(amount(value, "CACHE_PRICE_UNKNOWN") <= inputPrice, "CACHE_PRICE_EXCEEDS_BOUND");
    if (!["prompt", "completion", "input_cache_read", "input_cache_write", "discount"].includes(key)) {
      requireCondition(amount(value, "TEXT_BILLABLE_UNKNOWN") === 0, "TEXT_BILLABLE_UNKNOWN");
    }
  }
  return Number((context * inputPrice + maxOutput * outputPrice).toFixed(9));
}

export function imageReservation(model, endpoint, resolution = "2K") {
  assertAllowedModel(model.id);
  requireCondition(model.id === IMAGE_MODEL && endpoint.provider_tag === "seed", "IMAGE_ENDPOINT_NOT_ALLOWLISTED");
  requireCondition(model.architecture.output_modalities.includes("image"), "IMAGE_MODALITY_UNAVAILABLE");
  requireCondition(resolution === "2K" && endpoint.supported_parameters.resolution?.values.includes(resolution), "IMAGE_RESOLUTION_UNAVAILABLE");
  requireCondition(endpoint.supported_parameters.n?.min <= 1 && endpoint.supported_parameters.n?.max >= 1, "IMAGE_COUNT_UNAVAILABLE");
  requireCondition(Array.isArray(endpoint.pricing) && endpoint.pricing.length > 0, "IMAGE_PRICE_UNKNOWN");
  let outputFound = false;
  let total = 0;
  for (const line of endpoint.pricing) {
    const price = amount(line.cost_usd, "IMAGE_PRICE_UNKNOWN");
    requireCondition(!line.variant, "IMAGE_TIER_UNSUPPORTED");
    requireCondition(line.unit === "image", "IMAGE_UNIT_UNSUPPORTED");
    if (line.billable === "output_image") {
      outputFound = true;
      total += price;
    } else {
      requireCondition(line.billable === "input_image" && price === 0, "IMAGE_BILLABLE_UNKNOWN");
    }
  }
  requireCondition(outputFound && total > 0 && total <= MAX_IMAGE_USD, "IMAGE_PRICE_EXCEEDS_CAP");
  return total;
}

export function readiness(model, now = Date.now()) {
  const expiration = model.expiration_date ? Date.parse(`${model.expiration_date}T00:00:00Z`) : null;
  const daysRemaining = expiration === null ? null : Math.ceil((expiration - now) / 86_400_000);
  return {
    model: model.id,
    expirationDate: model.expiration_date ?? null,
    daysRemaining,
    lifecycle: daysRemaining === null ? "unspecified" : daysRemaining <= 0 ? "expired" : daysRemaining <= 14 ? "replacement-needed-soon" : "active",
    productionReady: false,
  };
}

export function reserve(ledger, caseId, model, ceilingUsd) {
  assertAllowedModel(model);
  requireCondition(Number.isFinite(ledger.maxUsd) && ledger.maxUsd > 0 && ledger.maxUsd <= MAX_BATCH_USD, "BATCH_CAP_INVALID");
  requireCondition(!ledger.calls.some((call) => call.caseId === caseId), "CASE_ALREADY_ATTEMPTED");
  requireCondition(!ledger.calls.some((call) => call.status === "cost-cap-breached"), "PRIOR_COST_CAP_BREACHED");
  requireCondition(Number.isFinite(ceilingUsd) && ceilingUsd > 0, "RESERVATION_INVALID");
  const committed = ledger.calls.reduce((sum, call) => sum + call.reservedUsd, 0);
  // Keep all attempted reservations charged against this batch, even after a cheap success.
  requireCondition(committed + ceilingUsd <= ledger.maxUsd + 1e-12, "BATCH_CAP_EXCEEDED");
  const receipt = { caseId, model, reservedUsd: ceilingUsd, status: "reserved", actualCostUsd: null };
  ledger.calls.push(receipt);
  return receipt;
}

export function reconcile(receipt, response, status) {
  receipt.httpStatus = status;
  if (typeof response?.id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(response.id)) receipt.providerRequestId = response.id;
  const usage = response?.usage;
  const actual = usage?.cost;
  if (typeof actual !== "number" || !Number.isFinite(actual) || actual < 0) {
    receipt.status = "cost-unresolved";
    return;
  }
  receipt.actualCostUsd = actual;
  receipt.usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter((key) => Number.isFinite(usage[key])).map((key) => [key, usage[key]]));
  receipt.status = actual <= receipt.reservedUsd + 1e-9 ? "received" : "cost-cap-breached";
}
