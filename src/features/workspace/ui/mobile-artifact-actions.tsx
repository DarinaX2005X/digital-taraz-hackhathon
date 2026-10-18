'use client';

import { Children, useEffect, useId, useReducer, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui';
import styles from './workspace.module.css';

export type MobileArtifactActionsState = { open: boolean; restoreFocus: boolean };
export type MobileArtifactActionsEvent =
  | { type: 'toggle'; open: boolean }
  | { type: 'escape' }
  | { type: 'focus-restored' };

export function mobileArtifactActionsReducer(state: MobileArtifactActionsState, event: MobileArtifactActionsEvent): MobileArtifactActionsState {
  if (event.type === 'toggle') {
    if (state.open === event.open && !state.restoreFocus) return state;
    return { open: event.open, restoreFocus: false };
  }
  if (event.type === 'escape') return state.open ? { open: false, restoreFocus: true } : state;
  return state.restoreFocus ? { ...state, restoreFocus: false } : state;
}

export function restoreMobileArtifactActionsFocus(target: Pick<HTMLElement, 'focus'> | null) {
  target?.focus({ preventScroll: true });
}

export function MobileArtifactActions({ leading, status, primary, secondary, moreLabel, moreAccessibleLabel }: {
  leading?: ReactNode;
  status?: ReactNode;
  primary: ReactNode;
  secondary: ReactNode;
  moreLabel: string;
  moreAccessibleLabel: string;
}) {
  const [state, dispatch] = useReducer(mobileArtifactActionsReducer, { open: false, restoreFocus: false });
  const disclosure = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!state.restoreFocus) return;
    restoreMobileArtifactActionsFocus(disclosure.current);
    dispatch({ type: 'focus-restored' });
  }, [state.restoreFocus]);

  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || !state.open) return;
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: 'escape' });
  }

  return <div className={`${styles.actions} ${styles.artifactActions}`}>
    <div
      className={styles.mobileArtifactMore}
      data-open={state.open || undefined}
      onKeyDown={escape}
    >
      <Button ref={disclosure} className={styles.mobileArtifactMoreTrigger} icon={MoreHorizontal} aria-label={moreAccessibleLabel} aria-expanded={state.open} aria-controls={panelId} onClick={() => dispatch({ type: 'toggle', open: !state.open })}>{moreLabel}</Button>
      <div id={panelId} className={styles.mobileArtifactMorePanel} role="group" aria-label={moreAccessibleLabel}>
        {leading && <div className={styles.artifactActionLeading}>{leading}</div>}
        {Children.map(secondary, (action) => <div className={styles.artifactActionSecondary}>{action}</div>)}
      </div>
    </div>
    {status && <div className={styles.artifactActionStatus}>{status}</div>}
    <div className={styles.artifactActionPrimary}>{primary}</div>
  </div>;
}
