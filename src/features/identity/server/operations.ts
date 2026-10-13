import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { IdentityError } from './http';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  return key;
}
export interface IdentityOperation { secret: string; actorId: string; workspaceId?: string; kind: string; key: string; body: unknown }

/** Call only after rechecking the actor and current access, inside the same
 * transaction as the effect. Receipts never contain passwords or invite tokens. */
export async function identityOperation<T>(transaction: PoolClient, operation: IdentityOperation, effect: () => Promise<T>): Promise<T> {
  const hmac = (value: string) => createHmac('sha256', operation.secret).update(value).digest('hex');
  const keyHash = hmac(canonical([operation.actorId, operation.workspaceId ?? null, operation.kind, operation.key]));
  const bodyHash = hmac(canonical(operation.body));
  await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [keyHash]);
  const previous = (await transaction.query<{ body_hash: string; result: T; active: boolean }>('SELECT body_hash,result,expires_at>now() AS active FROM identity_operations WHERE key_hash=$1', [keyHash])).rows[0];
  if (previous) {
    if (previous.body_hash !== bodyHash || !previous.active) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
    return previous.result;
  }
  const result = await effect();
  await transaction.query("INSERT INTO identity_operations(key_hash,actor_id,workspace_id,kind,body_hash,result,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')", [keyHash, operation.actorId, operation.workspaceId ?? null, operation.kind, bodyHash, JSON.stringify(result)]);
  return result;
}
