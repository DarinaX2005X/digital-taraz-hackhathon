import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SourceAssetLicenseSchema, SourceOptionsSchema, SourcePageContentSchema } from '../../src/contracts/sources';
import { inspectFontTables, inspectSourceFont } from '../../src/features/sources/server/font';
import { extractSource } from '../../src/features/sources/server/parser';
import { recognizedFragments } from '../../src/features/sources/server/review';
import { sourceCopies } from '../../src/features/sources/locales';

describe('bounded source visual assets and review', () => {
  it('reads real font names, Kazakh coverage and OS/2 restrictions without inventing license permission', async () => {
    const bytes = await readFile('public/fonts/noto-sans/NotoSans-Regular.ttf');
    const font = inspectSourceFont(bytes, 'ttf');
    expect(font.family).toMatch(/Noto Sans/);
    expect(font.codePoints).toEqual(expect.arrayContaining([0x4d8, 0x492, 0x49a, 0x4b0, 0x4ae, 0x406]));
    expect(font.embedding).toBe('installable');
    const restricted = Buffer.from(bytes), count = restricted.readUInt16BE(4);
    for (let index = 0; index < count; index++) { const at = 12 + index * 16; if (restricted.subarray(at, at + 4).toString('ascii') === 'OS/2') restricted.writeUInt16BE(0x302, restricted.readUInt32BE(at + 8) + 8); }
    expect(inspectSourceFont(restricted, 'ttf')).toMatchObject({ embedding: 'restricted', noSubsetting: true, bitmapOnly: true });
    expect(SourceAssetLicenseSchema.safeParse({ permission: 'unknown', canEmbed: true }).success).toBe(false);
  });
  it('rejects collections, oversized/deceptive tables and decompression claims before parsing', async () => {
    const bytes = await readFile('public/fonts/noto-sans/NotoSans-Regular.ttf');
    const escaped = Buffer.from(bytes); escaped.writeUInt32BE(bytes.length + 1000, 20);
    expect(() => inspectFontTables(escaped, 'ttf')).toThrow();
    const collection = Buffer.from(bytes); collection.write('ttcf'); expect(() => inspectFontTables(collection, 'ttf')).toThrow();
    const woff = Buffer.alloc(64); woff.write('wOFF'); woff.writeUInt32BE(0x00010000, 4); woff.writeUInt32BE(64, 8); woff.writeUInt16BE(1, 12); woff.writeUInt32BE(30 * 1024 * 1024, 16);
    expect(() => inspectFontTables(woff, 'woff')).toThrow();
    expect(() => inspectFontTables(Buffer.alloc(5 * 1024 * 1024 + 1), 'ttf')).toThrow();
  });
  it('publishes an explicitly visual image without OCR while text intent remains partial', async () => {
    const image = await readFile('fixtures/business/services/product-photo.jpg');
    const visual = await extractSource(image, 'jpeg', { encoding: 'utf-8', purpose: 'visual' });
    expect(visual.manifest.complete).toBe(true); expect(visual.manifest.diagnostics).not.toContain('vision-required'); expect(visual.manifest.diagnostics).not.toContain('empty-content');
    const text = await extractSource(image, 'jpeg', { encoding: 'utf-8', purpose: 'text' });
    expect(text.manifest.complete).toBe(false); expect(text.pages).toEqual([{ page: 1, state: 'pending' }]);
    expect(SourceOptionsSchema.parse({ encoding: 'utf-8' })).toEqual({ encoding: 'utf-8' });
  });
  it('keeps observed empty values and source coordinates through human review', () => {
    const content = SourcePageContentSchema.parse({ blocks: [{ text: 'Қызмет шарттары' }, { values: ['001', '12,50', '', '₸'] }], warnings: ['Check the faded number'] });
    const fragments = recognizedFragments(4, content);
    expect(fragments[1]).toEqual({ id: 'recognized:4:2', page: 4, row: 2, values: ['001', '12,50', '', '₸'], review: 'needs-review' });
    expect(recognizedFragments(4, content, true)[1]?.review).toBe('observed');
    expect(SourcePageContentSchema.safeParse({ blocks: [{ text: 'a', values: ['b'] }], warnings: [] }).success).toBe(false);
  });
  it('provides equivalent recognition and rights controls in all three locales', () => {
    for (const locale of ['kk', 'en'] as const) expect(Object.keys(sourceCopies[locale]).sort()).toEqual(Object.keys(sourceCopies.ru).sort());
    for (const copy of Object.values(sourceCopies)) for (const value of Object.values(copy)) expect(value.trim()).not.toBe('');
  });
});
