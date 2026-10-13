import { describe, expect, it } from "vitest";

function appUrl() {
  const port = Number(process.env.TIRLIK_TEST_APP_PORT);
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? "") || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("ISOLATED_HTTP_TEST_CONTEXT_REQUIRED");
  }
  return `http://127.0.0.1:${port}`;
}

describe("server locale and local assets", () => {
  it.each(["ru", "kk", "en"])("serves the explicit %s preference", async (locale) => {
    const response = await fetch(appUrl(), {
      headers: { Cookie: `tirlik-locale=${locale}`, "Accept-Language": "fr" },
      signal: AbortSignal.timeout(60_000),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`<html lang="${locale}"`);
  }, 70_000);

  it("ignores unsupported cookie values and serves the supported request language", async () => {
    const response = await fetch(appUrl(), {
      headers: { Cookie: "tirlik-locale=unknown", "Accept-Language": "kk-KZ,en;q=0.5" },
      signal: AbortSignal.timeout(15_000),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html lang="kk"');
  });

  it("serves the actual local brand and licensed font files", async () => {
    const icon = await fetch(`${appUrl()}/brand/favicon.svg`, { signal: AbortSignal.timeout(15_000) });
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
    const font = await fetch(`${appUrl()}/fonts/noto-sans/NotoSans-Regular.ttf`, { signal: AbortSignal.timeout(15_000) });
    expect(font.status).toBe(200);
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(100_000);
  });
});
