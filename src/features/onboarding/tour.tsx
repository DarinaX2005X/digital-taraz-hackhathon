'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LocateFixed, Pause, RotateCcw } from 'lucide-react';
import { useLocale } from '@/i18n/provider';
import { useIdentityAccount } from '@/features/identity/ui/identity-locale-provider';
import { Button } from '@/ui';
import { requestTour, TourRequestError } from './client';
import { TOUR_VERSION, type TourProgress, type TourStep, type UpdateTour } from './contracts';
import { tourCopy } from './copy';
import { completedThrough, previousCompletedSteps, resolveTourView, tourDismissedKey } from './state-machine';
import styles from './tour.module.css';

function useTour(ownerId: string) {
  const account = useIdentityAccount();
  const { authEpoch, isCurrent } = account;
  const [progress, setProgress] = useState<TourProgress>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const read = useCallback(async () => {
    controller.current?.abort(); controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const next = await requestTour(ownerId, undefined, signal);
      if (isCurrent(ownerId, authEpoch) && !signal.aborted) { setProgress(next); setError(false); }
    } catch { if (isCurrent(ownerId, authEpoch) && !signal.aborted) setError(true); }
  }, [ownerId, authEpoch, isCurrent]);
  useEffect(() => { void read(); return () => controller.current?.abort(); }, [read]);
  async function update(state: UpdateTour['state'], completedSteps = progress?.completedSteps ?? []) {
    if (!progress || pending || !isCurrent(ownerId, authEpoch)) return false;
    controller.current?.abort(); controller.current = new AbortController();
    const signal = controller.current.signal; setPending(true); setError(false);
    try {
      const next = await requestTour(ownerId, { version: TOUR_VERSION, expectedRevision: progress.revision, state, completedSteps }, signal);
      if (!isCurrent(ownerId, authEpoch) || signal.aborted) return false;
      setProgress(next); return true;
    } catch (failure) {
      if (isCurrent(ownerId, authEpoch) && !signal.aborted) {
        setError(true);
        if (failure instanceof TourRequestError && failure.status === 409) { setPending(false); await read(); }
      }
      return false;
    } finally { if (!signal.aborted) setPending(false); }
  }
  return { progress, pending, error, read, update, visible: account.viewer?.user.id === ownerId };
}

function readDismissed(key: string) { try { return window.localStorage.getItem(key); } catch { return null; } }
function useTourDismissal(ownerId: string) {
  const key = tourDismissedKey(ownerId);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(() => typeof window !== 'undefined' && readDismissed(key) === 'true');
  useEffect(() => { queueMicrotask(() => { setDismissed(readDismissed(key) === 'true'); setReady(true); }); }, [key]);
  const dismiss = () => { try { window.localStorage.setItem(key, 'true'); } catch { /* Local persistence is optional. */ } setDismissed(true); };
  const resume = () => { try { window.localStorage.removeItem(key); } catch { /* State still updates. */ } setDismissed(false); };
  return { ready, dismissed, dismiss, resume };
}

