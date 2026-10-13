"use client";

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from '@/i18n/provider';
import { LocaleSelect } from '@/ui';
import styles from './route-state.module.css';

export function RouteState({ kind }: { kind: 'not-found' | 'invalid-workspace' }) {
  const t = useTranslations();
  const missing = kind === 'not-found';
  return <div className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><Image src="/brand/tirlik-mark.svg" width={40} height={40} alt="" /><span>Tirlik</span></Link>
      <LocaleSelect className={styles.locale} />
    </header>
    <main className={styles.content}>
      {missing && <p className={styles.code}>404</p>}
      <h1>{t(missing ? 'common.pages.notFoundTitle' : 'common.pages.invalidWorkspaceTitle')}</h1>
      <p className={styles.description}>{t(missing ? 'common.pages.notFoundDescription' : 'common.pages.invalidWorkspaceDescription')}</p>
      <Link href={missing ? '/' : '/settings/team'} className="tl-button tl-button--primary"><ArrowLeft size={20} aria-hidden="true" /><span className="tl-button__label">{t(missing ? 'common.navigation.home' : 'common.pages.chooseWorkspace')}</span></Link>
    </main>
  </div>;
}
