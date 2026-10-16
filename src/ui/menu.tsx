"use client";

import * as Ariakit from "@ariakit/react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type MenuProps = {
  trigger: ReactElement;
  children: ReactNode;
  label?: string;
  placement?: Ariakit.MenuStoreProps["placement"];
  className?: string;
};

/** Shared keyboard and focus-safe action menu. The trigger must provide its own accessible name. */
export function Menu({ trigger, children, label, placement = "bottom-end", className = "" }: MenuProps) {
  const store = Ariakit.useMenuStore({ placement });
  return <>
    <Ariakit.MenuButton store={store} render={trigger} />
    <Ariakit.Menu store={store} aria-label={label} className={`tl-menu ${className}`} gutter={8} portal>
      {children}
    </Ariakit.Menu>
  </>;
}

export type MenuItemProps = Omit<ComponentProps<typeof Ariakit.MenuItem>, "className" | "children"> & {
  children: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "danger";
  className?: string;
};

export function MenuItem({ children, icon: Icon, tone = "default", className = "", ...props }: MenuItemProps) {
  return <Ariakit.MenuItem {...props} className={`tl-menu__item tl-menu__item--${tone} ${className}`}>
    {Icon && <Icon aria-hidden="true" size={18} />}
    <span>{children}</span>
  </Ariakit.MenuItem>;
}

export function MenuSeparator({ className = "", ...props }: ComponentProps<typeof Ariakit.MenuSeparator>) {
  return <Ariakit.MenuSeparator {...props} className={`tl-menu__separator ${className}`} />;
}

export function MenuGroup({ className = "", ...props }: ComponentProps<typeof Ariakit.MenuGroup>) {
  return <Ariakit.MenuGroup {...props} className={`tl-menu__group ${className}`} />;
}
