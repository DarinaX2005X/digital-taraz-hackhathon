import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { create as parseFont } from 'fontkit';
import { describe, expect, it } from 'vitest';
import { fontToSfnt, prepareDocumentFonts } from '../../src/features/exports/server/documents/custom-fonts';
import { documentInput } from './fixture';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
describe('embedded font fidelity and permissions', () => {
  it('reconstructs WOFF as readable SFNT with Kazakh glyph coverage', async () => {
    const original = await readFile(path.join(process.cwd(), 'public/fonts/noto-sans/NotoSans-Regular.ttf')), count = original.readUInt16BE(4), records: { tag: Buffer; checksum: number; raw: Buffer; packed: Buffer }[] = [];
    for (let index = 0; index < count; index++) { const position = 12 + index * 16, start = original.readUInt32BE(position + 8), length = original.readUInt32BE(position + 12), raw = original.subarray(start, start + length), compressed = deflateSync(raw); records.push({ tag: original.subarray(position, position + 4), checksum: original.readUInt32BE(position + 4), raw, packed: compressed.length < raw.length ? compressed : raw }); }
    const padded = (length: number) => (length + 3) & ~3, woffSize = 44 + count * 20 + records.reduce((sum, row) => sum + padded(row.packed.length), 0), sfntSize = 12 + count * 16 + records.reduce((sum, row) => sum + padded(row.raw.length), 0), woff = Buffer.alloc(woffSize);
    woff.writeUInt32BE(0x774f4646); woff.writeUInt32BE(original.readUInt32BE(0), 4); woff.writeUInt32BE(woffSize, 8); woff.writeUInt16BE(count, 12); woff.writeUInt32BE(sfntSize, 16);
    let cursor = 44 + count * 20; records.forEach((row, index) => { const position = 44 + index * 20; row.tag.copy(woff, position); woff.writeUInt32BE(cursor, position + 4); woff.writeUInt32BE(row.packed.length, position + 8); woff.writeUInt32BE(row.raw.length, position + 12); woff.writeUInt32BE(row.checksum, position + 16); row.packed.copy(woff, cursor); cursor += padded(row.packed.length); });
    const converted = fontToSfnt(woff), font = parseFont(converted);
    expect('familyName' in font && font.familyName).toBe('Noto Sans');
    expect('hasGlyphForCodePoint' in font && [...'ӘҒҚҢӨҰҮҺІ'].every((character) => font.hasGlyphForCodePoint(character.codePointAt(0)!))).toBe(true);
    await expect(Promise.resolve().then(() => fontToSfnt(woff.subarray(0, 50)))).rejects.toThrow();
  });
  it('honors no-subsetting rights and verifies custom font hashes before embedding', async () => {
    const bytes = await readFile(path.join(process.cwd(), 'public/fonts/noto-sans/NotoSans-Regular.ttf')), input = documentInput([{ type: 'paragraph', attrs: { id: 'custom' }, content: [{ type: 'text', text: 'Brand text', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Brand family' } }] }] }]);
    input.format = 'pdf'; input.options.fontAssets['Brand family'] = '6207b215-78af-43f5-b40f-63f4969092ec';
    input.assets.font = async () => ({ bytes, sha256: hash(bytes), mediaType: 'font/ttf', family: 'Brand family', subfamily: 'Regular', codePoints: [], canEmbed: true, noSubsetting: true });
    await expect(prepareDocumentFonts(input)).rejects.toMatchObject({ messageKey: 'exports.errors.fontNoSubsetting' });
    input.options.replaceUnsupportedFonts = true; expect((await prepareDocumentFonts(input)).resolve('Brand family')).toBe('Noto Sans');
    input.options.replaceUnsupportedFonts = false; input.assets.font = async () => ({ bytes, sha256: '0'.repeat(64), mediaType: 'font/ttf', family: 'Brand family', subfamily: 'Regular', codePoints: [], canEmbed: true, noSubsetting: false });
    await expect(prepareDocumentFonts(input)).rejects.toMatchObject({ messageKey: 'exports.errors.fontUnavailable' });
  });
});
