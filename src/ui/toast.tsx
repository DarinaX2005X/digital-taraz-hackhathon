"use client";

import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "@/i18n/provider";
import { Button, IconButton } from "./button";
import { resolveToastText, toastDuration, toastReducer, type ToastNotice, type ToastText, type ToastTone } from "./state/toast";

export type ToastInput = {
  id?: string;
  title: ToastText;
  description?: ToastText;
  tone?: ToastTone;
  durationMs?: number | null;
  action?: ToastNotice["action"];
};
type ToastActions = { notify: (input: ToastInput) => string; dismiss: (id: string) => void; clear: () => void };
const ToastContext = createContext<ToastActions | null>(null);
const icons = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: AlertCircle };

function ToastItem({ notice, dismiss }: { notice: ToastNotice; dismiss: (id: string) => void }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(notice.durationMs);
  const paused = hovered || focused;
  const Icon = icons[notice.tone];

  useEffect(() => {
    if (paused || remaining.current === null) return;
    const started = performance.now();
    const timer = setTimeout(() => dismiss(notice.id), remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== null) remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [paused, dismiss, notice.id]);

  return <li className={`tl-toast tl-toast--${notice.tone}`}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(notice.id); } }}
  >
    <Icon aria-hidden="true" size={20} className="tl-toast__icon" />
    <div className="tl-toast__content">
      <div role={notice.tone === "error" ? "alert" : "status"} aria-atomic="true"><p className="tl-toast__title">{resolveToastText(notice.title, locale)}</p>{notice.description && <p className="tl-toast__description">{resolveToastText(notice.description, locale)}</p>}</div>
      {notice.action && <Button variant="quiet" onClick={notice.action.onClick}>{resolveToastText(notice.action.label, locale)}</Button>}
    </div>
    <IconButton icon={X} label={t("common.actions.close")} onClick={() => dismiss(notice.id)} />
  </li>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const prefix = useId();
  const sequence = useRef(0);
  const [notices, dispatch] = useReducer(toastReducer, []);
  const notify = useCallback((input: ToastInput) => {
    const revision = ++sequence.current;
    const id = input.id ?? `${prefix}-${revision}`;
    const tone = input.tone ?? "info";
    dispatch({ type: "push", notice: { ...input, id, revision, tone, durationMs: toastDuration(tone, Boolean(input.action), input.durationMs) } });
    return id;
  }, [prefix]);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const actions = useMemo(() => ({ notify, dismiss, clear }), [notify, dismiss, clear]);
  return <ToastContext.Provider value={actions}>
    {children}
    <section aria-label={t("common.feedback.notifications")} className="tl-toast-region">
      <ol className="tl-toast-list">{notices.map((notice) => <ToastItem key={`${notice.id}:${notice.revision}`} notice={notice} dismiss={dismiss} />)}</ol>
    </section>
  </ToastContext.Provider>;
}

export function useToast(): ToastActions {
  const actions = useContext(ToastContext);
  if (!actions) throw new Error("useToast requires ToastProvider");
  return actions;
}
