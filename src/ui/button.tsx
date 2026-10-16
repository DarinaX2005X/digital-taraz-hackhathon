"use client";

import * as Ariakit from "@ariakit/react";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  pending?: boolean;
  /** Both labels reserve their space so a pending command does not resize. */
  pendingLabel?: ReactNode;
  disabledReason?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "secondary", icon: Icon, pending, pendingLabel, disabled, disabledReason, children, className = "", ref, type = "button", ...props }: ButtonProps) {
  const reasonId = useId();
  const describedBy = [props["aria-describedby"], disabled && disabledReason ? reasonId : null].filter(Boolean).join(" ") || undefined;
  const progressWithoutIcon = !Icon && pending;
  const canShowProgressWithoutIcon = !Icon && pending !== undefined;
  return <>
    <Ariakit.Button
      {...props}
      ref={ref}
      type={type}
      className={`tl-button tl-button--${variant} ${className}`}
      disabled={disabled || pending}
      accessibleWhenDisabled={Boolean(disabledReason) || pending}
      aria-busy={pending || undefined}
      aria-describedby={describedBy}
      data-pending={pending || undefined}
      data-progress-capable={canShowProgressWithoutIcon || undefined}
    >
      {Icon && <span className="tl-button__icon">
        <Icon className="tl-button__rest-icon" aria-hidden="true" size={20} />
        {pending && <LoaderCircle className="tl-button__progress tl-spin" aria-hidden="true" size={20} />}
      </span>}
      {progressWithoutIcon && <LoaderCircle className="tl-button__progress tl-button__progress--standalone tl-spin" aria-hidden="true" size={20} />}
      <span className="tl-button__label">
        <span aria-hidden={pending && pendingLabel !== undefined ? true : undefined}>{children}</span>
        {pendingLabel !== undefined && <span aria-hidden={!pending ? true : undefined}>{pendingLabel}</span>}
      </span>
    </Ariakit.Button>
    {disabled && disabledReason && <span id={reasonId} className="tirlik-sr-only">{disabledReason}</span>}
  </>;
}

export type IconButtonProps = Omit<ButtonProps, "children" | "icon" | "aria-label" | "pendingLabel"> & {
  icon: LucideIcon;
  label: string;
  tooltip?: ReactNode;
};

export function IconButton({ icon: Icon, label, tooltip, variant = "quiet", pending = false, disabled, disabledReason, className = "", ref, type = "button", ...props }: IconButtonProps) {
  const reasonId = useId();
  const describedBy = [props["aria-describedby"], disabled && disabledReason ? reasonId : null].filter(Boolean).join(" ") || undefined;
  return <Ariakit.TooltipProvider showTimeout={350} hideTimeout={100}>
    <Ariakit.TooltipAnchor
      render={<Ariakit.Button
        {...props}
        ref={ref}
        type={type}
        className={`tl-button tl-icon-button tl-button--${variant} ${className}`}
        disabled={disabled || pending}
        accessibleWhenDisabled
        aria-label={label}
        aria-describedby={describedBy}
        aria-busy={pending || undefined}
      />}
    >
      {pending ? <LoaderCircle className="tl-spin" aria-hidden="true" size={20} /> : <Icon aria-hidden="true" size={20} />}
    </Ariakit.TooltipAnchor>
    <Ariakit.Tooltip className="tl-tooltip" gutter={8} portal>{disabled && disabledReason ? disabledReason : tooltip ?? label}</Ariakit.Tooltip>
    {disabled && disabledReason && <span id={reasonId} className="tirlik-sr-only">{disabledReason}</span>}
  </Ariakit.TooltipProvider>;
}
