'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  Bold,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Download,
  Italic,
  Lock,
  LockOpen,
  PanelTop,
  Redo2,
  Rows3,
  Undo2,
} from 'lucide-react';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import type { Locale } from '@/i18n/locales';
import { Button, IconButton } from '@/ui';
import { createSheetController } from '../client/controller';
import { addressLabel, cellAt, columnLabel, columnUnit, editorCell, stableCellId } from '../domain/model';
import { changeCells, formattedCell, sheetLockCommand, sheetSettingsCommand, sheetStructureCommand, sortSheetCommand } from '../domain/commands';
import { fillDownCells, findCells, replaceCells, selectedCells, selectionStats } from '../domain/selection';
import type { GridSelection } from './univer-grid';
import { sheetCopy } from '../locales';
import { SheetCharts } from './sheet-charts';
import styles from './sheets.module.css';
const UniverGrid = dynamic(() => import('./univer-grid').then((module) => module.UniverGrid), { ssr: false });

export function SheetEditor({ session, locale, onFlushReady, onExport }: { session: ArtifactSession; locale: Locale; onFlushReady?:(flush: (() => Promise<boolean>) | null) => void; onExport?: () => void }) {
  const copy = sheetCopy[locale];
  const [controller] = useState(() => createSheetController(session, () => sheetCopy[locale].reason));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const initialSheet = state.content.workbook.sheetOrder[0]!;
  const [active, setActive] = useState(initialSheet), [rawSelection, setSelection] = useState<GridSelection>({ sheetId: initialSheet, row: 0, column: 0, endRow: 0, endColumn: 0 });
  const [formulaDraft, setFormulaDraft] = useState<{ key: string; value: string } | null>(null), [query, setQuery] = useState(''), [replacement, setReplacement] = useState(''), [filter, setFilter] = useState(''), [chartTitle, setChartTitle] = useState(''), [error, setError] = useState(''), [reset, setReset] = useState(0), [activeMatch, setActiveMatch] = useState(-1);
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => { onFlushReady?.(controller.flush); return () => onFlushReady?.(null); }, [controller, onFlushReady]);
  const content = state.content, sheet = content.workbook.sheets[active] ?? content.workbook.sheets[initialSheet]!;
  const selection = useMemo<GridSelection>(() => ({ sheetId: sheet.id, row: Math.min(sheet.rowCount - 1, Math.max(0, rawSelection.row)), column: Math.min(sheet.columnCount - 1, Math.max(0, rawSelection.column)), endRow: Math.min(sheet.rowCount - 1, Math.max(0, rawSelection.endRow)), endColumn: Math.min(sheet.columnCount - 1, Math.max(0, rawSelection.endColumn)) }), [sheet.id, sheet.rowCount, sheet.columnCount, rawSelection]);
  const disabled = !sessionState.snapshot?.permissions.edit || !sessionState.storageReady || !['ready', 'dirty', 'saving'].includes(state.phase);
  const selected = cellAt(content, selection);
  const unit = columnUnit(content, active, selection.column), locked = Boolean(sessionState.snapshot?.locks?.[stableCellId(content, selection)]);
  const formulaKey = JSON.stringify([selection.sheetId, selection.row, selection.column, selected?.f ?? selected?.v]);
  const formula = formulaDraft?.key === formulaKey ? formulaDraft.value : String(selected?.f ?? selected?.v ?? '');
  const stats = useMemo(() => { try { return selectionStats(content, selection); } catch { return { count: 0, unknown: 0, sum: 0, average: null }; } }, [content, selection]);
  const matches = useMemo(() => findCells(content, active, query), [content, active, query]);
  const filtered = useMemo(() => !filter ? [] : Object.entries(sheet.cellData).filter(([, cells]) => String(cells[selection.column]?.v ?? '').toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(([row]) => Number(row)), [sheet, selection.column, filter]);
  const binding = sessionState.snapshot?.artifact.bindings.find((item) => item.targetElementId === stableCellId(content, selection));
  const freshness = binding && sessionState.snapshot?.sourceFreshness.find((item) => item.sourceRef.sourceId === binding.sourceRef.sourceId);
  const saveState = !sessionState.snapshot?.permissions.edit ? 'readonly' : state.phase === 'ready' ? 'saved' : state.phase === 'saving' ? 'saving' : state.phase === 'failed' ? 'failed' : state.phase === 'conflict' ? 'conflict' : state.phase === 'recovery' ? 'recovery' : state.localSaved ? 'local' : 'saving';
  function failed(error?: unknown) { setError(error instanceof Error && error.message === 'sheets.errors.editRange' ? copy.editLimit : copy.error); }
  async function task(action: () => Promise<unknown> | unknown) { try { setError(''); await action(); } catch (error) { failed(error); } }
  function format(style: Record<string, JsonValue>) { return task(() => controller.change(changeCells(content, selectedCells(content, selection).map(({ address }) => ({ address, cell: formattedCell(content, address, style) }))), 'format')); }
  async function history(action: 'undo' | 'redo') {
    if (!await controller.flush()) return;
    const group = session.getSnapshot().snapshot?.history.find((item) => action === 'undo' ? item.canUndo : item.canRedo); if (!group) return;
    const prepared = await session.prepareHistory(action, group.commandGroupId);
    // Multi-artifact history is reviewed in the shared history panel.
    if (prepared.group.artifacts.length > 1 || prepared.group.hasUnavailableArtifacts) { setError(copy.conflict); return; }
    await session.run(prepared.operation);
  }
  function structure(axis: 'row' | 'column', action: 'insert' | 'remove') {
    return task(() => controller.command((base) => sheetStructureCommand(base, active, axis, action, axis === 'row' ? selection.row : selection.column, action === 'insert' ? axis === 'row' ? selection.row : selection.column : null, copy.reason)));
  }
  function select(sheetId: string, row = 0, column = 0) { setActive(sheetId); setSelection({ sheetId, row, column, endRow: row, endColumn: column }); }
  function selectMatch(offset: number) {
    if (!matches.length) return;
    const index = activeMatch < 0 ? offset < 0 ? matches.length - 1 : 0 : (activeMatch + offset + matches.length) % matches.length;
    const match = matches[index]!;
    setActiveMatch(index);
    select(match.sheetId, match.row, match.column);
  }
  function settings(value: Record<string, JsonValue>) { return task(() => controller.command((base) => sheetSettingsCommand(base, active, value, copy.reason))); }
  function merge(remove: boolean) {
    const ranges = sheet.mergeData ?? [], selectedRange = { startRow: selection.row, endRow: selection.endRow, startColumn: selection.column, endColumn: selection.endColumn };
    const overlaps = (item: typeof selectedRange) => item.startRow <= selectedRange.endRow && item.endRow >= selectedRange.startRow && item.startColumn <= selectedRange.endColumn && item.endColumn >= selectedRange.startColumn;
    return settings({ mergeData: [...ranges.filter((item) => !overlaps(item)), ...remove ? [] : [selectedRange]] });
  }
  function setUnit(value: JsonValue) { return settings({ columnData: { ...sheet.columnData, [selection.column]: { ...sheet.columnData?.[selection.column], tirlikUnit: value } } }); }
  function chart() { return task(() => {
    if (selection.endColumn <= selection.column || selection.endColumn - selection.column > 8 || selection.endRow - selection.row >= 500) throw new Error('range');
    const ids = content.stableIds[active]!;
    const item = { id: crypto.randomUUID(), title: chartTitle.trim() || `${sheet.name} · ${addressLabel(selection)}`, type: 'bar' as const, labelColumnId: ids.columns[selection.column]!, valueColumnIds: ids.columns.slice(selection.column + 1, selection.endColumn + 1), rowIds: ids.rows.slice(selection.row, selection.endRow + 1) };
    return controller.command((base) => sheetSettingsCommand(base, active, { charts: [...sheet.charts ?? [], item] }, copy.reason));
  }); }
  if (state.phase === 'hidden' || sessionState.phase !== 'ready') return null;
  return <section className={styles.editor} aria-label={copy.editor}>
    <div className={styles.toolbar} role="toolbar" aria-label={copy.tools}>
      <div className={styles.toolGroup}>
        <IconButton icon={Undo2} label={copy.undo} disabled={disabled} onClick={() => void task(() => history('undo'))} />
        <IconButton icon={Redo2} label={copy.redo} disabled={disabled} onClick={() => void task(() => history('redo'))} />
      </div>
      <div className={styles.toolGroup}>
        <IconButton icon={Bold} label={copy.bold} disabled={disabled} onClick={() => void format({ bl: 1 })} />
        <IconButton icon={Italic} label={copy.italic} disabled={disabled} onClick={() => void format({ it: 1 })} />
        <Button variant="quiet" disabled={disabled || selection.endRow === selection.row} onClick={() => void task(() => controller.change(changeCells(content, fillDownCells(content, selection)), 'paste'))}>{copy.fillDown}</Button>
      </div>
      <div className={styles.toolGroup}>
        <Button variant="quiet" disabled={disabled} onClick={() => void merge(false)}>{copy.merge}</Button>
        <Button variant="quiet" disabled={disabled} onClick={() => void merge(true)}>{copy.unmerge}</Button>
        <select aria-label={copy.number} disabled={disabled} value="" onChange={(event) => void format({ n: { pattern: event.target.value } })}><option value="" disabled>{copy.number}</option><option value="0.00">{copy.number}</option><option value={'#,##0.00 "₸"'}>{copy.money}</option><option value="0.00%">{copy.percent}</option><option value="@">{copy.text}</option></select>
      </div>
      <div className={styles.toolGroup}>
        <details onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary><Rows3 size={17} aria-hidden="true" />{copy.row} / {copy.column}</summary><div className={styles.menu}><Button variant="quiet" disabled={disabled} onClick={() => void structure('row', 'insert')}>{copy.addRow}</Button><Button variant="quiet" disabled={disabled} onClick={() => void structure('row', 'remove')}>{copy.removeRow}</Button><Button variant="quiet" disabled={disabled} onClick={() => void structure('column', 'insert')}>{copy.addColumn}</Button><Button variant="quiet" disabled={disabled} onClick={() => void structure('column', 'remove')}>{copy.removeColumn}</Button></div></details>
        <Button variant="quiet" icon={PanelTop} disabled={disabled} onClick={() => void task(() => controller.command((base) => sheetSettingsCommand(base, active, { freeze: sheet.freeze ? null : { xSplit: selection.column, ySplit: selection.row, startRow: selection.row - 1, startColumn: selection.column - 1 } }, copy.reason)))}>{sheet.freeze ? copy.unfreeze : copy.freeze}</Button>
        <IconButton icon={ArrowDownAZ} label={copy.sortAsc} disabled={disabled} onClick={() => void task(() => controller.command((base) => sortSheetCommand(base, active, selection.column, false, copy.reason)))} />
        <IconButton icon={ArrowDownZA} label={copy.sortDesc} disabled={disabled} onClick={() => void task(() => controller.command((base) => sortSheetCommand(base, active, selection.column, true, copy.reason)))} />
      </div>
      {onExport && <Button className={styles.exportAction} icon={Download} onClick={() => void task(async () => { if (await controller.flush()) onExport(); })}>{copy.export}</Button>}
    </div>
    <form className={styles.formula} onSubmit={(event) => { event.preventDefault(); void task(() => controller.change(changeCells(content, [{ address: selection, cell: editorCell(formula, selected) }]), 'format')); }}><output>{addressLabel(selection)}</output><span aria-hidden="true">ƒx</span><input aria-label={copy.formula} disabled={disabled} value={formula} onChange={(event) => setFormulaDraft({ key: formulaKey, value: event.target.value })} /><Button type="submit" variant="primary" disabled={disabled}>{copy.apply}</Button></form>
    <div className={styles.workbench}><div className={styles.canvas}>
      {!filter ? <UniverGrid key={reset} content={content} activeSheetId={active} selection={selection} disabled={disabled} onChange={(next) => { if (!controller.change(next)) setReset((value) => value + 1); }} onSelect={(next) => setSelection((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)} onHistory={(action) => void task(() => history(action))} onError={() => { failed(); setReset((value) => value + 1); }} /> : <div className={styles.previewTable}><p>{copy.matches}: {filtered.length}</p><table><tbody>{filtered.slice(0, 200).map((row) => <tr key={row}><th>{row + 1}</th>{Array.from({ length: Math.min(sheet.columnCount, 12) }, (_, column) => <td key={column}><button type="button" onClick={() => select(active, row, column)}>{String(sheet.cellData[row]?.[column]?.v ?? '—')}</button></td>)}</tr>)}</tbody></table></div>}
    </div><aside className={styles.inspector}>
      <section className={styles.inspectorSection}><label>{copy.find}<input value={query} onChange={(event) => { setQuery(event.target.value); setActiveMatch(-1); }} /></label><div className={styles.findStatus}><p>{query ? `${copy.matches}: ${matches.length}` : copy.noMatches}</p><span><IconButton icon={ChevronLeft} label={copy.findPrevious} disabled={!matches.length} onClick={() => selectMatch(-1)} /><IconButton icon={ChevronRight} label={copy.findNext} disabled={!matches.length} onClick={() => selectMatch(1)} /></span></div><label>{copy.replacement}<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><Button variant="quiet" disabled={disabled || !matches.length} onClick={() => void task(() => controller.change(changeCells(content, replaceCells(content, active, query, replacement).map((match) => ({ address: match, cell: editorCell(match.value, match.cell) }))), 'format'))}>{copy.replace}</Button></section>
      <section className={styles.inspectorSection}><label>{copy.filter} · {columnLabel(selection.column)}<input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>{filter && <Button variant="quiet" onClick={() => setFilter('')}>{copy.clearFilter}</Button>}</section>
      <section className={`${styles.inspectorSection} ${styles.cellDetail}`}><strong>{copy.selection}: {addressLabel(selection)}</strong><div><label>{copy.row}<input type="number" min="1" max={sheet.rowCount} value={selection.row + 1} onChange={(event) => { const row = Number(event.target.value) - 1; if (row >= 0 && row < sheet.rowCount) select(active, row, selection.column); }} /></label><label>{copy.column}<input type="number" min="1" max={sheet.columnCount} value={selection.column + 1} onChange={(event) => { const column = Number(event.target.value) - 1; if (column >= 0 && column < sheet.columnCount) select(active, selection.row, column); }} /></label></div></section>
      <section className={`${styles.inspectorSection} ${styles.sourceCard}`} data-state={binding?.override ? 'override' : binding ? freshness?.status ?? 'unknown' : 'manual'}><strong>{copy.source}</strong><p>{binding ? binding.override ? copy.sourceOverride : freshness?.status === 'current' ? copy.sourceCurrent : freshness?.status === 'stale' ? copy.sourceStale : copy.sourceMissing : copy.manual}</p>{binding && <><span className={styles.sourceRevision}>{copy.sourceRevision} {binding.sourceRef.revision}</span><a href={`/app/materials/sources/${binding.sourceRef.sourceId}?${new URLSearchParams({ workspaceId: sessionState.snapshot!.viewer.workspaceId, sourceVersionId: binding.sourceRef.sourceVersionId })}`}>{copy.openSource}</a></>}</section>
      <section className={styles.inspectorSection}><div className={styles.twoColumns}><label>{copy.width}<input key={`w:${active}:${selection.column}:${sheet.columnData?.[selection.column]?.w}`} type="number" min="24" max="2000" disabled={disabled} defaultValue={Number(sheet.columnData?.[selection.column]?.w ?? 120)} onBlur={(event) => { const value = Number(event.target.value); if (value >= 24 && value <= 2000) void settings({ columnData: { ...sheet.columnData, [selection.column]: { ...sheet.columnData?.[selection.column], w: value } } }); }} /></label><label>{copy.height}<input key={`h:${active}:${selection.row}:${sheet.rowData?.[selection.row]?.h}`} type="number" min="20" max="600" disabled={disabled} defaultValue={Number(sheet.rowData?.[selection.row]?.h ?? 24)} onBlur={(event) => { const value = Number(event.target.value); if (value >= 20 && value <= 600) void settings({ rowData: { ...sheet.rowData, [selection.row]: { ...sheet.rowData?.[selection.row], h: value } } }); }} /></label></div></section>
      <section className={styles.inspectorSection}><label>{copy.unit}<select value={unit?.kind ?? 'number'} disabled={disabled} onChange={(event) => { const kind = event.target.value; void setUnit(kind === 'money' ? { kind, currency: 'KZT' } : kind === 'quantity' ? { kind, unit: 'pcs' } : { kind }); }}><option value="number">{copy.number}</option><option value="money">{copy.money}</option><option value="quantity">{copy.quantity}</option><option value="text">{copy.text}</option><option value="date">YYYY-MM-DD</option></select></label>{unit?.kind === 'quantity' && <label>{copy.unitName}<input key={`${active}:${selection.column}:unit:${unit.unit}`} disabled={disabled} defaultValue={unit.unit} maxLength={40} onBlur={(event) => { if (event.target.value.trim()) void setUnit({ kind: 'quantity', unit: event.target.value.trim() }); }} /></label>}{unit?.kind === 'money' && <input aria-label={copy.unit} key={`${active}:${selection.column}:currency:${unit.currency}`} disabled={disabled} defaultValue={unit.currency} maxLength={3} onBlur={(event) => { const currency = event.target.value.toUpperCase(); if (/^[A-Z]{3}$/.test(currency)) void setUnit({ ...unit, currency }); }} />}<Button variant="quiet" icon={locked ? LockOpen : Lock} disabled={disabled} onClick={() => void task(() => controller.command((base) => sheetLockCommand(base, selection, !locked, copy.lockReason)))}>{locked ? copy.unlock : copy.lock}</Button></section>
      <details className={styles.formulaHelp}><summary>{copy.formula}</summary><p>{copy.formulaHelp}</p></details>
      <section className={styles.inspectorSection}><label>{copy.chartTitle}<input value={chartTitle} onChange={(event) => setChartTitle(event.target.value)} /></label><Button variant="quiet" icon={ChartColumn} disabled={disabled} onClick={() => void chart()}>{copy.chart}</Button><p>{copy.chartRange}</p></section>
    </aside></div>
    <div className={styles.footer}><nav aria-label={copy.editor}>{content.workbook.sheetOrder.map((id) => <button type="button" key={id} aria-current={id === active ? 'page' : undefined} onClick={() => select(id)}>{content.workbook.sheets[id]!.name}</button>)}</nav><div className={styles.selectionStats}><span>{copy.sum}: <strong>{stats.sum.toLocaleString(locale)}</strong></span><span>{copy.average}: <strong>{stats.average?.toLocaleString(locale) ?? '—'}</strong></span><span>{copy.count}: <strong>{stats.count}</strong></span><span>{copy.unknown}: <strong>{stats.unknown}</strong></span></div>{saveState !== 'saved' && <output className={styles.saveState} data-state={saveState} aria-live="polite">{saveState === 'readonly' ? copy.readOnly : saveState === 'local' ? copy.local : saveState === 'failed' ? copy.failed : saveState === 'conflict' ? copy.conflict : saveState === 'recovery' ? copy.recovery : copy.saving}</output>}</div>
    {['conflict', 'recovery', 'failed'].includes(state.phase) && <p className={styles.notice} role="status">{copy[state.phase as 'conflict' | 'recovery' | 'failed']}{state.phase === 'failed' && <button onClick={() => void task(controller.retry)}>{copy.retry}</button>}</p>}
    {error && <p className={styles.notice} role="alert">{error}</p>}
    <SheetCharts content={content} sheetId={active} locale={locale} disabled={disabled} onRemove={(id) => void task(() => controller.command((base) => sheetSettingsCommand(base, active, { charts: (sheet.charts ?? []).filter((chart) => chart.id !== id) }, copy.reason)))} />
  </section>;
}


