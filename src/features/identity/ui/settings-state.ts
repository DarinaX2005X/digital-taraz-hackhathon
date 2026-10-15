export const settingsViews = ["profile", "language", "security", "sessions", "delete-account"] as const;
export type SettingsView = (typeof settingsViews)[number];

export function settingsViewFromHash(hash: string): SettingsView {
  const view = hash.startsWith("#") ? hash.slice(1) : hash;
  return settingsViews.find((candidate) => candidate === view) ?? "profile";
}

type IdentityNavigation = {
  href: string;
  currentHref: string;
  button?: number;
  modified?: boolean;
  target?: string;
  download?: boolean;
  prevented?: boolean;
};

function nativeNavigation(input: IdentityNavigation) {
  return input.prevented || input.modified || input.download || (input.button ?? 0) !== 0 || Boolean(input.target && input.target !== "_self");
}

export function identitySamePageFragment(input: IdentityNavigation): string | undefined {
  if (nativeNavigation(input)) return;
  try {
    const current = new URL(input.currentHref);
    const destination = new URL(input.href, current);
    if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return destination.hash;
  } catch { return; }
}

export function shouldConfirmIdentityNavigation(input: IdentityNavigation & { dirty: boolean }): boolean {
  if (!input.dirty || nativeNavigation(input)) return false;
  try {
    const current = new URL(input.currentHref);
    const destination = new URL(input.href, current);
    return destination.origin === current.origin && (destination.pathname !== current.pathname || destination.search !== current.search);
  } catch { return false; }
}
