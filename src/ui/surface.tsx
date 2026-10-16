import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type SurfaceTone = "surface" | "inset" | "deep";
export type SurfaceProps<T extends ElementType = "section"> = {
  as?: T;
  tone?: SurfaceTone;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function Surface<T extends ElementType = "section">({ as, tone = "surface", className = "", children, ...props }: SurfaceProps<T>) {
  const Element = as ?? "section";
  return <Element {...props} className={`tl-surface tl-surface--${tone} ${className}`}>{children}</Element>;
}

export type DataSurfaceProps = ComponentPropsWithoutRef<"section"> & { children: ReactNode };

/** Flat boundary for tables, grids and document-like data where shadow would reduce clarity. */
export function DataSurface({ className = "", children, ...props }: DataSurfaceProps) {
  return <section {...props} className={`tl-data-surface ${className}`}>{children}</section>;
}

export type InlineNoticeTone = "info" | "success" | "warning" | "danger";
export type InlineNoticeProps = {
  tone?: InlineNoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};
const noticeIcons: Record<InlineNoticeTone, LucideIcon> = { info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle };

/** Persistent feedback placed beside its cause. Use Toast for secondary confirmation only. */
export function InlineNotice({ tone = "info", title, children, action, className = "" }: InlineNoticeProps) {
  const Icon = noticeIcons[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={`tl-inline-notice tl-inline-notice--${tone} ${className}`}>
    <Icon aria-hidden="true" size={20} />
    <div className="tl-inline-notice__copy"><p className="tl-inline-notice__title">{title}</p>{children && <div className="tl-inline-notice__description">{children}</div>}{action && <div className="tl-inline-notice__action">{action}</div>}</div>
  </div>;
}
