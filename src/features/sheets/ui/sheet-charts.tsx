'use client';
import type { Locale } from '@/i18n/locales';
import type { TableContent } from '../domain/model';
import { sheetCopy } from '../locales';
import styles from './sheets.module.css';
export function SheetCharts({ content, sheetId, locale, disabled, onRemove }: { content: TableContent; sheetId: string; locale: Locale; disabled: boolean; onRemove(id: string): void }) {
  const sheet = content.workbook.sheets[sheetId]!, ids = content.stableIds[sheetId]!, copy = sheetCopy[locale];
  return <>{(sheet.charts ?? []).map((chart) => {
    const labelColumn = ids.columns.indexOf(chart.labelColumnId), columns = chart.valueColumnIds.map((id) => ids.columns.indexOf(id)), rows = chart.rowIds.map((id) => ids.rows.indexOf(id));
    const missing = labelColumn < 0 || columns.includes(-1) || rows.includes(-1);
    const data = missing ? [] : rows.map((row) => ({ label: String(sheet.cellData[row]?.[labelColumn]?.v ?? ''), values: columns.map((column) => { const value = sheet.cellData[row]?.[column]?.v; return typeof value === 'number' && Number.isFinite(value) ? value : null; }) }));
    const numbers = data.flatMap((item) => item.values.filter((value): value is number => value !== null));
    const min = Math.min(0, ...numbers), max = Math.max(0, ...numbers), span = max - min || 1;
    const x = (index: number) => 40 + index * 620 / Math.max(1, rows.length), y = (value: number) => 220 - (value - min) / span * 190;
    return <figure key={chart.id} className={styles.chart}><figcaption><strong>{chart.title}</strong><button type="button" disabled={disabled} onClick={() => onRemove(chart.id)}>{copy.removeChart}</button></figcaption>
      {missing ? <p role="status">{copy.chartUnavailable}</p> : <><svg viewBox="0 0 700 260" role="img" aria-label={chart.title}><line x1="38" x2="670" y1={y(0)} y2={y(0)} stroke="currentColor" opacity=".3" />
        {columns.map((_, series) => chart.type === 'line' ? <g key={series}>{data.map((item, index) => { const value = item.values[series], prior = data[index - 1]?.values[series]; return typeof value === 'number' && typeof prior === 'number' ? <line key={index} x1={x(index - 1)} y1={y(prior)} x2={x(index)} y2={y(value)} stroke={['#3D6847', '#B06B3B', '#496F90', '#905F86'][series % 4]} strokeWidth="2" /> : null; })}</g> : <g key={series}>{data.map((item, index) => { const value = item.values[series]; return value === null || value === undefined ? null : <rect key={index} x={x(index) + series * 500 / Math.max(1, rows.length * columns.length)} y={Math.min(y(0), y(value))} width={Math.max(1, 480 / Math.max(1, rows.length * columns.length))} height={Math.max(1, Math.abs(y(0) - y(value)))} fill={['#3D6847', '#B06B3B', '#496F90', '#905F86'][series % 4]}><title>{item.label}: {value}</title></rect>; })}</g>)}
        {data.filter((_, index) => index % Math.max(1, Math.ceil(rows.length / 8)) === 0).map((item) => <text key={item.label + data.indexOf(item)} x={x(data.indexOf(item))} y="248" fontSize="10" fill="currentColor">{item.label.slice(0, 16)}</text>)}
      </svg><details><summary>{copy.source}</summary><div className={styles.previewTable}><table><tbody>{data.map((item, index) => <tr key={index}><th>{item.label}</th>{item.values.map((value, c) => <td key={c}>{value ?? '—'}</td>)}</tr>)}</tbody></table></div></details></>}
    </figure>;
  })}</>;
}
