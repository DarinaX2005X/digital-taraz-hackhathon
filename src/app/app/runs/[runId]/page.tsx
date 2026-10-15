import { notFound } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { RunsPage } from '@/features/runs/ui/runs-page';

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const parsed = IdSchema.safeParse((await params).runId);
  if (!parsed.success) notFound();
  return <RunsPage runId={parsed.data} />;
}
