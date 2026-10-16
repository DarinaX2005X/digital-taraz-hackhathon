type PdfJsWorkerGlobal = { WorkerMessageHandler: object };

/**
 * PDF.js uses a fake worker in Node. Importing its worker module explicitly is
 * required so production bundlers include the module instead of leaving the
 * library's runtime `./pdf.worker.mjs` import unresolved beside a server chunk.
 */
export async function loadServerPdfJs() {
  // pdfjs-dist publishes this executable worker entry without a declaration.
  // @ts-expect-error The side-effect import is required for the server fake worker.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const worker = (globalThis as typeof globalThis & { pdfjsWorker?: PdfJsWorkerGlobal }).pdfjsWorker;
  if (!worker?.WorkerMessageHandler) throw new Error('PDFJS_WORKER_RUNTIME_REQUIRED');
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}
