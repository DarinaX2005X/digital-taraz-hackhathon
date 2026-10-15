export type RequestAttempt<T> = Readonly<{ intent: string; key: string; input: T }>;

/** Retries keep the original preconditions and generated IDs until a definite rejection. */
export function retainRequestAttempt<T>(previous: RequestAttempt<T> | undefined, intent: unknown, input: () => T, key: () => string = () => crypto.randomUUID()): RequestAttempt<T> {
  const fingerprint = JSON.stringify(intent);
  return previous?.intent === fingerprint ? previous : { intent: fingerprint, key: key(), input: structuredClone(input()) };
}

export function isDefiniteRequestRejection(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  return status === 400 || status === 409 || status === 422;
}
