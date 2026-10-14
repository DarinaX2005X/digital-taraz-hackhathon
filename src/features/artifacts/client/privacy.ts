import { z } from "zod";
import { IdSchema } from "@/contracts/primitives";

export const CacheAuthoritySchema = z.strictObject({
  userId: IdSchema,
  workspaceId: IdSchema,
  authzVersion: z.number().int().positive(),
  artifactIds: z.array(IdSchema).max(1000),
});
export type CacheAuthority = z.infer<typeof CacheAuthoritySchema>;
export type PrivacyLease = Readonly<{ epoch: number; authority: CacheAuthority; signal: AbortSignal }>;

export class PrivacyBoundaryError extends Error {
  constructor() { super("artifacts.errors.accessChanged"); this.name = "PrivacyBoundaryError"; }
}

/** Authority must come from a current authenticated server response, never stored preferences. */
export function createArtifactPrivacy(authority: CacheAuthority) {
  let current = CacheAuthoritySchema.parse(authority);
  let epoch = 0;
  let controller = new AbortController();
  let state: "active" | "suspended" | "closed" = "active";
  const listeners = new Set<() => void>();

  function invalidate(next: typeof state) {
    state = next;
    epoch += 1;
    controller.abort();
    for (const listener of listeners) listener();
  }

  return {
    get authority(): CacheAuthority { return structuredClone(current); },
    get state() { return state; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    capture(artifactIds: readonly string[] = []): PrivacyLease {
      if (state !== "active" || artifactIds.some((id) => !current.artifactIds.includes(id))) throw new PrivacyBoundaryError();
      return Object.freeze({ epoch, authority: structuredClone(current), signal: controller.signal });
    },
    assert(lease: PrivacyLease, artifactIds: readonly string[] = []) {
      if (state !== "active" || lease.epoch !== epoch || lease.signal.aborted || lease.signal !== controller.signal
        || artifactIds.some((id) => !current.artifactIds.includes(id))) throw new PrivacyBoundaryError();
    },
    suspend() { if (state !== "closed") invalidate("suspended"); },
    close() { if (state !== "closed") invalidate("closed"); },
    resume(authority: CacheAuthority) {
      const next = CacheAuthoritySchema.parse(authority);
      if (state === "closed" || next.userId !== current.userId || next.workspaceId !== current.workspaceId) {
        invalidate("closed");
        throw new PrivacyBoundaryError();
      }
      invalidate("suspended");
      current = next;
      controller = new AbortController();
      state = "active";
    },
  };
}

export type ArtifactPrivacy = ReturnType<typeof createArtifactPrivacy>;
