import mammoth from 'mammoth';
import { readOfficeArchive, inspectRelationships, xml } from '@/features/sources/server/archive';
import { ContentValidationError } from '@/features/artifacts/domain/canonical';
import { importDocumentHtml, type DocumentImport, type ImportLossCode } from '../domain/import-html';

export interface ImportedImage { id: string; width: number; height: number; mediaType: string }
export type StoreDocumentImage = (bytes: Buffer, mediaType: string) => Promise<ImportedImage>;

export async function importDocx(bytes: Buffer, options: { storeImage?: StoreDocumentImage; makeId?: () => string } = {}): Promise<DocumentImport> {
  if (bytes.length > 20 * 1024 * 1024) throw new ContentValidationError('document-too-large');
  const archive = await readOfficeArchive(bytes);
  inspectRelationships(archive);
  if (!archive.has('word/document.xml') || !archive.has('[Content_Types].xml')) throw new ContentValidationError('invalid-docx');
  const losses = new Map<ImportLossCode, number>([['layout', 1]]);
  const note = (code: ImportLossCode, count = 1) => losses.set(code, (losses.get(code) ?? 0) + count);
  let structuralNodes = 0;
  for (const [name, buffer] of archive) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) xml(buffer, { open(tag) {
      if (name === 'word/document.xml') {
        if (['w:p', 'w:tbl', 'w:tr', 'w:tc', 'w:r'].includes(tag.name) && ++structuralNodes > 20000) throw new ContentValidationError('document-too-complex');
        if (['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].includes(tag.name)) note('tracked-changes');
        if (['w:object', 'w:altChunk', 'w:fldChar'].includes(tag.name)) note('embedded-object');
        if (['w:rFonts', 'w:color', 'w:highlight', 'w:shd', 'w:sz', 'w:jc', 'w:ind', 'w:spacing', 'w:tblBorders', 'w:tcBorders'].includes(tag.name)) note('formatting');
      }
    } });
    if (/^word\/(?:header|footer)\d*\.xml$/.test(name)) note('headers-footers');
    if (/^word\/(?:footnotes|endnotes)\.xml$/.test(name)) note('footnotes');
  }
  const assets = new Set<string>();
  const result = await mammoth.convertToHtml({ buffer: bytes }, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    includeDefaultStyleMap: true,
    ignoreEmptyParagraphs: false,
    styleMap: ["u => u", "br[type='page'] => hr:fresh"],
    convertImage: mammoth.images.imgElement(async (image) => {
      if (!options.storeImage || !['image/png', 'image/jpeg', 'image/webp'].includes(image.contentType)) return { src: '' };
      const content = await image.readAsBuffer();
      if (content.length > 20 * 1024 * 1024) throw new ContentValidationError('image-too-large');
      const asset = await options.storeImage(content, image.contentType);
      assets.add(asset.id); return { src: `tirlik-asset:${asset.id}`, width: String(asset.width), height: String(asset.height) };
    }),
  });
  for (const message of result.messages) note(message.type === 'error' ? 'unsupported-content' : 'formatting');
  const imported = importDocumentHtml(result.value, { makeId: options.makeId, assetIds: assets });
  for (const item of imported.losses) note(item.code, item.count);
  return { content: imported.content, losses: [...losses].map(([code, count]) => ({ code, count })) };
}
