'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button, TextareaField } from '@/ui';
import { identityClient } from '@/features/identity/ui';
import { publicWorkDestination } from './entry';
import type { PublicCopy } from './copy';
import styles from './public-site.module.css';

const draftKey = 'tirlik.public-goal.v1';

export function StartWork({ copy, signedIn, scenarioGoal, onDraftChange }: { copy: PublicCopy; signedIn: boolean; scenarioGoal?: string; onDraftChange: (value: string) => void }) {
  const router = useRouter();
  const [goal, setGoal] = useState(''), [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false), [useScenario, setUseScenario] = useState<string>();
  const attempt = useRef<{ goal: string; key: string } | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { const saved = sessionStorage.getItem(draftKey); if (saved && saved.length <= 12000) { setGoal(saved); onDraftChange(saved); } } catch { /* Draft remains on this page when tab storage is unavailable. */ }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [onDraftChange]);
  useEffect(() => {
    if (!scenarioGoal || scenarioGoal === useScenario) return;
    const timer = setTimeout(() => {
      setGoal(scenarioGoal); setUseScenario(scenarioGoal); onDraftChange(scenarioGoal);
      try { sessionStorage.setItem(draftKey, scenarioGoal); } catch { /* The visible draft is retained. */ }
      document.getElementById('own-task')?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [scenarioGoal, useScenario, onDraftChange]);
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !goal.trim()) return;
    const draft = goal.trim();
    if (attempt.current?.goal !== draft) attempt.current = { goal: draft, key: crypto.randomUUID() };
    setPending(true); setFailed(false);
    try {
      const result = await identityClient.saveIntent({ goal: draft, returnTo: '/app/work' }, attempt.current.key);
      router.push(publicWorkDestination(signedIn, result.intentToken));
    } catch { setFailed(true); setPending(false); }
  }
  return <section id="start" className={styles.startWork} aria-labelledby="start-title">
    <div><h2 id="start-title">{copy.ownTaskTitle}</h2><p>{copy.ownTaskDescription}</p></div>
    <form onSubmit={start}>
      <TextareaField id="own-task" label={copy.ownTaskLabel} placeholder={copy.ownTaskPlaceholder} value={goal} maxLength={12000} rows={3} required disabled={pending} onChange={(event) => { setGoal(event.target.value); onDraftChange(event.target.value); try { sessionStorage.setItem(draftKey, event.target.value); } catch { /* Keep the in-memory draft. */ } }} />
      {failed && <p role="alert" className={styles.startError}>{copy.ownTaskError}</p>}
      <div className={styles.startActions}><Button type="submit" variant="primary" icon={ArrowRight} pending={pending} disabled={!ready || !goal.trim()}>{copy.ownTaskAction}</Button><p>{signedIn ? copy.ownTaskSignedIn : copy.ownTaskAccount}</p></div>
    </form>
  </section>;
}
