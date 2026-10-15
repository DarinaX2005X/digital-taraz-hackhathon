import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicCopy } from "../../src/features/public-site/copy";
import { publicWorkDestination } from '../../src/features/public-site/entry';
import { authReturnTo } from '../../src/features/identity/domain/return-to';

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
  expect(typeof value).toBe("string");
  expect(String(value).trim().length).toBeGreaterThan(0);
  return "string";
}

describe("public-site contracts without browser rendering", () => {
  it("provides matching complete copy in each supported language", () => {
    expect(Object.keys(publicCopy).sort()).toEqual(["en", "kk", "ru"]);
    const baseline = shape(publicCopy.ru);
    expect(shape(publicCopy.en)).toEqual(baseline);
    expect(shape(publicCopy.kk)).toEqual(baseline);
  });

  it("keeps help actions connected to real account journeys", () => {
    for (const copy of Object.values(publicCopy)) {
      expect(copy.helpSections.filter((section) => section.link).map((section) => section.link)).toEqual(['tour', "signup", "verify", "reset", "team"]);
      for (const section of copy.helpSections) if (section.link) expect(section.action).toBeTruthy();
    }
    for (const path of ["sign-up", "auth/verify", "auth/reset", "settings/team"]) {
      expect(existsSync(fileURLToPath(new URL(`src/app/${path}/page.tsx`, root)))).toBe(true);
    }
  });

  it("carries the same opaque goal through guest signup and signed-in entry", () => {
    const token = 'a'.repeat(64);
    const guest = new URL(publicWorkDestination(false, token), 'https://tirlik.invalid');
    expect(guest.pathname).toBe('/sign-up');
    expect(authReturnTo(guest.searchParams.get('returnTo'), guest.searchParams.get('intentToken')!)).toBe(publicWorkDestination(true, token));
    expect(publicWorkDestination(true, token)).toBe(`/app/work?intent=${token}`);
    expect(existsSync(fileURLToPath(new URL("src/app/app/work/page.tsx", root)))).toBe(true);
  });

  it("uses separate account artwork and preserves reduced-motion handling", () => {
    expect(source("src/features/identity/ui/common.tsx")).toContain("/site/account-invitation.png");
    expect(source("src/features/identity/ui/common.tsx")).not.toContain("/site/business-materials.png");
    expect(source("src/features/public-site/public-site.tsx")).toContain("/site/business-materials.png");
    expect(source("src/features/public-site/public-site.module.css")).toContain("prefers-reduced-motion: reduce");
  });
});
