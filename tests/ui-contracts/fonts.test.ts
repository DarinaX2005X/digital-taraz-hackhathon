import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../public/fonts/noto-sans/manifest.json";

const fontDirectory = new URL("../../public/fonts/noto-sans/", import.meta.url);

function tableDirectory(font: Buffer): Map<string, number> {
  expect(font.readUInt32BE(0)).toBe(0x00010000);
  return new Map(Array.from({ length: font.readUInt16BE(4) }, (_, index) => {
    const start = 12 + index * 16;
    return [font.toString("ascii", start, start + 4), font.readUInt32BE(start + 8)];
  }));
}

function glyphId(font: Buffer, cmap: number, codePoint: number): number {
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const start = cmap + font.readUInt32BE(record + 4);
    const format = font.readUInt16BE(start);
    if (format === 12) {
      for (let group = 0; group < font.readUInt32BE(start + 12); group += 1) {
        const offset = start + 16 + group * 12;
        const first = font.readUInt32BE(offset);
        const last = font.readUInt32BE(offset + 4);
        if (codePoint >= first && codePoint <= last) return font.readUInt32BE(offset + 8) + codePoint - first;
      }
    }
    if (format !== 4 || codePoint > 0xffff) continue;
    const count = font.readUInt16BE(start + 6) / 2;
    const endCodes = start + 14;
    const startCodes = endCodes + count * 2 + 2;
    const deltas = startCodes + count * 2;
    const ranges = deltas + count * 2;
    for (let segment = 0; segment < count; segment += 1) {
      if (codePoint < font.readUInt16BE(startCodes + segment * 2) || codePoint > font.readUInt16BE(endCodes + segment * 2)) continue;
      const delta = font.readInt16BE(deltas + segment * 2);
      const range = font.readUInt16BE(ranges + segment * 2);
      if (!range) return (codePoint + delta) & 0xffff;
      const offset = ranges + segment * 2 + range + 2 * (codePoint - font.readUInt16BE(startCodes + segment * 2));
      const glyph = font.readUInt16BE(offset);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
  }
  return 0;
}

describe("local licensed fonts", () => {
  it("keeps the original OFL license alongside its pinned sources", () => {
    const license = readFileSync(new URL(manifest.licenseFile, fontDirectory));
    expect(createHash("sha256").update(license).digest("hex")).toBe(manifest.licenseSha256);
    expect(license.toString()).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(manifest.modified).toBe(false);
  });

  it.each(manifest.files)("$file has real glyphs and embeddable weight $weight", ({ file, weight, sha256 }) => {
    const font = readFileSync(new URL(file, fontDirectory));
    expect(createHash("sha256").update(font).digest("hex")).toBe(sha256);
    const tables = tableDirectory(font);
    const os2 = tables.get("OS/2")!;
    expect(font.readUInt16BE(os2 + 4)).toBe(weight);
    expect(font.readUInt16BE(os2 + 8)).toBe(0);
    expect(tables.has("fvar")).toBe(false);
    const glyphCount = font.readUInt16BE(tables.get("maxp")! + 4);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяӘәҒғҚқҢңӨөҰұҮүҺһІі₸€$%.,:;!?()«»№+-=";
    for (const character of alphabet) {
      const glyph = glyphId(font, tables.get("cmap")!, character.codePointAt(0)!);
      expect(glyph, `${file}: ${character}`).toBeGreaterThan(0);
      expect(glyph).toBeLessThan(glyphCount);
    }
  });
});
