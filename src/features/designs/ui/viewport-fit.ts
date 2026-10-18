export type DesignViewport = {
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  padding?: number;
};

/** Keeps the whole page visible without allowing invalid or unusably tiny zoom. */
export function fitDesignPage({ viewportWidth, viewportHeight, pageWidth, pageHeight, padding = 64 }: DesignViewport) {
  if (![viewportWidth, viewportHeight, pageWidth, pageHeight, padding].every(Number.isFinite) || pageWidth <= 0 || pageHeight <= 0) return 0.01;
  const availableWidth = Math.max(1, viewportWidth - padding);
  const availableHeight = Math.max(1, viewportHeight - padding);
  return Math.min(4, Math.max(0.01, Math.min(availableWidth / pageWidth, availableHeight / pageHeight)));
}
