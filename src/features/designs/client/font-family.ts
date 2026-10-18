const NEXT_FONT_VARIABLE = '--font-tirlik-sans';
const SYSTEM_FALLBACK = 'Arial';

export function resolveDesignCanvasFontFamily(value: string) {
  const family = value.split(',', 1)[0]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return family || SYSTEM_FALLBACK;
}

/**
 * Design snapshots keep the portable family name `Noto Sans`, while next/font
 * deliberately registers a generated browser-only family. Fabric must use that
 * registered family or canvas text silently falls back to the browser serif.
 */
export async function loadDesignCanvasFont(fonts: Pick<FontFaceSet, 'load'>, weight: number, root?: Element) {
  const cssValue = getComputedStyle(root ?? document.documentElement).getPropertyValue(NEXT_FONT_VARIABLE);
  const family = resolveDesignCanvasFontFamily(cssValue);
  await fonts.load(`${weight} 16px ${JSON.stringify(family)}`);
  return family;
}
