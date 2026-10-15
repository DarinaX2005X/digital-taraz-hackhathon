import type { ExportAdapter } from '../types';
import { renderDocx } from './docx';
import { renderPdf } from './pdf';
export const documentExportAdapter: ExportAdapter = { kind: 'document', formats: ['docx', 'pdf'], render: (input) => input.format === 'docx' ? renderDocx(input) : renderPdf(input) };