function useReadyAnchors(anchors: Partial<Record<TourStep, string>>) {
  const [ready, setReady] = useState<Partial<Record<TourStep, string>>>({});
  const signature = useMemo(() => JSON.stringify(anchors), [anchors]);
  useEffect(() => {
    const inspect = () => {
      const next: Partial<Record<TourStep, string>> = {};
      for (const [step, id] of Object.entries(anchors) as [TourStep, string][]) if (document.getElementById(id)) next[step] = id;
      setReady((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    inspect(); const observer = new MutationObserver(inspect); observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [signature, anchors]);
  return ready;
}

export function TourGuide({ ownerId, anchors }: { ownerId: string; anchors: Partial<Record<TourStep, string>> }) {
  const tour = useTour(ownerId); const { locale } = useLocale(); const t = tourCopy[locale];
  const dismissal = useTourDismissal(ownerId); const readyAnchors = useReadyAnchors(anchors); const [focused, setFocused] = useState<string>();
  useEffect(() => {
    if (!focused) return; const target = document.getElementById(focused); if (!target) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const temporaryTabIndex = !target.hasAttribute('tabindex'); if (temporaryTabIndex) target.setAttribute('tabindex', '-1');
    const highlightClass = styles.highlight;
    target.setAttribute('data-tour-highlight', 'true'); if (highlightClass) target.classList.add(highlightClass);
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); target.focus({ preventScroll: true });
    return () => { target.removeAttribute('data-tour-highlight'); if (highlightClass) target.classList.remove(highlightClass); if (temporaryTabIndex) target.removeAttribute('tabindex'); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [focused]);
  if (!tour.visible || !tour.progress || !dismissal.ready || dismissal.dismissed) return null;
  const view = resolveTourView(tour.progress, readyAnchors, '/');
  if (view.kind === 'hidden' || view.kind === 'resume') return null;
  const copy = view.kind === 'welcome' ? undefined : t.steps[view.step];
  const title = view.kind === 'welcome' ? t.title : copy?.title;
  const body = view.kind === 'welcome' ? t.intro : view.kind === 'unavailable' ? copy?.unavailable : copy?.body;
  async function advance(step: TourStep) {
    if (!tour.progress) return; const completed = completedThrough(tour.progress, step);
    if (await tour.update(completed.length === Object.keys(t.steps).length ? 'completed' : 'active', completed)) setFocused(undefined);
  }
  return <aside className={styles.guide} aria-label={t.title} aria-live="polite">
    <div className={styles.content}><p className={styles.progress}>{view.kind === 'welcome' ? t.optional : t.stepLabel(view.step)}</p><h2>{title}</h2><p>{body}</p>{tour.error && <p className={styles.error} role="alert">{t.error}</p>}</div>
    <div className={styles.actions}>
      {view.kind === 'welcome' && <Button variant="primary" pending={tour.pending} onClick={() => { void tour.update('active'); }}>{t.start}</Button>}
      {view.kind === 'step' && <><Button icon={LocateFixed} disabled={tour.pending} onClick={() => setFocused(view.anchorId)}>{t.show}</Button><Button variant="primary" icon={ArrowRight} pending={tour.pending} onClick={() => { void advance(view.step); }}>{t.next}</Button></>}
      {view.kind === 'unavailable' && <Button variant="primary" icon={ArrowRight} pending={tour.pending} onClick={() => { void advance(view.step); }}>{t.skipStep}</Button>}
      {view.kind !== 'welcome' && tour.progress.completedSteps.length > 0 && <Button icon={ArrowLeft} disabled={tour.pending} onClick={() => { void tour.update('active', previousCompletedSteps(tour.progress!)); }}>{t.back}</Button>}
      {view.kind !== 'welcome' && <Button variant="quiet" icon={Pause} disabled={tour.pending} onClick={dismissal.dismiss}>{t.close}</Button>}
      <Button variant="quiet" disabled={tour.pending} onClick={() => { void tour.update('skipped'); }}>{t.skip}</Button>
    </div>
  </aside>;
}

export function TourSettings({ ownerId }: { ownerId: string }) {
  const tour = useTour(ownerId); const { locale } = useLocale(); const t = tourCopy[locale]; const router = useRouter(); const dismissal = useTourDismissal(ownerId);
  if (!tour.visible) return null; const resumable = tour.progress?.state === 'active';
  async function startFromSettings(replay = false) { dismissal.resume(); if (await tour.update('active', replay ? [] : tour.progress?.completedSteps)) router.push('/app/work'); }
  return <section id="tour" tabIndex={-1} className={styles.settings} aria-labelledby="tour-title"><h2 id="tour-title">{t.title}</h2><p>{t.intro}</p>{tour.error && <p className={styles.error} role="alert">{t.error}</p>}<div className={styles.actions}>
    {tour.progress?.state === 'available' && <Button variant="primary" pending={tour.pending} onClick={() => { void startFromSettings(); }}>{t.start}</Button>}
    {resumable && <Button variant="primary" pending={tour.pending} onClick={() => { void startFromSettings(); }}>{t.resume}</Button>}
    {tour.progress && <Button icon={RotateCcw} disabled={tour.pending} onClick={() => { void startFromSettings(true); }}>{t.replay}</Button>}
    {tour.error && <Button onClick={() => { void tour.read(); }}>{t.retry}</Button>}<Button onClick={() => router.push('/app/work')}>{t.openWork}</Button>
  </div>{resumable && <p role="status">{t.saved}</p>}</section>;
}
