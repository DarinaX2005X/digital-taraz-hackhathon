"use client";

import Link from 'next/link';
import { ArrowLeft, FileQuestion, FolderSearch } from 'lucide-react';
import { useTranslations } from '@/i18n/provider';
import { LocaleSelect } from './locale-select';
import { ProductHeader } from './product-header';
import styles from './route-state.module.css';

export function RouteState({ kind }: { kind: 'not-found' | 'invalid-workspace' }) {
  const t = useTranslations();
  const missing = kind === 'not-found';
  return <div className={styles.page}>
    <ProductHeader homeLabel={t('common.navigation.home')}><LocaleSelect compact /></ProductHeader>
    <main className={styles.content}>
      <div className={styles.symbol} aria-hidden="true">{missing ? <FileQuestion size={28} /> : <FolderSearch size={28} />}</div>
      <h1>{t(missing ? 'common.pages.notFoundTitle' : 'common.pages.invalidWorkspaceTitle')}</h1>
      {missing && <p className={styles.code}>404</p>}
      <p className={styles.description}>{t(missing ? 'common.pages.notFoundDescription' : 'common.pages.invalidWorkspaceDescription')}</p>
      <Link href={missing ? '/' : '/settings/team'} className="tl-button tl-button--primary"><ArrowLeft size={20} aria-hidden="true" /><span className="tl-button__label">{t(missing ? 'common.navigation.home' : 'common.pages.chooseWorkspace')}</span></Link>
    </main>
  </div>;
}
