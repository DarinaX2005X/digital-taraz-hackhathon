import { asIdentityFailure, type IdentityFailure } from "./transport";

export type OperationSnapshot<T> = { pending: boolean; result?: T; failure?: IdentityFailure };

export function createIdentityOperation<T>() {
  let snapshot: OperationSnapshot<T> = { pending: false };
  let epoch = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: OperationSnapshot<T>) => { snapshot = next; for (const listener of listeners) listener(); };
  function cancel() {
    epoch += 1;
    controller?.abort();
    controller = undefined;
    publish({ pending: false });
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    cancel,
    clear() { if (!snapshot.pending) publish({ pending: false }); },
    async run(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
      if (snapshot.pending) return undefined;
      const mine = ++epoch;
      controller = new AbortController();
      publish({ pending: true });
      try {
        const result = await action(controller.signal);
        if (mine !== epoch) return undefined;
        publish({ pending: false, result });
        return result;
      } catch (error) {
        if (mine !== epoch) return undefined;
        publish({ pending: false, failure: asIdentityFailure(error) });
        return undefined;
      } finally { if (mine === epoch) controller = undefined; }
    },
  };
}
