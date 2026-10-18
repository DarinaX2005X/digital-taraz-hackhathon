import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDesignCanvasFont, resolveDesignCanvasFontFamily } from '@/features/designs/client/font-family';

afterEach(() => vi.unstubAllGlobals());

describe('design canvas font family', () => {
  it('uses the primary browser family registered by next/font', () => {
    expect(resolveDesignCanvasFontFamily(' "__tirlikFont_a19f", "__tirlikFont_Fallback_a19f" ')).toBe('__tirlikFont_a19f');
  });

  it('falls back to a sans family when the CSS variable is unavailable', () => {
    expect(resolveDesignCanvasFontFamily('')).toBe('Arial');
    expect(resolveDesignCanvasFontFamily('   ')).toBe('Arial');
  });

  it('loads the resolved browser family before Fabric creates text', async () => {
    const getPropertyValue = vi.fn().mockReturnValue('"__tirlikFont_a19f", Arial');
    const load = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue }));

    await expect(loadDesignCanvasFont({ load }, 600, {} as Element)).resolves.toBe('__tirlikFont_a19f');
    expect(getPropertyValue).toHaveBeenCalledWith('--font-tirlik-sans');
    expect(load).toHaveBeenCalledWith('600 16px "__tirlikFont_a19f"');
  });
});
