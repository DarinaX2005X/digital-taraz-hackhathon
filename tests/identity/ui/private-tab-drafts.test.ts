import { describe, expect, it } from 'vitest';
import { clearPrivateTabDrafts } from '@/features/identity/ui/private-tab-drafts';

describe('confirmed logout draft privacy', () => {
  it('removes only the current owner’s private workflow entries and public handoff text', () => {
    const values = new Map([
      ['tirlik.entry-draft.v1:owner:intent', 'private goal'],
      ['tirlik.task-request.v1:owner:project', 'request'],
      ['tirlik.task-selection.v1:owner:project', 'selected sources'],
      ['tirlik.project-session.v1:owner:project', 'unsaved goal'],
      ['tirlik.run-session-draft.v1:owner:run', 'question answer'],
      ['tirlik.task-request.v1:another:project', 'other'],
      ['tirlik.run-session-draft.v1:another:run', 'other answer'],
      ['tirlik.public-goal.v1', 'public input'],
      ['unrelated', 'keep'],
    ]);
    clearPrivateTabDrafts({ get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; }, removeItem(key) { values.delete(key); } }, 'owner');
    expect([...values.keys()]).toEqual(['tirlik.task-request.v1:another:project', 'tirlik.run-session-draft.v1:another:run', 'unrelated']);
  });
});
