import { describe, expect, it } from 'vitest';
import { fitDesignPage } from '@/features/designs/ui/viewport-fit';

describe('design viewport fit', () => {
  it('fits the entire page inside the usable viewport', () => {
    expect(fitDesignPage({ viewportWidth: 680, viewportHeight: 620, pageWidth: 1080, pageHeight: 1080 })).toBeCloseTo(556 / 1080);
    expect(fitDesignPage({ viewportWidth: 1000, viewportHeight: 700, pageWidth: 1200, pageHeight: 600 })).toBeCloseTo(936 / 1200);
  });

  it('clamps extreme and invalid dimensions to safe zoom values', () => {
    expect(fitDesignPage({ viewportWidth: 10_000, viewportHeight: 10_000, pageWidth: 100, pageHeight: 100 })).toBe(4);
    expect(fitDesignPage({ viewportWidth: 0, viewportHeight: 0, pageWidth: 100_000, pageHeight: 100_000 })).toBe(0.01);
    expect(fitDesignPage({ viewportWidth: Number.NaN, viewportHeight: 600, pageWidth: 100, pageHeight: 100 })).toBe(0.01);
  });
});
