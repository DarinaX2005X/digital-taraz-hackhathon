import type { SourceFragment } from '../../../contracts/sources';
import { IdentityError } from '../../identity/server/http';
import { inspectRelationships, readOfficeArchive, resolveOfficeRelationship, xml } from './archive';

const invalid = (key = 'format') => new IdentityError('VALIDATION_FAILED', `sources.errors.${key}`);
const required = (files: Map<string, Buffer>, name: string) => { const value = files.get(name); if (!value) throw invalid(); return value; };
export async function extractOffice(bytes: Buffer, format: 'xlsx' | 'docx'): Promise<{ fragments: SourceFragment[]; sheets: string[]; diagnostics: string[] }> {
  const files = await readOfficeArchive(bytes); inspectRelationships(files);
  required(files, '[Content_Types].xml');
  if (format === 'docx') {
    const fragments: SourceFragment[] = []; let text = '', inText = false, paragraph = 0;
    xml(required(files, 'word/document.xml'), {
      open(tag) { if (tag.name === 'w:t') inText = true; if (tag.name === 'w:tab') text += '\t'; if (tag.name === 'w:br') text += '\n'; },
      text(value) { if (inText) text += value; if (text.length > 1_000_000) throw invalid('tooLarge'); },
      close(tag) {
        if (tag.name === 'w:t') inText = false;
        if (tag.name === 'w:p') { fragments.push({ id: `paragraph:${++paragraph}`, text, review: 'observed' }); text = ''; if (paragraph > 100000) throw invalid('tooLarge'); }
      },
    });
    return { fragments, sheets: [], diagnostics: ['document-text-only'] };
  }
  const shared: string[] = []; let text = '', inText = false;
  const strings = files.get('xl/sharedStrings.xml');
  if (strings) xml(strings, {
    open(tag) { if (tag.name === 'si') text = ''; if (tag.name === 't') inText = true; },
    text(value) { if (inText) text += value; if (text.length > 64000) throw invalid('tooLarge'); },
    close(tag) { if (tag.name === 't') inText = false; if (tag.name === 'si') { shared.push(text); if (shared.length > 2_000_000) throw invalid('tooLarge'); } },
  });
  const relations = new Map<string, string>();
  xml(required(files, 'xl/_rels/workbook.xml.rels'), { open(tag) {
    if (tag.name === 'Relationship') {
      const id = tag.attributes.Id, target = tag.attributes.Target;
      if (!id || !target || relations.has(id)) throw invalid();
      if (tag.attributes.TargetMode === 'External') return;
      relations.set(id, resolveOfficeRelationship('xl/_rels/workbook.xml.rels', target));
    }
  } });
  const sheets: { name: string; path: string }[] = [];
  xml(required(files, 'xl/workbook.xml'), { open(tag) {
    if (tag.name === 'sheet') {
      const target = relations.get(tag.attributes['r:id']!); if (!target) throw invalid();
      sheets.push({ name: tag.attributes.name ?? '', path: target });
      if (sheets.length > 100) throw invalid('tooLarge');
    }
  } });
  const fragments: SourceFragment[] = []; let hasFormulas = false;
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
    const sheet = sheets[sheetIndex]!;
    let row = 0, previousRow = 0, values: string[] = [], formulas: Record<string, string> = {}, col = 0, cellType = '', field = '', value = '', formula = '';
    xml(required(files, sheet.path), {
      open(tag) {
        if (tag.name === 'row') {
          row = Number(tag.attributes.r ?? previousRow + 1);
          if (!Number.isSafeInteger(row) || row <= previousRow || row > 20000) throw invalid('rowLimit');
          values = []; formulas = {};
        }
        if (tag.name === 'c') {
          const address = /^([A-Z]+)([1-9]\d*)$/.exec(tag.attributes.r ?? '');
          if (!address || Number(address[2]) !== row) throw invalid();
          col = [...address[1]!].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
          if (col >= 100 || col < values.length) throw invalid('columnLimit');
          while (values.length < col) values.push('');
          cellType = tag.attributes.t ?? 'n'; value = ''; formula = '';
        }
        if (['v', 'f', 't'].includes(tag.name)) field = tag.name;
      },
      text(part) {
        if (field === 'f') formula += part;
        else if (field === 'v' || field === 't') value += part;
        if (value.length > 64000 || formula.length > 64000) throw invalid('tooLarge');
      },
      close(tag) {
        if (['v', 'f', 't'].includes(tag.name)) field = '';
        if (tag.name === 'c') {
          if (cellType === 's') { if (!/^\d+$/.test(value) || shared[Number(value)] === undefined) throw invalid(); value = shared[Number(value)]!; }
          values[col] = value;
          if (formula) { formulas[String(col)] = formula; hasFormulas = true; }
        }
        if (tag.name === 'row') {
          for (let missing = previousRow + 1; missing < row; missing++) fragments.push({ id: `sheet:${sheetIndex}:row:${missing}`, sheet: sheet.name, row: missing, values: [], review: 'observed' });
          fragments.push({ id: `sheet:${sheetIndex}:row:${row}`, sheet: sheet.name, row, values, ...(Object.keys(formulas).length ? { formulas } : {}), review: 'observed' });
          previousRow = row;
          if (fragments.length > 100000) throw invalid('rowLimit');
        }
      },
    });
  }
  return { fragments, sheets: sheets.map((sheet) => sheet.name), diagnostics: ['spreadsheet-raw-values', ...(hasFormulas ? ['formulas-not-evaluated'] : [])] };
}
