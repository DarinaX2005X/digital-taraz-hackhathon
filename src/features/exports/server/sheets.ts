import { exportTable } from '../../sheets/server/export';
import { IdentityError } from '../../identity/server/http';
import type { ExportAdapter } from './types';
export const sheetExportAdapter: ExportAdapter = { kind: 'table', formats: ['xlsx', 'csv'], async render(input) {
  if (input.content.kind !== 'table' || (input.format !== 'xlsx' && input.format !== 'csv')) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable');
  const file = await exportTable(input.content, { format: input.format, sheetId: input.options.sheetId, locale: input.locale, signal: input.signal });
  if (!input.historicalDraft && file.warnings.some((warning) => warning.code === 'formula-errors')) throw new IdentityError('CONFLICT', 'exports.errors.calculationsUnresolved');
  return file;
} };
