import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { designExportAdapter } from '../../src/features/exports/server/designs';
import { documentInput } from './fixture';

describe('design adapter contract', () => {
  it('renders the frozen selected page and labels historical output', async () => {
    const base = documentInput(), input = {
      ...base,
      format: 'png' as const,
      historicalDraft: true,
      revision: 7,
      pageId: 'page-a',
      content: { kind: 'design' as const, schemaVersion: 1 as const, pages: [{ id: 'page-a', width: 320, height: 240, unit: 'px' as const, background: '#ffffff', layers: [{ id: 'title', type: 'text' as const, text: 'Қазақстан · 143 600 ₸', transform: { x: 16, y: 16, width: 280, height: 80, rotation: 0 }, style: { fontFamily: 'Noto Sans', fontSize: 20, fill: '#202624' } }] }] },
      assets: { ...base.assets, design: { image: async () => { throw new Error('unexpected image'); }, font: async () => { throw new Error('unexpected font'); } } },
    };
    const rendered = await designExportAdapter.render(input), metadata = await sharp(rendered.bytes).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 320, height: 240 });
  });
  it('requires a current authorized design asset resolver', async () => {
    const base = documentInput(), input = { ...base, format: 'png' as const, content: { kind: 'design' as const, schemaVersion: 1 as const, pages: [{ id: 'page', width: 100, height: 100, unit: 'px' as const, background: '#fff', layers: [] }] } };
    await expect(designExportAdapter.render(input)).rejects.toMatchObject({ messageKey: 'exports.errors.formatUnavailable' });
  });
});
