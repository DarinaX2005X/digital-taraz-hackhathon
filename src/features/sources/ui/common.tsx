'use client';

import { AlertCircle, CheckCircle2, Clock3, FileText } from 'lucide-react';
import { useLocale } from '@/i18n/provider';
import type { SourceUpload } from '@/contracts/sources';
import { sourceCopies, sourceError } from '../locales';
import styles from './sources.module.css';

export function useSourceCopy() { const { locale } = useLocale(); return sourceCopies[locale]; }
export function SourceError({ error }: { error: unknown }) {
  const t = useSourceCopy();
  if (!error || error instanceof DOMException && error.name === 'AbortError') return null;
  return <div className={styles.error} role="alert"><p>{typeof error === 'string' ? error : sourceError(t, error)}</p></div>;
}
export function SourceStatus({ status }: { status: SourceUpload['status'] }) {
  const t = useSourceCopy();
  const label = status === 'uploading' || status === 'processing' ? t[status] : t[status];
  const Icon = status === 'ready' ? CheckCircle2 : ['failed', 'partial'].includes(status) ? AlertCircle : status === 'uploaded' ? FileText : Clock3;
  return <span className={styles.status} data-state={status}><Icon size={16} aria-hidden="true" />{label}</span>;
}
