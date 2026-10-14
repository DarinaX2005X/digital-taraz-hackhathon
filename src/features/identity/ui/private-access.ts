import type { AccountSnapshot } from "./account-store";
import { asIdentityFailure } from "./transport";

export type PrivateAccess = {
  ownerId: string;
  authEpoch: number;
  phase: "checking" | "active" | "locked" | "resume-required" | "discarded";
};

export function reconcilePrivateAccess(current: PrivateAccess, account: AccountSnapshot): PrivateAccess {
  let phase = current.phase;
  if (phase === "discarded") return current;
  if (!account.ready) phase = "checking";
  else if (!account.viewer) phase = "locked";
  else if (account.viewer.user.id !== current.ownerId) phase = "discarded";
  else if (phase === "checking") phase = "active";
  else if (phase === "locked" || account.authEpoch !== current.authEpoch) phase = "resume-required";
  return phase === current.phase && account.authEpoch === current.authEpoch ? current : { ...current, phase, authEpoch: account.authEpoch };
}

export function resumePrivateAccess(current: PrivateAccess, account: AccountSnapshot): PrivateAccess {
  const next = reconcilePrivateAccess(current, account);
  return next.phase === "resume-required" ? { ...next, phase: "active" } : next;
}

export async function guardIdentityRequest<T>(signal: AbortSignal, action: () => Promise<T>, account: { isCurrent: () => boolean; clear: () => void; refresh: () => Promise<unknown> }): Promise<T> {
  const assertCurrent = () => { if (signal.aborted || !account.isCurrent()) throw new DOMException("Aborted", "AbortError"); };
  try {
    assertCurrent();
    const result = await action();
    assertCurrent();
    return result;
  }
  catch (error) {
    if (!signal.aborted && account.isCurrent()) {
      const failure = asIdentityFailure(error);
      if (failure.status === 401) account.clear();
      if (failure.status === 409) void account.refresh().catch(() => undefined);
    }
    throw error;
  }
}
