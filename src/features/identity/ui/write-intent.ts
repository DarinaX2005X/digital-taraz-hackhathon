export function createIdentityWriteIntent(createId = () => crypto.randomUUID()) {
  let previous: { digest: string; key: string } | undefined;
  let epoch = 0;
  return {
    clear() { epoch += 1; previous = undefined; },
    async keyFor(payload: unknown, signal?: AbortSignal): Promise<string> {
      const mine = epoch;
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const digestBytes = await crypto.subtle.digest("SHA-256", bytes);
      if (signal?.aborted || mine !== epoch) throw new DOMException("Aborted", "AbortError");
      const digest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (previous?.digest !== digest) previous = { digest, key: createId() };
      return previous.key;
    },
  };
}
