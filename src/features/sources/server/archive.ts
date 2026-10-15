import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { posix } from 'node:path';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { IdentityError } from '../../identity/server/http';

const archiveError = () => new IdentityError('VALIDATION_FAILED', 'sources.errors.archive');
const MAX_EXPANDED = 60 * 1024 * 1024;

/** Inspect central-directory metadata and count actual inflated bytes before XML parsing. */
export async function readOfficeArchive(bytes: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, file) => error || !file ? reject(archiveError()) : resolve(file)));
  const files = new Map<string, Buffer>(); let total = 0, entries = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (settled) return; settled = true; zip.close(); reject(archiveError()); };
    zip.on('error', fail);
    zip.on('end', () => { if (!settled) { settled = true; resolve(files); } });
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (++entries > 2000 || name.length > 500 || /[\\\x00]/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some((part) => part === '..' || part === '.') || files.has(name) || mode === 0xa000 || entry.generalPurposeBitFlag & 1 || entry.uncompressedSize > 16 * 1024 * 1024 || entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * 200)) { fail(); return; }
      if (name.endsWith('/')) { files.set(name, Buffer.alloc(0)); zip.readEntry(); return; }
      if (/vbaProject|externalLinks|embeddings\/|activeX\//i.test(name)) { fail(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { fail(); return; }
        const chunks: Buffer[] = []; let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length; total += chunk.length;
          if (total > MAX_EXPANDED || size > entry.uncompressedSize) { stream.destroy(); fail(); return; }
          chunks.push(chunk);
        });
        stream.on('error', fail);
        stream.on('end', () => {
          if (settled) return;
          if (size !== entry.uncompressedSize) { fail(); return; }
          files.set(name, Buffer.concat(chunks)); zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

export function xml(bytes: Buffer, handlers: { open?: (tag: SaxesTagPlain) => void; text?: (text: string) => void; close?: (tag: SaxesTagPlain) => void }) {
  let value: string;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw archiveError(); }
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw archiveError(); });
  parser.on('error', () => { throw archiveError(); });
  if (handlers.open) parser.on('opentag', handlers.open);
  if (handlers.text) { parser.on('text', handlers.text); parser.on('cdata', handlers.text); }
  if (handlers.close) parser.on('closetag', handlers.close);
  parser.write(value).close();
}

/** Resolve an OPC relationship against its owning part, never the host filesystem. */
export function resolveOfficeRelationship(relationshipPart: string, target: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(target.split('#')[0]!); } catch { throw archiveError(); }
  if (!decoded || /[\\\x00-\x1f?#]/.test(decoded) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded) || decoded.startsWith('//')) throw archiveError();
  const ownerDirectory = posix.dirname(posix.dirname(relationshipPart));
  const resolved = posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(ownerDirectory === '.' ? '' : ownerDirectory, decoded));
  if (resolved === '.' || resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) throw archiveError();
  return resolved;
}

export function inspectRelationships(files: Map<string, Buffer>) {
  for (const [name, bytes] of files) if (name.endsWith('.rels')) xml(bytes, { open(tag) {
    if (tag.name !== 'Relationship') return;
    const target = tag.attributes.Target ?? '';
    if (tag.attributes.TargetMode === 'External') {
      // Links are inert document content. External images, templates and data are never fetched.
      if (!(tag.attributes.Type ?? '').endsWith('/hyperlink')) throw archiveError();
      let url: URL;
      try { url = new URL(target); } catch { throw archiveError(); }
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) throw archiveError();
      return;
    }
    resolveOfficeRelationship(name, target);
  } });
}
