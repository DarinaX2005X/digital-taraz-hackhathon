import { describe, expect, it, vi } from 'vitest';
import { escapeBelongsToNestedDialog, fullscreenTabDestination } from '@/features/workspace/ui/editor-fullscreen';

describe('expanded editor keyboard ownership', () => {
  it('lets Escape from an editor control exit the expanded editor', () => {
    const editorRoot = {};
    const control = { closest: vi.fn(() => editorRoot) };

    expect(escapeBelongsToNestedDialog(control, editorRoot)).toBe(false);
    expect(control.closest).toHaveBeenCalledWith('[role="dialog"]');
  });

  it('leaves Escape inside a nested dialog to that dialog', () => {
    const editorRoot = {}, nestedDialog = {};
    const dialogControl = { closest: vi.fn(() => nestedDialog) };

    expect(escapeBelongsToNestedDialog(dialogControl, editorRoot)).toBe(true);
  });

  it('does not treat a non-element event target as a nested dialog', () => {
    expect(escapeBelongsToNestedDialog(null, {})).toBe(false);
    expect(escapeBelongsToNestedDialog({}, {})).toBe(false);
  });

  it('wraps Tab when focus starts on the editor root or outside it', () => {
    const root = {}, first = {}, middle = {}, last = {}, outside = {};
    const isInside = (candidate: object) => [first, middle, last].includes(candidate);

    expect(fullscreenTabDestination(root, root, first, last, true, isInside)).toBe(last);
    expect(fullscreenTabDestination(root, root, first, last, false, isInside)).toBe(first);
    expect(fullscreenTabDestination(outside, root, first, last, true, isInside)).toBe(last);
    expect(fullscreenTabDestination(outside, root, first, last, false, isInside)).toBe(first);
  });

  it('wraps focus at the ends and leaves an interior control alone', () => {
    const root = {}, first = {}, middle = {}, last = {};
    const isInside = (candidate: object) => [first, middle, last].includes(candidate);

    expect(fullscreenTabDestination(first, root, first, last, true, isInside)).toBe(last);
    expect(fullscreenTabDestination(last, root, first, last, false, isInside)).toBe(first);
    expect(fullscreenTabDestination(middle, root, first, last, false, isInside)).toBeUndefined();
  });
});
