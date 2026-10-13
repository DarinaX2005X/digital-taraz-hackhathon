import type { Locale } from "@/i18n";
import type { IdentityUser, IdentityViewer } from "../contracts";
import { IdentityTransportError, identityClient, type IdentityClient } from "./transport";

export type AccountSnapshot = { viewer: IdentityViewer | null; ready: boolean };

export function createIdentityAccountStore(client: IdentityClient = identityClient) {
  let snapshot: AccountSnapshot = { viewer: null, ready: false };
  let epoch = 0;
  let refreshEpoch = 0;
  const controllers = new Set<AbortController>();
  const listeners = new Set<() => void>();
  function publish(next: AccountSnapshot) { snapshot = next; for (const listener of listeners) listener(); }
  function clear() {
    epoch += 1;
    refreshEpoch += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    publish({ viewer: null, ready: true });
  }
  async function refresh(): Promise<IdentityViewer | null> {
    const mine = epoch;
    const refreshMine = ++refreshEpoch;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const viewer = await client.me({ signal: controller.signal });
      if (mine !== epoch || refreshMine !== refreshEpoch) return null;
      if (snapshot.viewer && snapshot.viewer.user.id !== viewer.user.id) {
        for (const pending of controllers) if (pending !== controller) pending.abort();
        epoch += 1;
      }
      publish({ viewer, ready: true });
      return viewer;
    } catch (error) {
      if (mine !== epoch || refreshMine !== refreshEpoch) return null;
      if (error instanceof IdentityTransportError && error.failure.status === 401) { clear(); return null; }
      publish({ ...snapshot, ready: true });
      throw error;
    } finally { controllers.delete(controller); }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    clear, refresh,
    acceptUser(user: IdentityUser) {
      if (snapshot.viewer?.user.id === user.id) publish({ ...snapshot, viewer: { ...snapshot.viewer, user } });
    },
    async persistLocale(expectedUserId: string, locale: Locale): Promise<void> {
      const mine = epoch;
      if (snapshot.viewer?.user.id !== expectedUserId) return;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const current = await client.me({ signal: controller.signal, expectedUserId });
        if (mine !== epoch || controller.signal.aborted) return;
        if (current.user.id !== expectedUserId) { clear(); await refresh(); return; }
        const { user } = await client.updateProfile({ locale }, { signal: controller.signal, expectedUserId });
        if (mine !== epoch || controller.signal.aborted) return;
        if (user.id !== expectedUserId) { clear(); await refresh(); return; }
        if (snapshot.viewer?.user.id === user.id) publish({ ...snapshot, viewer: { ...snapshot.viewer, user } });
      } catch (error) {
        if (mine !== epoch || controller.signal.aborted) return;
        if (error instanceof IdentityTransportError && error.failure.status === 401) { clear(); return; }
        if (error instanceof IdentityTransportError && error.failure.status === 409) { clear(); await refresh(); return; }
        throw error;
      } finally { controllers.delete(controller); }
    },
  };
}
