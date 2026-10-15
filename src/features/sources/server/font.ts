import { inflateSync } from 'node:zlib';
import { create } from 'fontkit';
import type { SourceFontMetadata } from '../../../contracts/sources';
import { SourceFontMetadataSchema } from '../../../contracts/sources';
import { IdentityError } from '../../identity/server/http';

const invalid = () => new IdentityError('VALIDATION_FAILED', 'sources.errors.font');
const MAX_INPUT = 5 * 1024 * 1024, MAX_EXPANDED = 20 * 1024 * 1024;

/** Checks advertised table bounds before fontkit can allocate or decompress them. */
export function inspectFontTables(bytes: Buffer, format: 'ttf' | 'otf' | 'woff') {
  if (bytes.length < 12 || bytes.length > MAX_INPUT) throw invalid();
  const magic = bytes.subarray(0, 4).toString('ascii');
  const sfnt = bytes.readUInt32BE(0);
  if (format === 'woff') {
    if (magic !== 'wOFF' || bytes.length < 44 || bytes.readUInt32BE(8) !== bytes.length || ![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(4))) throw invalid();
    const count = bytes.readUInt16BE(12), expanded = bytes.readUInt32BE(16);
    if (!count || count > 256 || bytes.readUInt16BE(14) !== 0 || 44 + count * 20 > bytes.length || expanded > MAX_EXPANDED || expanded < 12 + count * 16) throw invalid();
    let total = 12 + count * 16;
    const seen = new Set<string>(), ranges: [number, number][] = [];
    let os2: Buffer | undefined;
    for (let index = 0; index < count; index++) {
      const at = 44 + index * 20, tag = bytes.subarray(at, at + 4).toString('ascii'), offset = bytes.readUInt32BE(at + 4), compressed = bytes.readUInt32BE(at + 8), original = bytes.readUInt32BE(at + 12);
      if (seen.has(tag) || !compressed || compressed > original || original > MAX_EXPANDED || offset < 44 + count * 20 || offset + compressed > bytes.length || ranges.some(([start, end]) => offset < end && offset + compressed > start)) throw invalid();
      seen.add(tag); ranges.push([offset, offset + compressed]); total += (original + 3) & ~3;
      if (total > MAX_EXPANDED) throw invalid();
      if (tag === 'OS/2') { const table = bytes.subarray(offset, offset + compressed); os2 = compressed === original ? table : inflateSync(table, { maxOutputLength: original }); if (os2.length !== original) throw invalid(); }
    }
    if (total !== expanded) throw invalid();
    const metaOffset = bytes.readUInt32BE(24), metaLength = bytes.readUInt32BE(28), metaOriginal = bytes.readUInt32BE(32), privateOffset = bytes.readUInt32BE(36), privateLength = bytes.readUInt32BE(40);
    if ((metaOffset === 0) !== (metaLength === 0) || (metaOffset === 0) !== (metaOriginal === 0) || (privateOffset === 0) !== (privateLength === 0) || total + metaOriginal > MAX_EXPANDED) throw invalid();
    for (const [offset, length] of [[metaOffset, metaLength], [privateOffset, privateLength]] as const) {
      if (length && (offset < 44 + count * 20 || offset + length > bytes.length || ranges.some(([start, end]) => offset < end && offset + length > start))) throw invalid();
      if (length) ranges.push([offset, offset + length]);
    }
    if (metaLength && inflateSync(bytes.subarray(metaOffset, metaOffset + metaLength), { maxOutputLength: metaOriginal }).length !== metaOriginal) throw invalid();
    return os2;
  }
  if ((format === 'ttf' && sfnt !== 0x00010000) || (format === 'otf' && magic !== 'OTTO')) throw invalid();
  const count = bytes.readUInt16BE(4);
  if (!count || count > 256 || 12 + count * 16 > bytes.length) throw invalid();
  const seen = new Set<string>(), ranges: [number, number][] = [];
  let os2: Buffer | undefined;
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16, tag = bytes.subarray(at, at + 4).toString('ascii'), offset = bytes.readUInt32BE(at + 8), length = bytes.readUInt32BE(at + 12);
    if (seen.has(tag) || offset < 12 + count * 16 || offset + length > bytes.length || ranges.some(([start, end]) => offset < end && offset + length > start)) throw invalid();
    seen.add(tag); ranges.push([offset, offset + length]); if (tag === 'OS/2') os2 = bytes.subarray(offset, offset + length);
  }
  return os2;
}

export function inspectSourceFont(bytes: Buffer, format: 'ttf' | 'otf' | 'woff'): SourceFontMetadata {
  try {
    const os2 = inspectFontTables(bytes, format);
    if (!os2 || os2.length < 10) throw invalid();
    const font = create(bytes);
    if (!('familyName' in font)) throw invalid();
    const flags = os2.readUInt16BE(8);
    return SourceFontMetadataSchema.parse({ family: font.familyName, subfamily: font.subfamilyName, postscriptName: font.postscriptName, unitsPerEm: font.unitsPerEm, codePoints: font.characterSet, embedding: flags & 2 ? 'restricted' : flags & 4 ? 'preview-print' : flags & 8 ? 'editable' : 'installable', noSubsetting: Boolean(flags & 0x100), bitmapOnly: Boolean(flags & 0x200) });
  } catch { throw invalid(); }
}
