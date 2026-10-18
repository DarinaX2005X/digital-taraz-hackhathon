import { describe, expect, it } from 'vitest';
import type { WorkOccurrence } from '../../src/features/recurring-work/contracts';
import { emptyRule, occurrenceMutationForState } from '../../src/features/business-context/ui/business-page';
import { RunBudgetLimitSchema } from '../../src/features/runs/domain/limits';

describe('recurring occurrence actions', () => {
  it('starts a new rule within the canonical per-run budget', () => {
    expect(RunBudgetLimitSchema.safeParse(emptyRule().maximumUsd).success).toBe(true);
  });

  it('offers only mutations accepted by the service lifecycle', () => {
    const states: WorkOccurrence['state'][] = ['queued', 'running', 'waiting_input', 'paused', 'review_ready', 'completed', 'failed', 'cancelled'];
    expect(Object.fromEntries(states.map((state) => [state, occurrenceMutationForState(state)]))).toEqual({
      queued: 'cancel',
      running: 'cancel',
      waiting_input: 'cancel',
      paused: 'restart',
      review_ready: 'cancel',
      completed: null,
      failed: 'restart',
      cancelled: 'restart',
    });
  });
});
