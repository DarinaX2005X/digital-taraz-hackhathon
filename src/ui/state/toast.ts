import type { Locale } from "@/i18n";

/** Use a resolver for system copy; plain strings are for user-authored content. */
export type ToastText = string | ((locale: Locale) => string);
export type ToastTone = "info" | "success" | "warning" | "error";
export type ToastNotice = Readonly<{
  id: string;
  revision: number;
  title: ToastText;
  description?: ToastText;
  tone: ToastTone;
  durationMs: number | null;
  action?: { label: ToastText; onClick: () => void };
}>;
export type ToastEvent = { type: "push"; notice: ToastNotice } | { type: "dismiss"; id: string } | { type: "clear" };

export function resolveToastText(text: ToastText, locale: Locale): string {
  return typeof text === "function" ? text(locale) : text;
}

export function toastReducer(state: readonly ToastNotice[], event: ToastEvent): readonly ToastNotice[] {
  if (event.type === "clear") return [];
  if (event.type === "dismiss") return state.filter((notice) => notice.id !== event.id);
  const index = state.findIndex((notice) => notice.id === event.notice.id);
  if (index < 0) return [...state, event.notice];
  return state.map((notice, position) => position === index ? event.notice : notice);
}

export function toastDuration(tone: ToastTone, hasAction: boolean, requested?: number | null): number | null {
  if (tone === "error" || hasAction || requested === null) return null;
  if (requested !== undefined && (!Number.isFinite(requested) || requested < 0)) throw new RangeError("Invalid toast duration");
  return Math.max(6000, requested ?? 8000);
}
