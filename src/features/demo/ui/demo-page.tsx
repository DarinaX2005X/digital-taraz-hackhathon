'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, GitCompareArrows, RefreshCw, Save, Undo2 } from 'lucide-react';
import type { ChangeSet } from '@/contracts/dependencies';
import { LocaleProvider } from '@/i18n/provider';
import type { Locale } from '@/i18n/locales';
import { Button, Dialog, LocaleSelect, ProductHeader } from '@/ui';
import { identityClient } from '@/features/identity/ui';
import { publicWorkDestination } from '@/features/public-site/entry';
import { useIdentityAccount } from '@/features/identity/ui/identity-locale-provider';
import { createArtifactSession, type ArtifactSession } from '@/features/artifacts/client/session';
import { artifactDraft, selectableGroups } from '@/features/dependencies/domain/proposal';
import { ChangePreview } from '@/features/change-review';
import { createDemoSeed } from '../domain/sample';
import { createDemoStore, demoArtifact, DemoConflict, type DemoStore } from '../domain/store';
import { demoCopy } from '../locales';
import styles from './demo.module.css';

const DocumentEditor = dynamic(() => import('@/features/documents/ui/document-editor').then((module) => module.DocumentEditor), { ssr: false });
const SheetEditor = dynamic(() => import('@/features/sheets/ui').then((module) => module.SheetEditor), { ssr: false });
interface Ready { store: DemoStore; document: ArtifactSession; table: ArtifactSession }
export function DemoPage({ locale }: { locale: Locale }) { return <LocaleProvider initialLocale={locale}><DemoContent locale={locale} /></LocaleProvider>; }
function DemoContent({ locale }: { locale: Locale }) {
  const t = demoCopy[locale], router = useRouter(), account = useIdentityAccount();
  const [ready, setReady] = useState<Ready>(), [boot, setBoot] = useState(0), [tab, setTab] = useState<'document' | 'table'>('document'), [price, setPrice] = useState('2500'), [busy, setBusy] = useState(false), [message, setMessage] = useState<string>(), [error, setError] = useState(false), [reviewOpen, setReviewOpen] = useState(false), [resetOpen, setResetOpen] = useState(false), [changeset, setChangeset] = useState<ChangeSet>(), [selected, setSelected] = useState<string[]>([]), [lastGroup, setLastGroup] = useState<string>();
  const flushDocument = useRef<(() => Promise<boolean>) | null>(null), flushTable = useRef<(() => Promise<boolean>) | null>(null), ownAttempt = useRef<string | null>(null);
  const registerDocument = useCallback((flush: (() => Promise<boolean>) | null) => { flushDocument.current = flush; }, []), registerTable = useCallback((flush: () => Promise<boolean>) => { flushTable.current = flush; }, []);
  const storageKey = `tirlik-workshop-example-v1:${locale}`;
  useEffect(() => {
    let disposed = false, instance: Ready | undefined;
    const timer = setTimeout(async () => {
      try {
        const saved = localStorage.getItem(storageKey), store = createDemoStore(createDemoSeed(locale), { saved, persist: (value) => localStorage.setItem(storageKey, value) });
        const session = (id: string) => createArtifactSession({ initial: store.snapshot(id), client: store.client, cache: { databaseName: `tirlik-example-${store.seed.snapshots[0]!.viewer.workspaceId}-${id}` }, isIdentityCurrent: () => !disposed });
        instance = { store, document: session(store.seed.documentId), table: session(store.seed.tableId) };
        await Promise.all([instance.document.initialize(), instance.table.initialize()]);
        if (disposed) { instance.document.dispose(); instance.table.dispose(); return; }
        if (!instance.document.getSnapshot().storageReady || !instance.table.getSnapshot().storageReady) throw new Error('example-storage-unavailable');
        setReady(instance); setError(false); setMessage(saved ? t.saved : undefined);
        const target = await artifactDraft(demoArtifact(store.snapshot(store.seed.tableId))).target(store.seed.priceTargetId);
        setPrice(String((target?.value as { v?: unknown })?.v ?? 2500));
      } catch { if (!disposed) { setMessage(t.storageError); setError(true); } }
    }, 0);
    return () => { disposed = true; clearTimeout(timer); instance?.document.dispose(); instance?.table.dispose(); flushDocument.current = null; flushTable.current = null; };
  }, [locale, storageKey, boot, t.saved, t.storageError]);
  async function flush() {
    if (!ready) return false;
    if (flushDocument.current && !await flushDocument.current()) return false;
    if (flushTable.current && !await flushTable.current()) return false;
    return await ready.document.flush() && await ready.table.flush();
  }
  async function refresh() { if (ready) await Promise.all([ready.document.refresh(), ready.table.refresh()]); }
  async function action(run: () => Promise<void>) {
    if (busy || !ready) return; setBusy(true); setMessage(undefined); setError(false);
    try { if (!await flush()) throw new Error('save-pending'); await run(); }
    catch (failure) { setMessage(failure instanceof DemoConflict ? t.stale : t.failed); setError(true); }
    finally { setBusy(false); }
  }
  function changePrice(event: React.FormEvent) {
    event.preventDefault();
    const normalized = price.trim().replace(',', '.');
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 1_000_000) { setMessage(t.invalidPrice); setError(true); return; }
    void action(async () => {
      const store = ready!.store, snapshot = store.snapshot(store.seed.tableId), target = (await artifactDraft(demoArtifact(snapshot)).target(store.seed.priceTargetId))!, vector = { [store.seed.sourceRef.sourceId]: 1 };
      await store.apply({ commandGroupId: crypto.randomUUID(), expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions: vector, commands: [{ commandId: crypto.randomUUID(), artifactId: snapshot.artifact.id, kind: 'table', baseRevision: snapshot.artifact.currentRevision, expectedSourceRevisions: vector, reason: t.applyPrice, operations: [{ targetId: target.targetId, op: 'set', beforeHash: target.hash, value: { v: Number(normalized), t: 2 } }] }] });
      await refresh(); await preparePreview();
    });
  }
  async function preparePreview() {
    const store = ready!.store, proposal = await store.prepare(), initial = store.seed.snapshots[0]!;
    setChangeset({ id: crypto.randomUUID(), workspaceId: initial.viewer.workspaceId, projectId: initial.artifact.projectId, createdBy: initial.viewer.userId, createdAt: proposal.preparedAt, revision: 0, state: 'ready', proposal, acceptedGroupIds: [], rejectedGroupIds: [] });
    setSelected(selectableGroups(proposal)); setReviewOpen(true);
  }
  function accept() { if (changeset) void action(async () => { const receipt = await ready!.store.accept(changeset.proposal, selected); setLastGroup(receipt.commandGroupId); await refresh(); setReviewOpen(false); setMessage(t.ready); setChangeset(undefined); }); }
  function undo() { if (lastGroup) void action(async () => { const prepared = await ready!.document.prepareHistory('undo', lastGroup); if (!prepared.operation) throw new DemoConflict('sample-history-conflict'); await ready!.document.run(prepared.operation); await refresh(); setLastGroup(undefined); setMessage(t.saved); }); }
  function reset() {
    ready?.document.dispose(); ready?.table.dispose();
    try { localStorage.removeItem(storageKey); } catch { setError(true); setMessage(t.failed); return; }
    setReady(undefined); setChangeset(undefined); setLastGroup(undefined); setResetOpen(false); setBoot((value) => value + 1);
  }
  async function ownWork() {
    if (busy) return; setBusy(true); setError(false);
    try {
      if (ready && !await flush()) throw new Error('save-pending');
      ownAttempt.current ??= crypto.randomUUID();
      const intent = await identityClient.saveIntent({ goal: t.ownGoal, returnTo: '/app/work' }, ownAttempt.current);
      router.push(publicWorkDestination(Boolean(account.viewer), intent.intentToken));
    } catch { setMessage(t.failed); setError(true); setBusy(false); }
  }
  function download() { void action(async () => {
    const snapshot = ready!.store.snapshot(ready!.store.seed.documentId);
    const response = await fetch('/api/demo/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale, content: snapshot.content, title: snapshot.artifact.title }), credentials: 'omit', cache: 'no-store' });
    if (!response.ok) { setMessage(t.exportFailed); setError(true); return; }
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'tirlik-workshop-offer.docx'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }); }
  return <div className={styles.page}>
    <ProductHeader wide homeHref={`/${locale}`} homeLabel={t.home}><LocaleSelect compact selectedLocale={locale} onLocaleChange={(next) => { void action(async () => { router.push(`/${next}/demo`); }); }} /><Link className="tl-button tl-button--secondary" href={`/${locale}#start`}>{t.own}</Link></ProductHeader>
    <main className={styles.main}><section className={styles.intro}><div><h1>{t.title}</h1><p>{t.intro}</p></div><div className={styles.actions}><Button icon={RefreshCw} disabled={busy} onClick={() => setResetOpen(true)}>{t.reset}</Button></div></section>
      {message && <p className={error ? styles.error : styles.notice} role={error ? 'alert' : 'status'}>{message}</p>}
      {!ready ? <p className={styles.loading}>{error ? t.storageError : t.loading}</p> : <div className={styles.layout}>
        <aside className={styles.controls}><h2>{t.example}</h2><form onSubmit={changePrice}><label>{t.price}<input inputMode="decimal" value={price} maxLength={12} onChange={(event) => setPrice(event.target.value)} disabled={busy} /></label><Button type="submit" variant="primary" pending={busy}>{t.applyPrice}</Button></form><div className={styles.controlsActions}>
          <Button icon={GitCompareArrows} disabled={busy} onClick={() => { void action(preparePreview); }}>{t.review}</Button>
          <Button icon={Save} disabled={busy} onClick={() => { void action(async () => { localStorage.setItem(storageKey, ready.store.serialize()); setMessage(t.saved); }); }}>{t.save}</Button>
          <Button disabled={busy} onClick={() => { void action(async () => { setReady(undefined); setBoot((value) => value + 1); }); }}>{t.reopen}</Button>
          {lastGroup && <Button icon={Undo2} disabled={busy} onClick={undo}>{t.undo}</Button>}
        </div><p>{t.private}</p></aside>
        <section className={styles.work}><header className={styles.workHeader}><div className={styles.tabs} role="tablist" aria-label={t.example}>{(['document', 'table'] as const).map((value) => <button type="button" key={value} role="tab" aria-selected={tab === value} aria-controls={`sample-${value}`} disabled={busy} onClick={() => { void action(async () => { setTab(value); }); }}>{t[value]}</button>)}</div><Button icon={Download} disabled={busy} onClick={download}>{t.export}</Button></header>
          <p className={styles.hint}>{t.editHint}</p><div className={styles.editor} id={`sample-${tab}`} role="tabpanel">
            {tab === 'document' ? <DocumentEditor key={ready.store.seed.documentId} session={ready.document} resources={false} onFlushReady={registerDocument} /> : <SheetEditor key={ready.store.seed.tableId} session={ready.table} locale={locale} onFlushReady={registerTable} />}
          </div>
        </section>
      </div>}
      <section className={styles.own}><div><h2>{t.own}</h2><p>{t.ownHint}</p></div><Button variant="primary" pending={busy} onClick={() => { void ownWork(); }}>{t.own}</Button></section>
    </main>
    <footer className={styles.footer}><p>Tirlik. {t.footer}</p><nav aria-label={t.help}><Link href={`/${locale}/help`}>{t.help}</Link><Link href={`/${locale}/privacy`}>{t.privacy}</Link></nav></footer>
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen} title={t.review} className={styles.review} dismissible={!busy} footer={<div className={styles.actions}><Button variant="primary" pending={busy} disabled={!selected.length} onClick={accept}>{t.accept}</Button><Button disabled={busy} onClick={() => setReviewOpen(false)}>{t.cancel}</Button></div>}>{changeset && <ChangePreview changeset={changeset} locale={locale} selected={selected} onSelect={setSelected} disabled={busy} />}</Dialog>
    <Dialog open={resetOpen} onOpenChange={setResetOpen} title={t.resetTitle} description={t.resetDescription} footer={<div className={styles.actions}><Button variant="danger" onClick={reset}>{t.reset}</Button><Button onClick={() => setResetOpen(false)}>{t.cancel}</Button></div>}><p>{t.private}</p></Dialog>
  </div>;
}
