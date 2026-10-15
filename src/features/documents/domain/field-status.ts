import type { BoundFact } from '@/contracts/materials';
import type { SourceFreshness } from '@/features/artifacts/contracts';

/** Source head and mapped fact freshness are independent authoritative dimensions. */
export function documentFieldStatus(fact: BoundFact, source: SourceFreshness | undefined): 'current' | 'stale' | 'missing' | 'unknown' | 'unconfirmed' {
  if (fact.state === 'unknown' || !source || source.status === 'unknown') return 'unknown';
  if (fact.state === 'missing') return 'missing';
  if (fact.state === 'stale' || source.status === 'stale') return 'stale';
  return fact.canBind ? 'current' : 'unconfirmed';
}
