import { z } from 'zod';
import { ForecastInputSchema } from '@/contracts/business-work';
import { RevisionVectorSchema } from '@/contracts/commands';
import { CalendarDateSchema, ElementIdSchema } from '@/contracts/primitives';

export const ForecastObservationSchema = z.strictObject({
  id: ElementIdSchema,
  date: CalendarDateSchema,
  value: z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/),
});

/** Normalized, reviewed observations supplied to the deterministic forecast engine. */
export const ForecastSeriesSchema = ForecastInputSchema.extend({
  observations: z.array(ForecastObservationSchema).max(100_000),
  sourceRevisions: RevisionVectorSchema,
}).superRefine((series, context) => {
  if (new Set(series.observations.map((item) => item.id)).size !== series.observations.length) {
    context.addIssue({ code: 'custom', path: ['observations'], message: 'forecast.errors.duplicateObservation' });
  }
});

export type ForecastSeries = z.infer<typeof ForecastSeriesSchema>;

