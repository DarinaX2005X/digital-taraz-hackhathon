'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, LocateFixed, RotateCcw } from 'lucide-react';
import { useLocale } from '@/i18n/provider';
import { useIdentityAccount } from '@/features/identity/ui';
import { Button } from '@/ui';
import { requestTour, TourRequestError } from './client';
import { TOUR_VERSION, TourStepSchema, type TourProgress, type TourStep, type UpdateTour } from './contracts';
import { tourCopy } from './copy';
import styles from './tour.module.css';

function useTour(ownerId: string) {
  const account = useIdentityAccount(), { authEpoch, isCurrent } = account;
  const [progress, setProgress] = useState<TourProgress>(), [pending, setPending] = useState(false), [error, setError] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const read = useCallback(async () => {
    controller.current?.abort(); controller.current = new AbortController();
    const signal = controller.current.signal;
    try { const next = await requestTour(ownerId, undefined, signal); if (isCurrent(ownerId, authEpoch) && !signal.aborted) { setProgress(next); setError(false); } }
    catch { if (isCurrent(ownerId, authEpoch) && !signal.aborted) setError(true); }
  }, [ownerId, authEpoch, isCurrent]);
  useEffect(() => { void read(); return () => controller.current?.abort(); }, [read]);
  async function update(state: UpdateTour['state'], completedSteps = progress?.completedSteps ?? []) {
    if (!progress || pending || !isCurrent(ownerId, authEpoch)) return;
    controller.current?.abort(); controller.current = new AbortController();
    const signal = controller.current.signal;
    setPending(true); setError(false);
    try {
      const next = await requestTour(ownerId, { version: TOUR_VERSION, expectedRevision: progress.revision, state, completedSteps }, signal);
      if (isCurrent(ownerId, authEpoch) && !signal.aborted) setProgress(next);
    } catch (failure) {
      if (isCurrent(ownerId, authEpoch) && !signal.aborted) { setError(true); if (failure instanceof TourRequestError && failure.status === 409) { setPending(false); await read(); } }
    } finally { if (!signal.aborted) setPending(false); }
  }
  return { progress, pending, error, read, update, visible: account.viewer?.user.id === ownerId };
}

export function TourGuide({ ownerId, anchors }: { ownerId: string; anchors: Partial<Record<TourStep, string>> }) {
  const tour = useTour(ownerId), { locale } = useLocale(), t = tourCopy[locale];
  const [focused, setFocused] = useState<string>();
  useEffect(() => {
    if (!focused) return;
    const target = document.getElementById(focused);
    const highlight = styles.highlight;
    if (!target || !highlight) return;
    target.classList.add(highlight); target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); target.focus({ preventScroll: true });
    return () => target.classList.remove(highlight);
  }, [focused]);
  if (!tour.visible || !tour.progress || ['skipped', 'completed'].includes(tour.progress.state)) return null;
  const current = TourStepSchema.options.find((step) => anchors[step] && !tour.progress!.completedSteps.includes(step));
  async function next() {
    if (!current || !tour.progress) return;
    const completed = [...new Set([...tour.progress.completedSteps, current])];
    await tour.update(completed.length === TourStepSchema.options.length ? 'completed' : 'active', completed);
    setFocused(undefined);
  }
  return <aside className={styles.guide} aria-label={t.title}>
    <div><h2>{tour.progress.state === 'available' ? t.title : current ? t.steps[current].title : t.title}</h2><p>{tour.progress.state === 'available' ? t.intro : current ? t.steps[current].body : t.continue}</p>{tour.error && <p role="alert">{t.error}</p>}</div>
    <div className={styles.actions}>
      {tour.progress.state === 'available' ? <Button variant="primary" pending={tour.pending} onClick={() => { void tour.update('active'); }}>{t.start}</Button> : current && <><Button icon={LocateFixed} disabled={tour.pending} onClick={() => setFocused(anchors[current])}>{t.show}</Button><Button icon={ArrowRight} pending={tour.pending} onClick={() => { void next(); }}>{t.next}</Button></>}
      <Button variant="quiet" disabled={tour.pending} onClick={() => { void tour.update('skipped'); }}>{t.skip}</Button>
      {!current && <Link href="/settings#tour">{t.settings}</Link>}
    </div>
  </aside>;
}

export function TourSettings({ ownerId }: { ownerId: string }) {
  const tour = useTour(ownerId), { locale } = useLocale(), t = tourCopy[locale];
  if (!tour.visible) return null;
  return <section id="tour" tabIndex={-1} className={styles.settings} aria-labelledby="tour-title">
    <h2 id="tour-title">{t.title}</h2><p>{t.intro}</p>
    {tour.error && <p role="alert">{t.error}</p>}
    <div className={styles.actions}>
      {tour.progress && <><Button variant="primary" pending={tour.pending} onClick={() => { void tour.update('active'); }}>{t.resume}</Button><Button icon={RotateCcw} disabled={tour.pending} onClick={() => { void tour.update('active', []); }}>{t.replay}</Button></>}
      {tour.error && <Button onClick={() => { void tour.read(); }}>{t.retry}</Button>}
      <Link className="tl-button tl-button--secondary" href="/app/work">{t.start}</Link>
    </div>
    {tour.progress?.state === 'active' && <p role="status">{t.saved}</p>}
  </section>;
}
