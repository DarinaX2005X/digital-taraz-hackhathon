import { describe, expect, it } from 'vitest';
import { emptyTour, TOUR_VERSION, TourStepSchema, UpdateTourSchema } from '@/features/onboarding/contracts';
import { tourCopy } from '@/features/onboarding/copy';

describe('optional tour contract', () => {
  it('requires every real step to finish and rejects duplicate completion', () => {
    expect(emptyTour()).toMatchObject({ revision: 0, state: 'available', completedSteps: [] });
    expect(UpdateTourSchema.safeParse({ version: TOUR_VERSION, expectedRevision: 0, state: 'completed', completedSteps: ['start'] }).success).toBe(false);
    expect(UpdateTourSchema.safeParse({ version: TOUR_VERSION, expectedRevision: 0, state: 'active', completedSteps: ['start', 'start'] }).success).toBe(false);
    expect(UpdateTourSchema.safeParse({ version: TOUR_VERSION, expectedRevision: 0, state: 'active', completedSteps: ['start', 'materials'] }).success).toBe(true);
    expect(UpdateTourSchema.safeParse({ version: TOUR_VERSION, expectedRevision: 0, state: 'active', completedSteps: ['materials', 'start'] }).success).toBe(false);
    expect(UpdateTourSchema.safeParse({ version: TOUR_VERSION, expectedRevision: 4, state: 'completed', completedSteps: TourStepSchema.options }).success).toBe(true);
  });
  it('covers the same actual steps in all locales', () => {
    for (const copy of Object.values(tourCopy)) {
      expect(Object.keys(copy.steps)).toEqual(TourStepSchema.options);
      for (const step of Object.values(copy.steps)) { expect(step.title.trim()).toBeTruthy(); expect(step.body.trim()).toBeTruthy(); expect(step).not.toHaveProperty('unavailable'); }
    }
  });
});
