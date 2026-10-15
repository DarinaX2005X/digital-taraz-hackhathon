'use client';
import { useLocale } from '@/i18n/provider';
export { valueText } from '../domain/display';
import { materialCopies } from '../locales';
import { MaterialRequestError } from '../client/transport';
import styles from './materials.module.css';
export function useMaterialCopy() { const { locale } = useLocale(); return materialCopies[locale]; }
export function MaterialError({ error }: { error: unknown }) {
  const t = useMaterialCopy();
  if (!error || error instanceof DOMException && error.name === 'AbortError') return null;
  return <div className={styles.error} role="alert">{typeof error === 'string' ? error : error instanceof MaterialRequestError && error.status === 409 ? t.conflict : t.error}</div>;
}

