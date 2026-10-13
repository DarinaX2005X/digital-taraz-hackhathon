"use client";

import * as Ariakit from "@ariakit/react";
import { useId, type ReactNode } from "react";

export type TabItem = { id: string; label: string; content: ReactNode; disabled?: boolean };
export type TabsProps = {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  appearance?: "tabs" | "segmented";
  className?: string;
};

export function Tabs({ label, items, value, onChange, appearance = "tabs", className = "" }: TabsProps) {
  const baseId = useId();
  const tabId = (id: string) => `${baseId}-${encodeURIComponent(id)}`;
  const store = Ariakit.useTabStore({
    selectedId: tabId(value),
    setSelectedId: (selectedId) => {
      const item = items.find((candidate) => tabId(candidate.id) === selectedId);
      if (item && !item.disabled) onChange(item.id);
    },
    selectOnMove: true,
  });

  return <div className={`tl-tabs tl-tabs--${appearance} ${className}`}>
    <Ariakit.TabList store={store} aria-label={label} className="tl-tabs__list">
      {items.map((item) => <Ariakit.Tab key={item.id} store={store} id={tabId(item.id)} disabled={item.disabled} className="tl-tabs__tab">{item.label}</Ariakit.Tab>)}
    </Ariakit.TabList>
    {items.map((item) => <Ariakit.TabPanel key={item.id} store={store} tabId={tabId(item.id)} className="tl-tabs__panel" unmountOnHide={false} scrollRestoration>{item.content}</Ariakit.TabPanel>)}
  </div>;
}
