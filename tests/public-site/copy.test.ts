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
      expect(copy.helpSections.filter((section) => section.link).map((section) => section.link)).toEqual(['tour', "signup", "reset", "team"]);
      for (const section of copy.helpSections) if (section.link) expect(section.action).toBeTruthy();
    }
    for (const path of ["sign-up", "auth/reset", "settings/team"]) {
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

  it("uses a dedicated account illustration and a code-native workflow scene", () => {
    expect(source("src/features/identity/ui/common.tsx")).toContain("/site/account-invitation.png");
    expect(source("src/features/identity/ui/common.tsx")).not.toContain("/site/business-materials.png");
    expect(source("src/features/public-site/public-site.tsx")).toContain("<HeroWorkflowScene copy={copy} />");
    expect(source("src/features/public-site/public-site.tsx")).not.toContain("/site/business-materials.png");
    expect(source("src/features/public-site/public-site.module.css")).toContain("prefers-reduced-motion: reduce");
  });

  it("renders one direct hero heading without an eyebrow or duplicate slogan", () => {
    const page = source("src/features/public-site/public-site.tsx");
    expect(page.match(/<h1\b/g)).toHaveLength(2); // one home heading and one mutually-exclusive information-page heading
    expect(page.match(/<h1 id="tirlik-title"/g)).toHaveLength(1);
    expect(page).not.toContain("copy.tagline");
    expect(page).not.toMatch(/eyebrow|kicker/i);
    expect(publicCopy.ru.heroTitle).toBe('Всё для вашего бизнеса');
    expect(publicCopy.en.heroTitle).toBe('Everything for your business');
    expect(publicCopy.kk.heroTitle).toBe('Бизнесіңізге қажеттінің бәрі');
  });

  it("makes the assistant-led business decision the first public argument", () => {
    for (const copy of Object.values(publicCopy)) {
      expect(copy.heroTitle.length).toBeGreaterThan(18);
      expect(copy.description.length).toBeGreaterThan(80);
      expect(copy.proof.goal.length).toBeGreaterThan(30);
      expect(copy.proof.plan).toHaveLength(3);
      expect(copy.proof.findings).toHaveLength(3);
      expect(copy.proof.results.map((result) => result.title)).toHaveLength(3);
      expect(copy.proof.continuation.length).toBeGreaterThan(50);
    }
    expect(publicCopy.ru.ownTaskAction).toBe('Начать задачу');
    expect(publicCopy.ru.proof.goal).toContain('без убыточных условий');
    expect(publicCopy.ru.proof.findings.join(' ')).toContain('загрузк');
  });

  it("does not advertise the weak editor-only example as the product proof", () => {
    const page = source("src/features/public-site/public-site.tsx");
    const proof = source("src/features/public-site/decision-proof.tsx");
    expect(page).toContain('<DecisionProof copy={copy} />');
    expect(page).toContain('href="/app/work"');
    expect(page).toContain('/demo');
    expect(page).toContain('copy.exampleAction');
    expect(page).not.toContain('copy.demoHint');
    expect(page).toContain('<PublicMediaActions copy={copy} />');
    const media = source("src/features/public-site/public-media-actions.tsx");
    expect(media).toContain('copy.watchDemo');
    expect(media).toContain('copy.presentation');
    expect(media).toContain('/presentation/tirlik-presentation.pdf');
    expect(media).toContain('/presentation/tirlik-presentation.pptx');
    expect(media).toContain('{open && <video');
    expect(media).toContain('preload="none"');
    expect(proof).not.toMatch(/<input|<form/);
    expect(proof).toContain('aria-pressed={index === activeStep}');
    expect(proof).toContain('aria-controls="assistant-plan-detail"');
    expect(proof).toContain('<blockquote');
    expect(proof).toContain('<dl>');
  });

  it("gives interactive public cards matching hover, focus and reduced-motion states", () => {
    const css = source("src/features/public-site/public-site.module.css");
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    expect(css).toContain('.proofPlan button:hover');
    expect(css).toContain('.proofPlan button:focus-visible');
    expect(css).toContain('.informationCard:focus-visible');
    expect(css).toContain('.exampleBand>:global(.tl-button--primary:hover)');
    expect(css).toContain('background:#eaf0ec; color:#17332e');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
  });

  it("keeps public copy free of temporary delivery reports and fabricated evidence", () => {
    const copy = JSON.stringify(publicCopy);
    for (const phrase of ['coming soon', 'пока недоступ', 'ещё не готов', 'trusted by', 'нам доверяют']) expect(copy.toLowerCase()).not.toContain(phrase);
    expect(copy).not.toMatch(/\d+\s*%/);
    expect(source("src/features/public-site/public-site.module.css")).not.toContain('transition: all');
  });
});
