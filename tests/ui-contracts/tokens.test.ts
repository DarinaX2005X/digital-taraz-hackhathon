import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorValue, designTokens } from "../../src/ui/tokens";
import { renderTokens } from "../../src/ui/build-tokens.mjs";

function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

const contrast = (a: string, b: string) => {
  const levels = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (levels[0]! + 0.05) / (levels[1]! + 0.05);
};

describe("implemented semantic colors", () => {
  it("keeps generated CSS equal to the canonical tokens", () => {
    expect(readFileSync(new URL("../../src/ui/tokens.css", import.meta.url), "utf8")).toBe(renderTokens(designTokens));
  });

  it.each(["text", "muted", "action", "danger"] as const)("%s meets normal text contrast on all working surfaces", (foreground) => {
    for (const background of ["surface", "canvas", "selected"] as const) {
      expect(contrast(colorValue(foreground), colorValue(background))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("checks status text, selected text, action labels and input/focus boundaries", () => {
    for (const [foreground, background, minimum] of [
      ["warning", "warningSurface", 4.5], ["success", "successSurface", 4.5],
      ["danger", "dangerSurface", 4.5], ["onDeep", "deepSurface", 4.5],
      ["text", "inset", 4.5],
      ["onSelected", "selected", 4.5], ["onAction", "action", 4.5], ["onAction", "actionHover", 4.5],
      ["controlBorder", "surface", 3], ["controlBorder", "canvas", 3], ["focus", "focusGap", 3],
    ] as const) expect(contrast(colorValue(foreground), colorValue(background))).toBeGreaterThanOrEqual(minimum);
  });

  it("matches the approved palette, type, spacing, geometry and motion constants", () => {
    expect(designTokens.palette).toMatchObject({ canvas: "#F3F6F4", white: "#FFFFFF", mist: "#EAF0EC", graphite: "#17332E", muted: "#4D655E", teal: "#086A60", tealDeep: "#07594F", tealPale: "#DDEFE6", divider: "#C5D2CA", control: "#748B80", coral: "#E48068" });
    expect(designTokens.type).toMatchObject({ hero: "3.25rem", heroLine: "3.75rem", heroNarrow: "2.375rem", heroNarrowLine: "2.75rem", page: "1.875rem", pageLine: "2.375rem", section: "1.5rem", sectionLine: "2rem", object: "1.125rem", objectLine: "1.625rem" });
    expect(designTokens.space["18"]).toBe("72px");
    expect(designTokens.size).toMatchObject({ touch: "44px", compact: "36px", public: "1440px", read: "68ch" });
    expect(designTokens.motion).toEqual({ press: "90ms", hover: "160ms", menu: "220ms", object: "280ms", ease: "cubic-bezier(0.23, 1, 0.32, 1)" });
  });

  it("keeps the approved mark geometry across variants and favicon", () => {
    const geometries = (svg: string) => [...svg.matchAll(/<(?:path|rect)\s[^>]+/g)]
      .map(([element]) => element.replace(/\s(?:fill|stroke)="[^"]*"/g, ""));
    const original = readFileSync(new URL("../../.vibemachina/assets/tirlik-mark-proposal.svg", import.meta.url), "utf8");
    for (const name of ["tirlik-mark.svg", "tirlik-mark-mono.svg", "favicon.svg"]) {
      const svg = readFileSync(new URL(`../../public/brand/${name}`, import.meta.url), "utf8");
      expect(geometries(svg)).toEqual(geometries(original));
    }
  });

  it("applies the approved palette to the maintained brand variants", () => {
    const color = readFileSync(new URL("../../public/brand/tirlik-mark.svg", import.meta.url), "utf8").toLowerCase();
    expect(color).toContain('fill="#086a60"');
    expect(color).toContain('fill="#e48068"');
    expect(color).toContain('stroke="#c5d2ca"');
    const mono = readFileSync(new URL("../../public/brand/tirlik-mark-mono.svg", import.meta.url), "utf8").toLowerCase();
    expect(mono).not.toMatch(/#086a60|#e48068/);
  });
});
