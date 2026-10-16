'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BriefcaseBusiness, Building2, FolderOpen, LogIn, RefreshCw, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEventHandler, type ReactNode } from 'react';
import { useLocale } from '@/i18n/provider';
import { AccountMenu, AuthDialog, useIdentityAccount } from '@/features/identity/ui';
import { usePrivateIdentityAccess } from '@/features/identity/ui/hooks';
import { Button, EmptyState, LoadingState, LocaleSelect, ProductHeader } from '@/ui';
import { WorkspaceRequestError } from '../client/transport';
import { workspaceCopies } from '../locales';
import styles from './workspace.module.css';
import { requestStatus } from '../domain/request-attempt';

export function useWorkspaceCopy() { const { locale } = useLocale(); return workspaceCopies[locale]; }

export function WorkspaceShell({ children, workspaceId, beforeSignOut, onSignedOut, onClickCapture }: { children: ReactNode; workspaceId?: string; beforeSignOut?: () => Promise<boolean>; onSignedOut?: () => void; onClickCapture?: MouseEventHandler<HTMLDivElement> }) {
  const t = useWorkspaceCopy(), pathname = usePathname();
  return <div className={styles.shell} onClickCapture={onClickCapture}>
    <ProductHeader homeLabel={t.work} navigation={<nav className={styles.navigation} aria-label={t.workspace}>
      <Link href={`/app/work${workspaceId ? `?workspace=${workspaceId}` : ''}`} aria-current={pathname.startsWith('/app/work') || pathname.startsWith('/app/projects') ? 'page' : undefined}><BriefcaseBusiness size={18} />{t.work}</Link>
      <Link href={`/app/materials${workspaceId ? `?workspaceId=${workspaceId}` : ''}`} aria-current={pathname.startsWith('/app/materials') ? 'page' : undefined}><FolderOpen size={18} />{t.materials}</Link>
      <Link href={`/app/business${workspaceId ? `?workspace=${workspaceId}` : ''}`} aria-current={pathname.startsWith('/app/business') ? 'page' : undefined}><Building2 size={18} />{t.business}</Link>
      <Link href={`/app/team${workspaceId ? `?workspace=${workspaceId}` : ''}`} aria-current={pathname.startsWith('/app/team') ? 'page' : undefined}><Users size={18} />{t.team}</Link>
    </nav>}><LocaleSelect compact /><AccountMenu beforeSignOut={beforeSignOut} onSignedOut={onSignedOut} /></ProductHeader>
    {children}
  </div>;
}

export function useWorkspaceAccess(ownerId: string) {
  const account = useIdentityAccount();
  const access = usePrivateIdentityAccess(ownerId);
  const [denied, setDenied] = useState(false);
  const controllers = useRef(new Set<AbortController>());
  const phase = denied ? 'discarded' : access.phase;
  const { authEpoch, isCurrent, invalidate, refresh } = account;
  useEffect(() => {
    if (phase !== 'active') { for (const controller of controllers.current) controller.abort(); controllers.current.clear(); }
  }, [phase]);
  useEffect(() => { const set = controllers.current; return () => { for (const controller of set) controller.abort(); set.clear(); }; }, []);
  const run = useCallback(async <T,>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, purge = true): Promise<T> => {
    const controller = new AbortController(), epoch = authEpoch;
    controllers.current.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      if (phase !== 'active' || !isCurrent(ownerId, epoch) || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const result = await action(controller.signal);
      if (!isCurrent(ownerId, epoch) || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return result;
    } catch (error) {
      if (!controller.signal.aborted && isCurrent(ownerId, epoch)) {
        const status = requestStatus(error);
        if (status === 401) invalidate(ownerId, epoch);
        if (purge && (status === 403 || status === 404)) setDenied(true);
        if (status === 409) void refresh().catch(() => undefined);
      }
      throw error;
    } finally { controllers.current.delete(controller); signal?.removeEventListener('abort', abort); }
  }, [authEpoch, isCurrent, invalidate, refresh, ownerId, phase]);
  return { ...access, phase, account, run, denied };
}

export function WorkspaceAccessState({ access, returnTo }: { access: ReturnType<typeof useWorkspaceAccess>; returnTo: string }) {
  const t = useWorkspaceCopy(), router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const discarded = access.phase === 'discarded';
  const resume = async () => { setBusy(true); try { await access.account.refresh(); access.resume(); } finally { setBusy(false); } };
  return <main className={styles.main}>
    {access.phase === 'checking' ? <LoadingState /> : <EmptyState icon={discarded ? FolderOpen : LogIn}
      title={t[discarded ? 'forbidden' : 'auth']} description={t[discarded ? 'forbiddenDescription' : 'authDescription']}
      action={<>{!discarded && <><Button icon={RefreshCw} pending={busy} onClick={() => { void resume(); }}>{t.resume}</Button><Button variant="primary" icon={LogIn} onClick={() => setOpen(true)}>{t.signIn}</Button></>}<Button onClick={() => { router.push('/app/work'); router.refresh(); }}>{t.back}</Button></>} />}
    <AuthDialog open={open} onOpenChange={setOpen} returnTo={returnTo} onAuthenticated={() => { void resume(); }} />
  </main>;
}

export function WorkspaceError({ error, retry, saving = false }: { error: unknown; retry?: () => void; saving?: boolean }) {
  const t = useWorkspaceCopy();
  if (!error || error instanceof DOMException && error.name === 'AbortError') return null;
  const conflict = error instanceof WorkspaceRequestError && error.status === 409;
  return <div className={styles.error} role="alert"><p>{conflict ? t.conflict : saving ? t.saveError : t.error}</p>{retry && <Button icon={RefreshCw} onClick={retry}>{conflict ? t.reload : t.retry}</Button>}</div>;
}
