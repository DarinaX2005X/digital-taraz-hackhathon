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
} & ({ dirty?: false; onDiscard?: never } | {
  dirty: boolean;
  /** Called only after explicit discard confirmation. Reset the local draft here. */
  onDiscard: () => void;
});

export function Dialog({ open, onOpenChange, title, description, children, footer, dirty = false, onDiscard, initialFocus, returnFocus, placement = "center", className = "" }: DialogProps) {
  const t = useTranslations();
  const [closeState, dispatch] = useReducer(dialogCloseReducer, "editing");
  const [previousOpen, setPreviousOpen] = useState(open);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const store = Ariakit.useDialogStore({ open, setOpen: onOpenChange });
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
      onClose={(event) => {
        const next = dialogCloseReducer(closeState, { type: "request-close", dirty });
        if (next === "confirming-discard") event.preventDefault();
        dispatch({ type: "request-close", dirty });
      }}
    >
      <div className="tl-dialog__header">
        <div className="tl-dialog__heading-group"><Ariakit.DialogHeading className="tl-dialog__title" render={<h2 />}>{title}</Ariakit.DialogHeading>{description && <Ariakit.DialogDescription className="tl-dialog__description">{description}</Ariakit.DialogDescription>}</div>
        <Ariakit.DialogDismiss render={<IconButton icon={X} label={t("common.actions.close")} />} />
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
        <Button variant="danger" onClick={() => { onDiscard?.(); dispatch({ type: "discard" }); onOpenChange(false); }}>{t("common.dialog.discard")}</Button>
      </div>
      </Ariakit.Dialog>
    </Ariakit.Dialog>;
}

/** Use for footer cancellation so dirty protection is the same as Escape and the close icon. */
export function DialogClose(props: ButtonProps) {
  return <Ariakit.DialogDismiss render={<Button {...props} />} />;
}
