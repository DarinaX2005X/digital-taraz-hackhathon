"use client";

import * as Ariakit from "@ariakit/react";
import type { ReactNode } from "react";

export function Toolbar({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <Ariakit.Toolbar aria-label={label} className={`tl-toolbar ${className}`}>{children}</Ariakit.Toolbar>;
}

/** Compose with render={<IconButton ... />} to join the toolbar's arrow-key navigation. */
export function ToolbarItem(props: Ariakit.ToolbarItemProps) {
  return <Ariakit.ToolbarItem {...props} />;
}
