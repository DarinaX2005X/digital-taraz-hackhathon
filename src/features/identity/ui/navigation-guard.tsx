"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, Dialog, DialogClose } from "@/ui";
import { useIdentityTranslations } from "./hooks";
import { identitySamePageFragment, shouldConfirmIdentityNavigation } from "./settings-state";

export function useIdentityNavigationGuard(dirty: boolean, preserveHashViews = false, blocked = false) {
  const t = useIdentityTranslations();
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!dirty && !blocked) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, blocked]);
  if (!dirty && destination) setDestination(undefined);

  const onClickCapture: MouseEventHandler<HTMLElement> = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) return;
    if (blocked) { event.preventDefault(); return; }
    const navigation = { href: anchor.href, currentHref: window.location.href, button: event.button, modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey, target: anchor.target, download: anchor.hasAttribute("download"), prevented: event.defaultPrevented };
    const fragment = preserveHashViews ? identitySamePageFragment(navigation) : undefined;
    if (fragment !== undefined) { event.preventDefault(); window.location.hash = fragment; return; }
    if (!shouldConfirmIdentityNavigation({ ...navigation, dirty })) return;
    event.preventDefault();
    setDestination(`${anchor.pathname}${anchor.search}${anchor.hash}`);
  };
  const confirmation = <Dialog open={Boolean(destination)} onOpenChange={(open) => { if (!open) setDestination(undefined); }} title={t("identity.navigationLeave.title")} description={t("identity.navigationLeave.description")} initialFocus={stay} footer={<>
    <DialogClose ref={stay} icon={ArrowLeft}>{t("identity.navigationLeave.stay")}</DialogClose>
    <Button icon={ArrowRight} variant="danger" onClick={() => { if (destination) { const href = destination; setDestination(undefined); router.push(href); } }}>{t("identity.navigationLeave.leave")}</Button>
  </>}>{null}</Dialog>;
  return { onClickCapture, confirmation };
}
