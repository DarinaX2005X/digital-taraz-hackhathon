import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import sharp from "sharp";
import { z } from "zod";
import { IMAGE_MODEL, MAX_OUTPUT_TOKENS, TEXT_MODEL, assertFreshPricing, imageReservation, readiness, reconcile, requireCondition, reserve, textReservation } from "./policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidenceDirectory = path.join(root, "tests/preflight/evidence");
const receiptPath = path.join(evidenceDirectory, "live-receipts.json");
const base = "https://openrouter.ai/api/v1/";

async function metadata(route) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(20_000) });
  requireCondition(response.ok, "METADATA_UNAVAILABLE");
  return response.json();
}

export async function readProviderMetadata() {
  const all = await metadata("models");
  const text = all.data.find((model) => model.id === TEXT_MODEL);
  requireCondition(text, "TEXT_MODEL_UNAVAILABLE");
  const endpoints = await metadata(`models/${TEXT_MODEL}/endpoints`);
  const textEndpoint = endpoints.data.endpoints.find((endpoint) => endpoint.tag === "xiaomi/fp8");
  requireCondition(textEndpoint, "TEXT_ENDPOINT_UNAVAILABLE");
  const imageModels = await metadata("images/models");
  const image = imageModels.data.find((model) => model.id === IMAGE_MODEL);
  requireCondition(image, "IMAGE_MODEL_UNAVAILABLE");
  const imageEndpoints = await metadata(`images/models/${IMAGE_MODEL}/endpoints`);
  const imageEndpoint = imageEndpoints.endpoints.find((endpoint) => endpoint.provider_tag === "seed");
  requireCondition(imageEndpoint, "IMAGE_ENDPOINT_UNAVAILABLE");
  return {
    fetchedAt: new Date().toISOString(),
    sources: [new URL("models", base).href, new URL(`models/${TEXT_MODEL}/endpoints`, base).href, new URL("images/models", base).href, new URL(`images/models/${IMAGE_MODEL}/endpoints`, base).href],
    text: { id: text.id, canonical_slug: text.canonical_slug, architecture: text.architecture, supported_parameters: text.supported_parameters, pricing: text.pricing, expiration_date: text.expiration_date ?? null },
    textEndpoint: { tag: textEndpoint.tag, provider_name: textEndpoint.provider_name, supported_parameters: textEndpoint.supported_parameters, pricing: textEndpoint.pricing, context_length: textEndpoint.context_length, max_completion_tokens: textEndpoint.max_completion_tokens },
    image: { id: image.id, architecture: image.architecture, supported_parameters: image.supported_parameters },
    imageEndpoint,
    readiness: readiness(text),
  };
}

const priceSchema = z.object({ quantity: z.literal(3), unitPrice: z.literal(1250) }).strict();
const finalSchema = z.object({ total: z.literal(3750), currency: z.literal("KZT"), source: z.literal("tool") }).strict();
const visionSchema = z.object({ item: z.literal("LAMP"), quantity: z.literal(3), unitPrice: z.literal(1250), currency: z.literal("KZT") }).strict();

