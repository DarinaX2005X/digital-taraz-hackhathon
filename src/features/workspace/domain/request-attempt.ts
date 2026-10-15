export type RequestAttempt<T> = Readonly<{ intent: string; key: string; input: T }>;

/** Retries keep the original preconditions and generated IDs until a definite rejection. */
export function retainRequestAttempt<T>(previous: RequestAttempt<T> | undefined, intent: unknown, input: () => T, key: () => string = () => crypto.randomUUID()): RequestAttempt<T> {
  const fingerprint = JSON.stringify(intent);
  return previous?.intent === fingerprint ? previous : { intent: fingerprint, key: key(), input: structuredClone(input()) };
}

export function requestStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('failure' in error && error.failure && typeof error.failure === 'object' && 'status' in error.failure && typeof error.failure.status === 'number') return error.failure.status;
}

export function isDefiniteRequestRejection(error: unknown) {
  const status = requestStatus(error);
  return status === 400 || status === 409 || status === 422;
}
