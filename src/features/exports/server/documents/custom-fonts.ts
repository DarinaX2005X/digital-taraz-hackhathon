import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { create as parseFont, type Font } from 'fontkit';
import { IdentityError } from '../../../identity/server/http';
import type { DocumentNode } from '../../../artifacts/domain/content-models';
import type { ExportWarning } from '../../contracts';
import type { RenderInput } from '../types';
import { loadDocumentFonts } from './fonts';

const fail = (key: string) => new IdentityError('VALIDATION_FAILED', `exports.errors.${key}`);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const aligned = (size: number) => (size + 3) & ~3;

/** DOCX embeds SFNT bytes. Uploaded WOFF is a compressed SFNT container. */
export function fontToSfnt(bytes: Uint8Array): Buffer {
  const source = Buffer.from(bytes);
  if (source.length < 12 || source.length > 10 * 1024 * 1024) throw fail('fontUnavailable');
  if (source.readUInt32BE(0) !== 0x774f4646) return source;
  if (source.length < 44) throw fail('fontUnavailable');
  const count = source.readUInt16BE(12), expectedSize = source.readUInt32BE(16);
  if (!count || count > 256 || source.length < 44 + count * 20 || source.readUInt32BE(8) !== source.length || expectedSize > 20 * 1024 * 1024) throw fail('fontUnavailable');
  const tables: { tag: Buffer; checksum: number; bytes: Buffer }[] = [];
  let totalLength = 12 + count * 16;
  for (let index = 0; index < count; index++) {
    const offset = 44 + index * 20, start = source.readUInt32BE(offset + 4), compressed = source.readUInt32BE(offset + 8), length = source.readUInt32BE(offset + 12);
    totalLength += aligned(length);
    if (length > 20 * 1024 * 1024 || totalLength > expectedSize || start < 44 + count * 20 || start + compressed > source.length || compressed > length) throw fail('fontUnavailable');
    const packed = source.subarray(start, start + compressed), data = compressed === length ? packed : inflateSync(packed, { maxOutputLength: length });
    if (data.length !== length) throw fail('fontUnavailable');
    const tag = source.subarray(offset, offset + 4);
    if (tag.toString('ascii') === 'head' && data.length < 12) throw fail('fontUnavailable');
    tables.push({ tag, checksum: source.readUInt32BE(offset + 16), bytes: data });
  }
  const length = 12 + count * 16 + tables.reduce((sum, table) => sum + aligned(table.bytes.length), 0);
  if (length !== expectedSize) throw fail('fontUnavailable');
  const output = Buffer.alloc(length), power = Math.floor(Math.log2(count));
  output.writeUInt32BE(source.readUInt32BE(4), 0); output.writeUInt16BE(count, 4); output.writeUInt16BE((2 ** power) * 16, 6); output.writeUInt16BE(power, 8); output.writeUInt16BE(count * 16 - (2 ** power) * 16, 10);
  let cursor = 12 + count * 16, headOffset: number | undefined;
  tables.forEach((table, index) => {
    const offset = 12 + index * 16; table.tag.copy(output, offset); output.writeUInt32BE(table.checksum, offset + 4); output.writeUInt32BE(cursor, offset + 8); output.writeUInt32BE(table.bytes.length, offset + 12); table.bytes.copy(output, cursor);
    if (table.tag.toString('ascii') === 'head') headOffset = cursor; cursor += aligned(table.bytes.length);
  });
  if (headOffset !== undefined) {
    output.writeUInt32BE(0, headOffset + 8); let sum = 0;
    for (let offset = 0; offset < output.length; offset += 4) sum = (sum + output.readUInt32BE(offset)) >>> 0;
    output.writeUInt32BE((0xb1b0afba - sum) >>> 0, headOffset + 8);
  }
  return output;
}

export interface DocumentFontFace { family: string; regular: Buffer; bold?: Buffer; sha256: string; font: Font }
export interface DocumentFontSet { builtin: Awaited<ReturnType<typeof loadDocumentFonts>>; faces: Map<string, DocumentFontFace>; resolve(family?: string): string; warnings: ExportWarning[] }

export async function prepareDocumentFonts(input: RenderInput): Promise<DocumentFontSet> {
  if (input.content.kind !== 'document') throw fail('formatUnavailable');
  const builtin = await loadDocumentFonts(), defaultFont = parseFont(builtin.regular);
  if (!('hasGlyphForCodePoint' in defaultFont)) throw fail('fontUnavailable');
  const faces = new Map<string, DocumentFontFace>([['Noto Sans', { family: 'Noto Sans', regular: builtin.regular, bold: builtin.bold, sha256: digest(builtin.regular), font: defaultFont }]]), requested = new Map<string, string[]>(), warnings: ExportWarning[] = [];
  const visit = (node: DocumentNode) => {
    if (node.type === 'text' || node.type === 'dataField') {
      const family = node.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.fontFamily, name = typeof family === 'string' && family !== 'sans-serif' ? family : 'Noto Sans', value = node.type === 'dataField' ? String(node.attrs?.value ?? '') : node.text ?? '';
      requested.set(name, [...requested.get(name) ?? [], value]);
    }
    node.content?.forEach(visit);
  };
  visit(input.content.document);
  requested.set('Noto Sans', [...requested.get('Noto Sans') ?? [], input.options.layout.headerText ?? '', input.options.layout.footerText ?? '', input.historicalDraft ? 'Исторический черновик Тарихи нобай Historical draft' : '']);
  const replacements = new Set<string>();
  const replacementWarning = (family: string): ExportWarning => ({ code: 'font-replaced', message: { ru: `Шрифт «${family}» заменён на Noto Sans.`, kk: `«${family}» қарпі Noto Sans қарпімен ауыстырылды.`, en: `The font “${family}” was replaced with Noto Sans.` }[input.locale] });
  for (const [family, strings] of requested) {
    if (family !== 'Noto Sans') {
      const assetId = input.options.fontAssets[family];
      try {
        if (!assetId || !input.assets.font) throw fail('fontUnavailable');
        const asset = await input.assets.font(assetId);
        if (!asset.canEmbed || asset.family !== family || digest(asset.bytes) !== asset.sha256 || (input.format === 'pdf' && asset.noSubsetting)) throw fail(asset.noSubsetting ? 'fontNoSubsetting' : 'fontUnavailable');
        const regular = fontToSfnt(asset.bytes), parsed = parseFont(regular);
        if (!('hasGlyphForCodePoint' in parsed)) throw fail('fontUnavailable');
        faces.set(family, { family, regular, sha256: asset.sha256, font: parsed });
      } catch (error) {
        if (!input.options.replaceUnsupportedFonts) throw error;
        replacements.add(family); warnings.push(replacementWarning(family));
      }
    }
    let face = faces.get(family) ?? faces.get('Noto Sans')!;
    const missing = strings.some((value) => [...value].some((character) => !/[\n\r\t]/.test(character) && !face.font.hasGlyphForCodePoint(character.codePointAt(0)!)));
    if (missing) {
      if (family === 'Noto Sans' || !input.options.replaceUnsupportedFonts) throw fail('fontGlyphMissing');
      face = faces.get('Noto Sans')!;
      if (strings.some((value) => [...value].some((character) => !/[\n\r\t]/.test(character) && !face.font.hasGlyphForCodePoint(character.codePointAt(0)!)))) throw fail('fontGlyphMissing');
      replacements.add(family); warnings.push(replacementWarning(family));
    }
  }
  return { builtin, faces, warnings, resolve: (family) => !family || family === 'sans-serif' || replacements.has(family) ? 'Noto Sans' : family };
}
