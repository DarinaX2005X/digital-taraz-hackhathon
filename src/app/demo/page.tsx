import { redirect } from 'next/navigation';
import { readRequestLocale } from '@/i18n/server';

export default async function Page() {
  redirect(`/${await readRequestLocale()}/demo`);
}
