import type { Metadata } from 'next';
import { PublicSite } from '@/features/public-site/public-site';
import { publicCopy } from '@/features/public-site/copy';

export const metadata: Metadata = {
  title: `${publicCopy.ru.heroTitle} | Tirlik`,
  description: publicCopy.ru.description,
};

export default function Page() {
  return <PublicSite />;
}
