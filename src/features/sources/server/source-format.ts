import type { SourceFormat } from '../../../contracts/sources';
import { IdentityError } from '../../identity/server/http';

export const SOURCE_MEDIA: Record<SourceFormat, string> = {
  text: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
};

const invalidFormat = () => new IdentityError('VALIDATION_FAILED', 'sources.errors.format');

export function validateSourceMagic(bytes: Buffer, format: SourceFormat) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const valid = format === 'ttf' ? starts(0, 1, 0, 0) : format === 'otf' ? bytes.subarray(0, 4).toString('ascii') === 'OTTO' : format === 'woff' ? bytes.subarray(0, 4).toString('ascii') === 'wOFF' : format === 'pdf' ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : format === 'png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      : format === 'jpeg' ? starts(0xff, 0xd8, 0xff)
        : format === 'webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : format === 'xlsx' || format === 'docx' ? starts(0x50, 0x4b, 0x03, 0x04)
            : !bytes.includes(0) && !starts(0x50, 0x4b, 0x03, 0x04) && !starts(0x4d, 0x5a) && !starts(0x7f, 0x45, 0x4c, 0x46);
  if (!valid) throw invalidFormat();
}
