import sharp from 'sharp';
import { RunError } from '../../runs/domain/errors';

/** PDF-to-image conversion is domain OCR input processing, never application UI rendering. */
export async function sourcePageImage(bytes: Buffer, format: string, pageNumber: number) {
  if (format !== 'pdf') {
    if (pageNumber !== 1 || !['png', 'jpeg', 'webp'].includes(format)) throw new RunError('invalid_result');
    const image = await sharp(bytes, { limitInputPixels: 20_000_000, animated: false }).rotate().resize({ width: 2400, height: 3200, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (image.length > 10 * 1024 * 1024) throw new RunError('invalid_result');
    return image;
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const loading = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, useWasm: false, stopAtErrors: true });
  try {
    const document = await loading.promise;
    if (document.numPages > 100 || pageNumber > document.numPages) throw new RunError('invalid_result');
    const page = await document.getPage(pageNumber), base = page.getViewport({ scale: 1 });
    if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0 || base.width * base.height > 100_000_000) throw new RunError('invalid_result');
    const scale = Math.min(2, 2400 / base.width, 3200 / base.height), viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const render = page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport });
    await render.promise;
    const image = canvas.toBuffer('image/png');
    page.cleanup();
    if (image.length > 10 * 1024 * 1024) throw new RunError('invalid_result');
    return image;
  } finally { await loading.destroy(); }
}

