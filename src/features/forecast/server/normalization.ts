import type { SourceRef } from '@/contracts/artifacts';
import type { ForecastInput } from '@/contracts/business-work';
import type { DatasetRecord, MaterialCell } from '@/contracts/materials';
import type { ForecastSeries } from '../contracts';

const refKey = (ref: SourceRef) => [ref.sourceId, ref.sourceVersionId, ref.revision, ref.collectionId ?? '', ref.recordId ?? '', ref.fieldId ?? '', ref.factRevision ?? ''].join('|');

export function normalizeForecastSeries(input: ForecastInput, records: DatasetRecord[], sourceRevisions: Record<string, number>) {
  const observations: ForecastSeries['observations'] = [], unresolved: { code: string; targetIds: string[]; sourceRefs: SourceRef[] }[] = [];
  const expectedSource = refKey(input.seriesRef).split('|').slice(0, 3).join('|');
  let valueKind: 'decimal' | 'money' | 'quantity' | null = null, currency: string | null = null, unit: string | null = null;
  for (const record of records) {
    const dateCell = record.cells[input.dateColumn], valueCell = record.cells[input.valueColumn];
    const refs = [dateCell, valueCell].filter((cell): cell is MaterialCell => Boolean(cell)).map((cell) => cell.sourceRef);
    const sameSelectedSource = refs.every((ref) => refKey(ref).split('|').slice(0, 3).join('|') === expectedSource);
    if (!dateCell || dateCell.value.kind !== 'date' || !valueCell || !sameSelectedSource || valueCell.reviewState === 'needs-review' || !['decimal', 'money', 'quantity'].includes(valueCell.value.kind)) {
      unresolved.push({ code: 'forecast.observation.incomplete', targetIds: [record.recordId], sourceRefs: refs }); continue;
    }
    const numeric = valueCell.value as Extract<typeof valueCell.value, { kind: 'decimal' | 'money' | 'quantity' }>;
    if (valueKind === null) {
      valueKind = numeric.kind;
      if (numeric.kind === 'money') currency = numeric.currency;
      if (numeric.kind === 'quantity') unit = numeric.unit;
    }
    const compatible = numeric.kind === valueKind && (numeric.kind !== 'money' || numeric.currency === currency) && (numeric.kind !== 'quantity' || numeric.unit === unit);
    if (!compatible) { unresolved.push({ code: 'forecast.observation.unit_mismatch', targetIds: [record.recordId], sourceRefs: refs }); continue; }
    observations.push({ id: record.recordId, date: dateCell.value.date, value: numeric.kind === 'money' ? numeric.minorUnits : numeric.decimal });
  }
  return { series: { ...input, observations, sourceRevisions }, unresolved };
}

