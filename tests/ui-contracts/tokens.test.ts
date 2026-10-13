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
      ["onSelected", "selected", 4.5], ["onAction", "action", 4.5], ["onAction", "actionHover", 4.5],
      ["controlBorder", "surface", 3], ["controlBorder", "canvas", 3], ["focus", "focusGap", 3],
    ] as const) expect(contrast(colorValue(foreground), colorValue(background))).toBeGreaterThanOrEqual(minimum);
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
});
