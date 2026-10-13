"use client";

import { AlertCircle, Check, CloudOff, History, LoaderCircle, RotateCw, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "@/i18n/provider";
import type { CommonMessageKey } from "@/i18n";
import { Button } from "./button";

export type SaveState = "saving" | "saved" | "unsaved" | "local" | "offline" | "conflict";
const saveStates: Record<SaveState, { icon: LucideIcon; message: CommonMessageKey; tone: "muted" | "success" | "danger" | "warning" }> = {
  saving: { icon: LoaderCircle, message: "common.state.saving", tone: "muted" },
  saved: { icon: Check, message: "common.state.saved", tone: "success" },
  unsaved: { icon: AlertCircle, message: "common.state.unsaved", tone: "danger" },
  local: { icon: CloudOff, message: "common.state.savedLocally", tone: "warning" },
  offline: { icon: CloudOff, message: "common.state.offline", tone: "warning" },
  conflict: { icon: History, message: "common.state.conflict", tone: "warning" },
};

export function SaveStatus({ state, onRetry, detail }: { state: SaveState; onRetry?: () => void; detail?: string }) {
  const t = useTranslations();
  const { icon: Icon, message, tone } = saveStates[state];
  return <div className="tl-save-status">
    <span role="status" aria-live="polite" aria-atomic="true" className={`tl-status tl-status--${tone}`}>
      <Icon aria-hidden="true" size={18} className={state === "saving" ? "tl-spin" : undefined} /><span>{t(message)}{detail && <span className="tl-status__detail">{detail}</span>}</span>
    </span>
    {onRetry && (state === "unsaved" || state === "offline") && <Button variant="quiet" icon={RotateCw} onClick={onRetry}>{t("common.actions.retry")}</Button>}
  </div>;
}

type ResultStateProps = { title: string; description?: ReactNode; icon?: LucideIcon; action?: ReactNode; children?: ReactNode };

export function EmptyState({ title, description, icon: Icon, action, children }: ResultStateProps) {
  return <div className="tl-result-state">
    {Icon && <Icon aria-hidden="true" size={24} />}
    <h2 className="tl-result-state__title">{title}</h2>
    {description && <div className="tl-result-state__description">{description}</div>}
    {action && <div className="tl-result-state__action">{action}</div>}
    {children}
  </div>;
}

export function ErrorState({ title, description, action, children }: Omit<ResultStateProps, "icon">) {
  return <div className="tl-result-state tl-result-state--error">
    <div role="alert" className="tl-result-state__message"><AlertCircle aria-hidden="true" size={24} /><h2 className="tl-result-state__title">{title}</h2>{description && <div className="tl-result-state__description">{description}</div>}</div>
    {action && <div className="tl-result-state__action">{action}</div>}
    {children}
  </div>;
}

export function Skeleton({ width = "100%", height = "1rem", className = "" }: { width?: CSSProperties["width"]; height?: CSSProperties["height"]; className?: string }) {
  return <span aria-hidden="true" className={`tl-skeleton ${className}`} style={{ width, height }} />;
}

export function LoadingState({ label, children }: { label?: string; children?: ReactNode }) {
  const t = useTranslations();
  return <div aria-busy="true" className="tl-loading-state"><span role="status" className="tl-status"><LoaderCircle aria-hidden="true" className="tl-spin" size={20} />{label ?? t("common.state.loading")}</span>{children}</div>;
}
