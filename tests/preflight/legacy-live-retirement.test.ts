import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProviderMetadata, runLive } from "../../scripts/preflight/live.mjs";
import { IMAGE_MODEL, TEXT_MODEL } from "../../scripts/preflight/policy.mjs";

const retired = "LEGACY_LIVE_EXECUTION_RETIRED_USE_RUNTIME";
const root = process.cwd();
const script = path.join(root, "scripts/preflight/live.mjs");
const evidence = ["live-receipts.json", "live-correction-lock.json", "provider-metadata.json"];
const evidenceHashes = () => evidence.map((name) => createHash("sha256").update(readFileSync(path.join(root, "tests/preflight/evidence", name))).digest("hex"));

afterEach(() => { vi.unstubAllGlobals(); });

describe("retired legacy paid preflight", () => {
  it("blocks direct execution and correction before credentials, metadata or ledger effects", async () => {
    const before = evidenceHashes();
    const fetch = vi.fn(() => { throw new Error("NETWORK_MUST_NOT_RUN"); });
    vi.stubGlobal("fetch", fetch);
    await expect(runLive(1)).rejects.toThrow(retired);
    await expect(runLive(1, { correctKnownRejections: true })).rejects.toThrow(retired);
    await expect(runLive(Number.NaN)).rejects.toThrow(retired);
    expect(fetch).not.toHaveBeenCalled();
    expect(evidenceHashes()).toEqual(before);
  });

  it.each([
    ["--execute"],
    ["--execute", "--max-usd", "1"],
    ["--execute", "--max-usd", "1", "--correct-known-rejections"],
    ["--metadata-only", "--execute"],
  ])("rejects an executable CLI invocation without paid fallback: %j", (...args) => {
    const before = evidenceHashes();
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, OPENROUTER_API_KEY: "", OPENROUTER_MODEL: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({ status: "failed", code: retired });
    expect(evidenceHashes()).toEqual(before);
  });

  it("keeps unauthenticated metadata reads available without modifying prior evidence", async () => {
    const before = evidenceHashes();
    const fixtures = [
      { data: [{ id: TEXT_MODEL, architecture: {}, pricing: {}, supported_parameters: [] }] },
      { data: { endpoints: [{ tag: "xiaomi/fp8", supported_parameters: [], pricing: {} }] } },
      { data: [{ id: IMAGE_MODEL, architecture: {}, supported_parameters: [] }] },
      { endpoints: [{ provider_tag: "seed", pricing: [] }] },
    ];
    const fetch = vi.fn(async () => new Response(JSON.stringify(fixtures.shift()), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(readProviderMetadata()).resolves.toMatchObject({ text: { id: TEXT_MODEL }, image: { id: IMAGE_MODEL } });
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const call of fetch.mock.calls as unknown as Array<[URL, RequestInit]>) {
      expect(call[0].origin).toBe("https://openrouter.ai");
      expect(call[1]).toEqual({ signal: expect.any(AbortSignal) });
    }
    expect(evidenceHashes()).toEqual(before);
  });
});
