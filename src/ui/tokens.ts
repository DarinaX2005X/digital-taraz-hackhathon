import tokens from "./tokens.json";

export const designTokens = tokens;
export type SemanticColor = keyof typeof tokens.color;

// File exporters can resolve the same colors used by the CSS variables.
export function colorValue(name: SemanticColor): string {
  const paletteKey = tokens.color[name].slice("{palette.".length, -1) as keyof typeof tokens.palette;
  return tokens.palette[paletteKey];
}
