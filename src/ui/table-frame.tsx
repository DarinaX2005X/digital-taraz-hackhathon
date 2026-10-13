import type { CSSProperties, ReactNode } from "react";

export function TableFrame({ label, children, minWidth = 640, className = "" }: {
  label: string;
  /** Supply a semantic table with its own caption and column/row headers. */
  children: ReactNode;
  minWidth?: number;
  className?: string;
}) {
  return <div role="region" aria-label={label} tabIndex={0} className={`tl-table-frame ${className}`} style={{ "--table-min-width": `${minWidth}px` } as CSSProperties}>{children}</div>;
}
