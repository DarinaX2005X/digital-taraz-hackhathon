import { describe, expect, it } from 'vitest';
import { exportCopy } from '../../src/features/exports/client/copy';

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return nested && typeof nested === 'object' && !Array.isArray(nested) ? keys(nested, path) : [path];
  }).sort();
}

describe('export dialog locale contract', () => {
  it('keeps RU, KK and EN state, privacy and recovery labels in parity', () => {
    expect(keys(exportCopy.kk)).toEqual(keys(exportCopy.ru)); expect(keys(exportCopy.en)).toEqual(keys(exportCopy.ru));
    for (const locale of ['ru', 'kk', 'en'] as const) {
      expect(exportCopy[locale].internalWarning.length).toBeGreaterThan(20);
      expect(exportCopy[locale].notSent.length).toBeGreaterThan(20);
      expect(Object.keys(exportCopy[locale].statuses)).toEqual(['queued', 'rendering', 'partial', 'ready', 'failed', 'cancelled', 'pending']);
    }
  });
});
