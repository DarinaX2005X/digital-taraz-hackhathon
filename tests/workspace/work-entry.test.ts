import { describe, expect, it } from 'vitest';
import { initialWorkspaceSelection, restoreEntryGoal, workEntryHref } from '../../src/features/workspace/domain/work-entry';
import { safeReturnTo } from '../../src/features/identity/domain/return-to';

const workspace = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);

describe('first-work intent and workspace recovery', () => {
  it('keeps the opaque intent when selecting a workspace and passing through authentication', () => {
    const destination = workEntryHref(workspace, token);
    expect(Object.fromEntries(new URL(safeReturnTo(destination), 'https://tirlik.invalid').searchParams)).toEqual({ workspace, intent: token });
    expect(new URL(destination, 'https://tirlik.invalid').searchParams.get('intent')).toBe(token);
    expect(workEntryHref(other, token)).toContain(`intent=${token}`);
    expect(workEntryHref(workspace)).not.toContain('intent');
  });
  it('restores the entered goal but does not erase edits with a delayed response', () => {
    const original = 'Смета на 20 стульев, доставка 18 октября';
    const restored = restoreEntryGoal('', original);
    expect(restoreEntryGoal(restored, 'old reply')).toBe(original);
    expect(restoreEntryGoal('Теперь 24 стула', original)).toBe('Теперь 24 стула');
  });
  it('chooses a sole membership, requires choice for several, and does not substitute an inaccessible requested one', () => {
    expect(initialWorkspaceSelection([])).toBe('');
    expect(initialWorkspaceSelection([workspace])).toBe(workspace);
    expect(initialWorkspaceSelection([workspace, other])).toBe('');
    expect(initialWorkspaceSelection([workspace, other], other)).toBe(other);
    expect(initialWorkspaceSelection([workspace], other)).toBe(other);
  });
});