export async function runLive(maxUsd, { correctKnownRejections = false } = {}) {
  requireCondition(Number.isFinite(maxUsd) && maxUsd > 0 && maxUsd <= 1, "MAX_USD_MUST_BE_EXPLICIT_AND_AT_MOST_ONE");
  const env = {};
  dotenv.config({ path: path.join(root, ".env"), processEnv: env, quiet: true });
  const key = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
  const configuredModel = process.env.OPENROUTER_MODEL || env.OPENROUTER_MODEL;
  requireCondition(Boolean(key), "OPENROUTER_KEY_MISSING");
  requireCondition(configuredModel === TEXT_MODEL, "CONFIGURED_MODEL_CHANGED_REVIEW_REQUIRED");
  const pricing = await readProviderMetadata();
  assertFreshPricing(pricing.fetchedAt);
  requireCondition(pricing.readiness.lifecycle !== "expired", "MODEL_EXPIRED");
  const textCeiling = textReservation(pricing.text, pricing.textEndpoint);
  const imageCeiling = imageReservation(pricing.image, pricing.imageEndpoint);
  requireCondition(3 * textCeiling + imageCeiling <= maxUsd, "PLANNED_BATCH_EXCEEDS_CAP");
  await mkdir(evidenceDirectory, { recursive: true });
  let ledger;
  if (correctKnownRejections) {
    ledger = JSON.parse(await readFile(receiptPath, "utf8"));
    requireCondition(ledger.maxUsd === maxUsd && ledger.calls.length === 4, "CORRECTION_LEDGER_MISMATCH");
    for (const [caseId, expectedStatus] of [["structured-tool-result", 404], ["vision-extraction", 404], ["image-generation", 400]]) {
      requireCondition(ledger.calls.some((call) => call.caseId === caseId && call.httpStatus === expectedStatus), "CORRECTION_REQUIRES_KNOWN_REJECTION");
    }
    const previousMaximum = ledger.calls.reduce((sum, call) => sum + call.reservedUsd, 0);
    requireCondition(previousMaximum + 2 * textCeiling + imageCeiling <= maxUsd, "CORRECTION_EXCEEDS_ORIGINAL_BATCH_CAP");
    ledger.correction = {
      startedAt: new Date().toISOString(),
      originalFailures: ledger.failures,
      metadata: pricing,
      cumulativeMaximumUsd: previousMaximum + 2 * textCeiling + imageCeiling,
      reason: "Xiaomi endpoint supports JSON object mode, not provider-enforced JSON Schema; Seedream4.5 minimum resolution is2K despite OpenRouter advertising1K.",
      sources: ["https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output", "https://docs.byteplus.com/en/docs/modelark/image-generation-api"],
      schemaEnforcement: "local-zod-after-json-object",
      continuousToolMessageLoopProven: false,
    };
    // An immutable lock prevents two explicit correction invocations racing this same ledger.
    await writeFile(path.join(evidenceDirectory, "live-correction-lock.json"), `${JSON.stringify({ batchId: ledger.batchId, startedAt: ledger.correction.startedAt })}\n`, { flag: "wx" });
  } else {
    ledger = { version: 1, batchId: "01.4.1-synthetic-provider-proof", startedAt: new Date().toISOString(), maxUsd, plannedMaximumUsd: 3 * textCeiling + imageCeiling, keyPresent: true, configuredModel, pricing, calls: [] };
    // Exclusive creation makes a second execution fail before any paid dispatch.
    await writeFile(receiptPath, `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx" });
  }
  const persist = () => writeFile(receiptPath, `${JSON.stringify(ledger, null, 2)}\n`);
  const provider = { only: ["xiaomi/fp8"], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0.14, completion: 0.28 } };
  const chat = (messages, extra) => ({ model: TEXT_MODEL, provider, max_tokens: MAX_OUTPUT_TOKENS, reasoning: { enabled: false }, temperature: 0, stream: false, messages, ...extra });

  async function dispatch(caseId, model, route, body, ceiling) {
    assertFreshPricing(pricing.fetchedAt);
    const receipt = reserve(ledger, caseId, model, ceiling);
    receipt.inputSha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    receipt.startedAt = new Date().toISOString();
    receipt.status = "dispatching";
    await persist();
    let response;
    try {
      response = await fetch(new URL(route, base), { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(route === "images" ? 55_000 : 45_000) });
      // Do not log provider error bodies: they may include request headers or private content.
      if (!response.ok) {
        receipt.httpStatus = response.status;
        const error = await response.json().catch(() => ({}));
        const message = typeof error.error?.message === "string" ? error.error.message : "";
        receipt.errorCategory = /endpoint|routing|provider/i.test(message) ? "routing-or-provider" : /size|resolution|pixel|width|height/i.test(message) ? "image-dimensions" : /parameter|schema|format/i.test(message) ? "request-parameters" : "unclassified-rejection";
        receipt.status = "http-error-cost-unresolved";
        await persist();
        throw new Error("PROVIDER_HTTP_ERROR");
      }
      const data = await response.json();
      reconcile(receipt, data, response.status);
      receipt.receivedAt = new Date().toISOString();
      receipt.reportedModel = data.model ?? null;
      await persist();
      requireCondition(!data.model || data.model === model || (model === TEXT_MODEL && data.model === pricing.text.canonical_slug), "PROVIDER_MODEL_MISMATCH");
      requireCondition(receipt.status !== "cost-cap-breached", "PROVIDER_COST_CAP_BREACHED");
      requireCondition(receipt.status === "received", "PROVIDER_COST_UNRESOLVED");
      return { data, receipt };
    } catch (error) {
      if (receipt.status === "dispatching") receipt.status = "ambiguous-cost-reserved-no-retry";
      receipt.failureCode = typeof error.message === "string" && /^[A-Z_]{1,80}$/.test(error.message) ? error.message : "TRANSPORT_OR_RESPONSE_FAILED";
      await persist();
      throw new Error(receipt.failureCode);
    }
  }

  const failures = [];
  async function runCase(label, operation) {
    try { await operation(); }
    catch (error) { failures.push({ case: label, code: /^[A-Z_]{1,80}$/.test(error.message) ? error.message : "OUTPUT_VALIDATION_FAILED" }); }
    await persist();
  }

  await persist();
  if (!correctKnownRejections) await runCase("tool-and-schema", async () => {
    const messages = [
      { role: "system", content: "You validate a synthetic commercial quote. Call calculate_quote to calculate the total from the given quantity and unit price. Do not invent tool results. After receiving its result, return the requested schema." },
      { role: "user", content: "Synthetic quote: 3 units at 1250 KZT each. Calculate total using the tool." },
    ];
    const tools = [{ type: "function", function: { name: "calculate_quote", description: "Calculate a synthetic quote from quantity and unit price using exact integer arithmetic.", parameters: { type: "object", properties: { quantity: { type: "integer" }, unitPrice: { type: "integer" } }, required: ["quantity", "unitPrice"], additionalProperties: false } } }];
    const first = await dispatch("tool-call", TEXT_MODEL, "chat/completions", chat(messages, { tools, tool_choice: "required" }), textCeiling);
    const message = first.data.choices?.[0]?.message;
    requireCondition(message?.tool_calls?.length === 1, "EXACTLY_ONE_TOOL_CALL_REQUIRED");
    const call = message.tool_calls[0];
    requireCondition(call.function.name === "calculate_quote", "UNEXPECTED_TOOL_CALL");
    const args = priceSchema.parse(JSON.parse(call.function.arguments));
    const toolResult = { total: args.quantity * args.unitPrice, currency: "KZT", source: "tool" };
    first.receipt.validatedResult = { tool: call.function.name, callId: call.id, args, actualToolResult: toolResult };
    first.receipt.status = "passed";
    await persist();
    const second = await dispatch("structured-tool-result", TEXT_MODEL, "chat/completions", chat([
      ...messages,
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) },
      { role: "user", content: 'Return only JSON with exactly these fields: {"total":integer,"currency":"KZT","source":"tool"}.' },
    ], { response_format: { type: "json_object" } }), textCeiling);
    second.receipt.validatedResult = finalSchema.parse(JSON.parse(second.data.choices[0].message.content));
    second.receipt.status = "passed";
  });

  if (correctKnownRejections) await runCase("corrected-json-object", async () => {
    const stored = ledger.calls.find((call) => call.caseId === "tool-call" && call.status === "passed");
    requireCondition(stored?.validatedResult?.actualToolResult, "VALIDATED_TOOL_RECEIPT_MISSING");
    const result = await dispatch("corrected-json-object", TEXT_MODEL, "chat/completions", chat([
      { role: "system", content: 'Return only JSON with exactly these fields: {"total":integer,"currency":"KZT","source":"tool"}. Use the supplied verified calculation receipt as the source.' },
      { role: "user", content: `Actual synthetic calculate_quote receipt from the preceding probe: ${JSON.stringify(stored.validatedResult.actualToolResult)}` },
    ], { response_format: { type: "json_object" } }), textCeiling);
    result.receipt.validatedResult = finalSchema.parse(JSON.parse(result.data.choices[0].message.content));
    result.receipt.schemaEnforcement = "local-zod-after-json-object";
    result.receipt.status = "passed";
  });

  await runCase("vision", async () => {
    const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="white"/><g font-family="sans-serif" font-size="40" fill="black"><text x="20" y="60">ITEM: LAMP</text><text x="20" y="125">QTY: 3</text><text x="20" y="190">PRICE: 1250 KZT</text></g></svg>')).png().toBuffer();
    const result = await dispatch(correctKnownRejections ? "corrected-vision-extraction" : "vision-extraction", TEXT_MODEL, "chat/completions", chat([{ role: "user", content: [
      { type: "text", text: 'Read only the four fields printed on this synthetic quote card. Return only JSON: {"item":string,"quantity":integer,"unitPrice":integer,"currency":string}. Do not calculate or infer missing fields.' },
      { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } },
    ] }], { response_format: { type: "json_object" } }), textCeiling);
    result.receipt.validatedResult = visionSchema.parse(JSON.parse(result.data.choices[0].message.content));
    result.receipt.inputImageSha256 = createHash("sha256").update(image).digest("hex");
    result.receipt.status = "passed";
  });

  await runCase("image-generation", async () => {
    const result = await dispatch(correctKnownRejections ? "corrected-image-generation-2k" : "image-generation", IMAGE_MODEL, "images", { model: IMAGE_MODEL, prompt: "Synthetic product illustration: a plain green ceramic cup on a white background, centered, no text, no logo, no people.", n: 1, resolution: "2K", aspect_ratio: "1:1", provider: { only: ["seed"], allow_fallbacks: false } }, imageCeiling);
    requireCondition(result.data.data?.length === 1 && typeof result.data.data[0].b64_json === "string", "IMAGE_RESPONSE_INVALID");
    const bytes = Buffer.from(result.data.data[0].b64_json, "base64");
    requireCondition(bytes.length > 100 && bytes.length < 8_000_000, "IMAGE_SIZE_INVALID");
    const info = await sharp(bytes).metadata();
    requireCondition(["png", "jpeg", "webp"].includes(info.format) && info.width > 0 && info.height > 0, "IMAGE_CONTENT_INVALID");
    result.receipt.validatedResult = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), format: info.format, width: info.width, height: info.height, visualQualityVerified: false, synthetic: true };
    await writeFile(path.join(evidenceDirectory, `generated-synthetic-cup.${info.format === "jpeg" ? "jpg" : info.format}`), bytes);
    result.receipt.status = "passed";
  });

  ledger.finishedAt = new Date().toISOString();
  ledger.failures = failures;
  ledger.actualCostUsd = ledger.calls.reduce((sum, call) => sum + (call.actualCostUsd ?? 0), 0);
  ledger.unresolvedReservedUsd = ledger.calls.filter((call) => call.actualCostUsd === null).reduce((sum, call) => sum + call.reservedUsd, 0);
  ledger.status = failures.length === 0 ? (correctKnownRejections ? "passed-with-compatibility-limits" : "passed") : "partial";
  await persist();
  return { status: ledger.status, actualCostUsd: ledger.actualCostUsd, unresolvedReservedUsd: ledger.unresolvedReservedUsd, cases: ledger.calls.map((call) => ({ caseId: call.caseId, status: call.status, actualCostUsd: call.actualCostUsd })), failures, readiness: pricing.readiness };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--metadata-only")) {
      const result = await readProviderMetadata();
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, "provider-metadata.json"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(JSON.stringify({ status: "metadata-only", readiness: result.readiness }));
    } else {
      requireCondition(process.argv.includes("--execute"), "LIVE_REQUIRES_EXPLICIT_EXECUTE");
      const flag = process.argv.indexOf("--max-usd");
      requireCondition(flag !== -1, "LIVE_REQUIRES_MAX_USD");
      const result = await runLive(Number(process.argv[flag + 1]), { correctKnownRejections: process.argv.includes("--correct-known-rejections") });
      console.log(JSON.stringify(result));
      if (result.status === "partial") process.exitCode = 1;
    }
  } catch (error) {
    const code = error.code === "EEXIST" ? "EXISTING_BATCH_RECEIPT_NO_AUTOMATIC_REPEAT" : /^[A-Z_]{1,80}$/.test(error.message) ? error.message : "PREFLIGHT_FAILED_SANITIZED";
    console.error(JSON.stringify({ status: "failed", code }));
    process.exitCode = 1;
  }
}
