"use client";

import * as Ariakit from "@ariakit/react";
import { X } from "lucide-react";
import { useReducer, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "@/i18n/provider";
import { Button, IconButton, type ButtonProps } from "./button";
import { dialogCloseReducer } from "./state/dialog";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: RefObject<HTMLElement | null>;
  placement?: "center" | "side";
  className?: string;
  /** False while an effect is pending or its outcome still needs reconciliation. */
  dismissible?: boolean;
} & ({ dirty?: false; onDiscard?: never } | {
  dirty: boolean;
  /** Called only after explicit discard confirmation. Reset the local draft here. */
  onDiscard: () => void;
});

export function Dialog({ open, onOpenChange, title, description, children, footer, dirty = false, onDiscard, initialFocus, returnFocus, placement = "center", className = "", dismissible = true }: DialogProps) {
  const t = useTranslations();
  const [closeState, dispatch] = useReducer(dialogCloseReducer, "editing");
  const [previousOpen, setPreviousOpen] = useState(open);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const store = Ariakit.useDialogStore({ open, setOpen: (next) => { if (next || dismissible) onOpenChange(next); } });
  const warningOpen = open && closeState === "confirming-discard";
  if (previousOpen !== open) {
    setPreviousOpen(open);
    dispatch({ type: "open" });
  }

  return <Ariakit.Dialog
      store={store}
      className={`tl-dialog tl-dialog--${placement} ${className}`}
      backdrop={<div className="tl-backdrop" />}
      modal
      unmountOnHide={false}
      initialFocus={initialFocus}
      finalFocus={returnFocus}
      hideOnEscape={dismissible}
      hideOnInteractOutside={dismissible}
      onClose={(event) => {
        const next = dialogCloseReducer(closeState, { type: "request-close", dirty, blocked: !dismissible });
        if (!dismissible || next === "confirming-discard") event.preventDefault();
        dispatch({ type: "request-close", dirty, blocked: !dismissible });
      }}
    >
      <div className="tl-dialog__header">
        <div className="tl-dialog__heading-group"><Ariakit.DialogHeading className="tl-dialog__title" render={<h2 />}>{title}</Ariakit.DialogHeading>{description && <Ariakit.DialogDescription className="tl-dialog__description">{description}</Ariakit.DialogDescription>}</div>
        <Ariakit.DialogDismiss disabled={!dismissible} render={<IconButton icon={X} label={t("common.actions.close")} />} />
      </div>
      <div className="tl-dialog__body">{children}</div>
      {footer && <div className="tl-dialog__footer">{footer}</div>}
      <Ariakit.Dialog
      open={warningOpen}
      onClose={() => dispatch({ type: "keep-editing" })}
      role="alertdialog"
      className="tl-dialog tl-dialog--confirmation"
      backdrop={<div className="tl-backdrop tl-backdrop--confirmation" />}
      initialFocus={keepEditingRef}
      modal
      unmountOnHide={false}
      hideOnInteractOutside={false}
    >
      <Ariakit.DialogHeading className="tl-dialog__title" render={<h2 />}>{t("common.dialog.unsavedTitle")}</Ariakit.DialogHeading>
      <Ariakit.DialogDescription className="tl-dialog__description">{t("common.dialog.unsavedDescription")}</Ariakit.DialogDescription>
      <div className="tl-dialog__footer">
        <Ariakit.DialogDismiss render={<Button ref={keepEditingRef} variant="primary" />}>{t("common.dialog.keepEditing")}</Ariakit.DialogDismiss>
        <Button variant="danger" disabled={!dismissible} onClick={() => { if (!dismissible) return; onDiscard?.(); dispatch({ type: "discard" }); onOpenChange(false); }}>{t("common.dialog.discard")}</Button>
      </div>
      </Ariakit.Dialog>
    </Ariakit.Dialog>;
}

/** Use for footer cancellation so dirty protection is the same as Escape and the close icon. */
export function DialogClose(props: ButtonProps) {
  return <Ariakit.DialogDismiss render={<Button {...props} />} />;
}
