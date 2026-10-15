'use client';
import { useEffect, useRef } from 'react';
import { LocaleType, LogLevel, Univer, UniverInstanceType, type ICellData, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverUIPlugin } from '@univerjs/ui';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import SheetsUiEnUS from '@univerjs/sheets-ui/locale/en-US';
import UiEnUS from '@univerjs/ui/locale/en-US';
import DocsUiEnUS from '@univerjs/docs-ui/locale/en-US';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import type { TableCell } from '@/features/artifacts/domain/content-models';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { requireTable, type CellAddress, type TableContent } from '../domain/model';

export type GridSelection = CellAddress & { endRow: number; endColumn: number };
type Props = { content: TableContent; activeSheetId: string; selection: GridSelection; disabled: boolean; onChange(content: TableContent): void; onSelect(selection: GridSelection): void; onHistory(action: 'undo' | 'redo'): void; onError(error: unknown): void };

/** The canvas is only an editable projection. ArtifactSession owns persistence,
 * conflicts and history; native undo never becomes a second history authority. */
export function UniverGrid(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props);
  const engine = useRef<{ univer: Univer; api: FUniver; content: TableContent; projecting: boolean } | null>(null);
  useEffect(() => { latest.current = props; });
  useEffect(() => {
    if (!host.current) return;
    const initial = latest.current;
    const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: { ...SheetsEnUS, ...SheetsUiEnUS, ...UiEnUS, ...DocsUiEnUS } }, logLevel: LogLevel.ERROR });
    univer.registerPlugin(UniverRenderEnginePlugin); univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, { container: host.current, header: false, toolbar: false, footer: false, contextMenu: false });
    univer.registerPlugin(UniverDocsPlugin); univer.registerPlugin(UniverDocsUIPlugin);
    univer.registerPlugin(UniverSheetsPlugin); univer.registerPlugin(UniverSheetsUIPlugin, { formulaBar: false, footer: false, clipboardConfig: { hidePasteOptions: true } });
    // The checked data engine computes values once for the command. In particular,
    // native float rounding must not overwrite authoritative decimal estimates.
    univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: true, initialFormulaComputing: CalculationMode.NO_CALCULATION }); univer.registerPlugin(UniverSheetsNumfmtPlugin);
    const api = FUniver.newAPI(univer);
    const projection = { univer, api, content: initial.content, projecting: true }; engine.current = projection;
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, structuredClone(initial.content.workbook) as unknown as IWorkbookData);
    api.getActiveWorkbook()?.setActiveSheet(initial.activeSheetId); projection.projecting = false;
    const before = api.addEvent(api.Event.BeforeCommandExecute, (event) => {
      if (projection.projecting) return;
      if (event.id === 'univer.command.undo' || event.id === 'univer.command.redo') { event.cancel = true; latest.current.onHistory(event.id.endsWith('undo') ? 'undo' : 'redo'); return; }
      // Geometry is changed only by a checked stable-ID command from our toolbar.
      if (/^sheet\.command\.(?:insert|remove|delete-(?:row|col)|move-(?:row|col)|add-sheet|copy-sheet|set-worksheet|set-worksheet-name|merge|unmerge|set-row-height|set-col-width)/.test(event.id)) event.cancel = true;
      if (latest.current.disabled && event.id.includes('.command.') && !/selection|activate|scroll|zoom/.test(event.id)) event.cancel = true;
    });
    const selectionSubscription = api.addEvent(api.Event.SelectionChanged, (event) => {
      if (projection.projecting) return;
      const range = event.selections[0];
      if (range) latest.current.onSelect({ sheetId: event.worksheet.getSheetId(), row: range.startRow, column: range.startColumn, endRow: range.endRow, endColumn: range.endColumn });
    });
    let queued = false;
    const after = api.addEvent(api.Event.CommandExecuted, (event) => {
      if (projection.projecting) return;
      const active = api.getActiveWorkbook()?.getActiveSheet(), range = active?.getActiveRange()?.getRange();
      if (active && range) latest.current.onSelect({ sheetId: active.getSheetId(), row: range.startRow, column: range.startColumn, endRow: range.endRow, endColumn: range.endColumn });
      if (!event.id.startsWith('sheet.mutation.') || queued || latest.current.disabled) return;
      queued = true;
      queueMicrotask(() => {
        queued = false; if (engine.current !== projection || projection.projecting) return;
        try {
          const saved = api.getActiveWorkbook()?.save(); if (!saved) return;
          const next = structuredClone(projection.content);
          for (const sheetId of next.workbook.sheetOrder) {
            const source = saved.sheets[sheetId]; if (!source) throw new Error('sheets.errors.structure');
            const cells: typeof next.workbook.sheets[string]['cellData'] = {};
            for (const [row, values] of Object.entries(source.cellData ?? {})) for (const [column, rawValue] of Object.entries(values ?? {})) {
              const value = rawValue as ICellData | null;
              if (!value) continue;
              const cell: TableCell = {};
              if (value.v !== undefined && value.v !== null) cell.v = value.v;
              if (value.f) cell.f = value.f;
              if (value.p) cell.p = value.p as unknown as TableCell['p'];
              if (typeof value.t === 'number' && value.t >= 1 && value.t <= 4) cell.t = value.t;
              if (value.s) cell.s = (typeof value.s === 'string' ? saved.styles?.[value.s] : value.s) as TableCell['s'];
              const old = projection.content.workbook.sheets[sheetId]!.cellData[row]?.[column];
              if (typeof old?.s === 'string' && JSON.stringify(projection.content.workbook.styles?.[old.s]) === JSON.stringify(cell.s)) cell.s = old.s;
              if (old?.f && cell.f === old.f) { if (old.v !== undefined) cell.v = old.v; else delete cell.v; if (old.t !== undefined) cell.t = old.t; else delete cell.t; }
              if (Object.keys(cell).length) (cells[row] ??= {})[column] = cell;
            }
            next.workbook.sheets[sheetId]!.cellData = cells;
          }
          const checked = requireTable(next);
          if (hashJson(checked) !== hashJson(projection.content)) { projection.content = checked; latest.current.onChange(checked); }
        } catch (error) { latest.current.onError(error); }
      });
    });
    return () => { before.dispose(); after.dispose(); selectionSubscription.dispose(); engine.current = null; univer.dispose(); };
  }, []); // One editor per mount; revisions update the projection below.
  useEffect(() => {
    const current = engine.current; if (!current) return;
    if (hashJson(current.content) !== hashJson(props.content)) {
      current.projecting = true;
      const previous = current.api.getActiveWorkbook(); const selection = previous?.getActiveSheet()?.getActiveRange()?.getRange();
      current.api.disposeUnit(current.content.workbook.id);
      current.univer.createUnit(UniverInstanceType.UNIVER_SHEET, structuredClone(props.content.workbook) as unknown as IWorkbookData);
      current.content = props.content;
      const active = current.api.getActiveWorkbook()?.setActiveSheet(props.activeSheetId);
      if (selection) active?.getRange(selection.startRow, selection.startColumn, Math.max(1, selection.endRow - selection.startRow + 1), Math.max(1, selection.endColumn - selection.startColumn + 1)).activate();
      current.projecting = false;
    } else current.api.getActiveWorkbook()?.setActiveSheet(props.activeSheetId);
  }, [props.content, props.activeSheetId]);
  useEffect(() => {
    const current = engine.current; if (!current) return;
    const active = current.api.getActiveWorkbook()?.getSheetBySheetId(props.selection.sheetId), range = active?.getActiveRange()?.getRange(), desired = props.selection;
    if (!active || range?.startRow === desired.row && range?.startColumn === desired.column && range?.endRow === desired.endRow && range?.endColumn === desired.endColumn) return;
    current.projecting = true;
    active.getRange(desired.row, desired.column, desired.endRow - desired.row + 1, desired.endColumn - desired.column + 1).activate();
    current.projecting = false;
  }, [props.selection]);
  return <div ref={host} style={{ height: '100%', minHeight: 360 }} onKeyDownCapture={(event) => {
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); latest.current.onHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'); }
  }} />;
}
