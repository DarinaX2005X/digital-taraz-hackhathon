import { describe, expect, it } from 'vitest';
import { mobileArtifactActionsReducer, restoreMobileArtifactActionsFocus, type MobileArtifactActionsState } from '../../src/features/workspace/ui/mobile-artifact-actions';

const closed: MobileArtifactActionsState = { open: false, restoreFocus: false };

describe('mobile artifact actions disclosure', () => {
  it('tracks the native disclosure state without requesting a focus move', () => {
    expect(mobileArtifactActionsReducer(closed, { type: 'toggle', open: true })).toEqual({ open: true, restoreFocus: false });
    expect(mobileArtifactActionsReducer({ open: true, restoreFocus: false }, { type: 'toggle', open: false })).toEqual(closed);
  });

  it('closes on Escape and requests focus restoration exactly once', () => {
    const escaped = mobileArtifactActionsReducer({ open: true, restoreFocus: false }, { type: 'escape' });
    expect(escaped).toEqual({ open: false, restoreFocus: true });
    expect(mobileArtifactActionsReducer(escaped, { type: 'focus-restored' })).toEqual(closed);
    expect(mobileArtifactActionsReducer(closed, { type: 'escape' })).toBe(closed);
  });

  it('restores focus without scrolling the editor away from its current position', () => {
    let options: FocusOptions | undefined;
    restoreMobileArtifactActionsFocus({ focus: (received) => { options = received; } });
    expect(options).toEqual({ preventScroll: true });
  });
});
