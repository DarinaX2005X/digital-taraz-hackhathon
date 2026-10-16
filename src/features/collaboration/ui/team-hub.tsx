'use client';

import Link from 'next/link';
import { Check, RefreshCw, Save, Settings, Shield, UserRoundCog, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/i18n/provider';
import type { AccessScope } from '@/features/identity/contracts';
import { Button, CheckboxField, EmptyState, LoadingState, SelectField } from '@/ui';
import { workspaceClient } from '@/features/workspace/client/transport';
import type { Project } from '@/features/workspace/contracts';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { collaborationClient, CollaborationRequestError } from '../client/transport';
import type { ProjectAccessList } from '../contracts';
import { collaborationCopy } from '../locales';
import styles from './team-hub.module.css';

const scopeOrder: AccessScope[] = ['read', 'edit', 'approve', 'export', 'manage-members', 'read-confidential'];
type Drafts = Record<string, AccessScope[] | null>;

function changedScopes(current: AccessScope[] | null, draft: AccessScope[] | null) {
  return JSON.stringify(current ?? null) !== JSON.stringify(draft ?? null);
}

export function TeamHub({ ownerId, initialWorkspaceId }: { ownerId: string; initialWorkspaceId?: string }) {
  const { locale } = useLocale(), t = collaborationCopy(locale), access = useWorkspaceAccess(ownerId), { run } = access;
  const memberships = access.account.viewer?.user.id === ownerId ? access.account.viewer.workspaces : [];
  const [workspaceChoice, setWorkspaceChoice] = useState(initialWorkspaceId ?? '');
  const workspaceId = memberships.some((item) => item.workspaceId === workspaceChoice) ? workspaceChoice : memberships[0]?.workspaceId ?? '';
  const [projects, setProjects] = useState<Project[]>([]), [projectChoice, setProjectChoice] = useState('');
  const projectId = projects.some((item) => item.id === projectChoice) ? projectChoice : projects[0]?.id ?? '';
  const [page, setPage] = useState<ProjectAccessList>(), [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(false), [savingUserId, setSavingUserId] = useState(''), [error, setError] = useState<unknown>(), [savedUserId, setSavedUserId] = useState(''), [refresh, setRefresh] = useState(0);
  const currentPage = page?.workspaceId === workspaceId && page.projectId === projectId ? page : undefined;
  const dirty = useMemo(() => currentPage?.members.some((member) => changedScopes(member.projectScopes, drafts[member.userId] ?? member.projectScopes)) ?? false, [currentPage, drafts]);
  const labels: Record<AccessScope, string> = { read: t.read, edit: t.edit, approve: t.approve, export: t.export, 'manage-members': t.manage, 'read-confidential': t.confidential };

  useEffect(() => {
    if (access.phase !== 'active' || !workspaceId) return;
    const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(undefined); } });
    void run((signal) => workspaceClient.list({ workspaceId, status: 'active', order: 'recent', query: '', limit: 50 }, { userId: ownerId, signal }), controller.signal)
      .then((result) => setProjects(result.projects)).catch((failure) => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access.phase, workspaceId, ownerId, run, refresh]);

  useEffect(() => {
    if (access.phase !== 'active' || !workspaceId || !projectId) return;
    const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(undefined); } });
    void run((signal) => collaborationClient.projectAccess(workspaceId, projectId, { userId: ownerId, signal }), controller.signal, false)
      .then((result) => { setPage(result); setDrafts(Object.fromEntries(result.members.map((member) => [member.userId, member.projectScopes]))); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access.phase, workspaceId, projectId, ownerId, run, refresh]);

  function toggle(userId: string, scope: AccessScope, checked: boolean) {
    setSavedUserId('');
    setDrafts((current) => {
      const selected = new Set(current[userId] ?? []);
      if (scope === 'read' && !checked) selected.clear();
      else if (checked) { selected.add('read'); selected.add(scope); }
      else selected.delete(scope);
      return { ...current, [userId]: selected.size ? scopeOrder.filter((item) => selected.has(item)) : null };
    });
  }

  async function save(userId: string, scopes: AccessScope[] | null) {
    if (!currentPage) return;
    setSavingUserId(userId); setSavedUserId(''); setError(undefined);
    try {
      await run((signal) => collaborationClient.setProjectAccess(currentPage.projectId, { workspaceId: currentPage.workspaceId, projectId: currentPage.projectId, userId, scopes, expectedAuthzVersion: currentPage.authzVersion }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      await access.account.refresh(); setSavedUserId(userId); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSavingUserId(''); }
  }

  if (access.phase !== 'active') return <WorkspaceShell><WorkspaceAccessState access={access} returnTo="/app/team" /></WorkspaceShell>;
  const status = error instanceof CollaborationRequestError && error.status === 409 ? t.conflict : t.error;
  return <WorkspaceShell workspaceId={workspaceId}><main className={styles.main}>
    <header className={styles.heading}><div><h1>{t.title}</h1><p>{t.intro}</p></div><Users size={38} aria-hidden="true" /></header>
    <div className={styles.controlBar}>
      {memberships.length > 1 && <SelectField label={t.workspace} value={workspaceId} disabled={Boolean(savingUserId)} onChange={(event) => { setWorkspaceChoice(event.target.value); setProjectChoice(''); }}><>{memberships.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</></SelectField>}
      <SelectField label={t.project} value={projectId} disabled={Boolean(savingUserId) || !projects.length} onChange={(event) => setProjectChoice(event.target.value)}><option value="">{projects.length ? t.selectProject : t.noProjects}</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField>
      <div className={styles.settingsLink}><Link href={`/settings/team${workspaceId ? `?workspace=${workspaceId}` : ''}`}><Settings size={18} aria-hidden="true" /><span><strong>{t.teamSettings}</strong><small>{t.teamSettingsHint}</small></span></Link></div>
    </div>
    {Boolean(error) && <div className={styles.error} role="alert"><p>{status}</p><Button icon={RefreshCw} onClick={() => setRefresh((value) => value + 1)}>{t.retry}</Button></div>}
    {dirty && <p className={styles.unsaved} role="status">{t.unsaved}</p>}
    {loading && !currentPage ? <LoadingState label={t.loading} /> : !projectId ? <EmptyState icon={UserRoundCog} title={projects.length ? t.selectProject : t.noProjects} /> : currentPage ? <section className={styles.access} aria-labelledby="project-access-title">
      <div className={styles.sectionHeading}><div><h2 id="project-access-title">{t.members}</h2><p>{projects.find((item) => item.id === projectId)?.title}</p></div><span className={styles.memberCount}>{currentPage.members.length}</span></div>
      <div className={styles.scopeHeader} aria-hidden="true"><span>{t.member}</span>{scopeOrder.map((scope) => <span key={scope}>{labels[scope]}</span>)}<span /></div>
      <ul className={styles.members}>{currentPage.members.map((member) => {
        const selected = drafts[member.userId] ?? member.projectScopes;
        const changed = changedScopes(member.projectScopes, selected);
        return <li key={member.userId} data-dirty={changed}><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{member.name.slice(0, 1).toLocaleUpperCase(locale)}</span><span><strong>{member.name}</strong><small>{member.email}</small><small>{t.role}: {t[member.membershipRole]}</small></span>{member.membershipRole === 'owner' && <span className={styles.ownerBadge}><Shield size={15} aria-hidden="true" />{t.inherited}</span>}</div>
          <fieldset className={styles.scopes} disabled={!member.canManage || Boolean(savingUserId)}><legend>{t.access}: {member.name}</legend>{scopeOrder.map((scope) => <CheckboxField key={scope} label={labels[scope]} checked={Boolean(selected?.includes(scope))} onChange={(event) => toggle(member.userId, scope, event.target.checked)} />)}</fieldset>
          <div className={styles.rowAction}>{member.canManage ? <Button icon={selected ? Save : X} variant={selected ? 'primary' : 'danger'} pending={savingUserId === member.userId} pendingLabel={t.saving} disabled={!changed || Boolean(savingUserId && savingUserId !== member.userId)} onClick={() => { void save(member.userId, selected ?? null); }}>{selected ? t.save : t.remove}</Button> : <span className={styles.effective}>{t.effective}: {member.effectiveScopes.map((scope) => labels[scope]).join(', ')}</span>}{savedUserId === member.userId && <span className={styles.saved} role="status"><Check size={16} aria-hidden="true" />{t.saved}</span>}</div>
        </li>;
      })}</ul>
      {!currentPage.members.length && <EmptyState title={t.empty} />}
    </section> : null}
  </main></WorkspaceShell>;
}
