import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IdentityError } from '../../../identity/server/http';
import type { DocumentNode } from '../../../artifacts/domain/content-models';
import type { ExportWarning } from '../../contracts';
const pinned = { regular: ['NotoSans-Regular.ttf', 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5'], bold: ['NotoSans-Bold.ttf', 'c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a'] } as const;
export async function loadDocumentFonts() {
  const read = async (variant: keyof typeof pinned) => { const [name, hash] = pinned[variant], data = await readFile(path.join(process.cwd(), 'public', 'fonts', 'noto-sans', name)); if (createHash('sha256').update(data).digest('hex') !== hash) throw new IdentityError('UNAVAILABLE', 'exports.errors.fontIntegrity'); return data; };
  const [regular, bold] = await Promise.all([read('regular'), read('bold')]); return { regular, bold };
}
export function checkDocumentFonts(node: DocumentNode, replaceUnsupported: boolean): ExportWarning[] {
  const families = new Set<string>();
  function visit(current: DocumentNode) { for (const mark of current.marks ?? []) if (mark.type === 'textStyle' && typeof mark.attrs?.fontFamily === 'string' && !['Noto Sans', 'sans-serif'].includes(mark.attrs.fontFamily)) families.add(mark.attrs.fontFamily); current.content?.forEach(visit); }
  visit(node); if (families.size && !replaceUnsupported) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.fontUnavailable');
  return [...families].map((family) => ({ code: 'font-replaced', message: family }));
}
