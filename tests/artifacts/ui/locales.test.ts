import { describe, expect, it } from "vitest";
import { artifactMessages, artifactTranslator, type ArtifactMessageKey } from "@/features/artifacts/locales";

function leaves(input: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => typeof value === "string" ? [[`${prefix}${key}`, value]] : Object.entries(leaves(value as object, `${prefix}${key}.`))));
}

describe("artifact interface translations", () => {
  it("keeps every label, state and placeholder in all three languages", () => {
    const original = leaves(artifactMessages.ru);
    for (const locale of ["kk", "en"] as const) {
      const translated = leaves(artifactMessages[locale]);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(original).sort());
      for (const key of Object.keys(original)) {
        expect(translated[key]?.trim()).not.toBe("");
        expect(translated[key]?.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g)?.sort() ?? []).toEqual(original[key]?.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g)?.sort() ?? []);
      }
    }
  });
  it("interpolates user text once and requires declared variables", () => {
    expect(artifactTranslator("en")("artifacts.versions.branchDefault", { title: "{revision}" })).toBe("{revision} — variant");
    expect(() => artifactTranslator("ru")("artifacts.versions.version")).toThrow("Missing artifact");
    expect(() => artifactTranslator("en")("artifacts.unknown" as ArtifactMessageKey)).toThrow();
  });
});
