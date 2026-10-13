"use client";

import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useTranslations } from "@/i18n/provider";

export type FieldContent = { label: string; hint?: ReactNode; error?: string; unit?: string };

export function fieldDescriptionIds(id: string, options: { hint?: unknown; error?: unknown; unit?: unknown; describedBy?: string }): string | undefined {
  return [options.describedBy, options.hint ? `${id}-hint` : null, options.unit ? `${id}-unit` : null, options.error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function FieldLabel({ id, label, required }: { id: string; label: string; required?: boolean }) {
  const t = useTranslations();
  return <label className="tl-field__label" htmlFor={id}>{label}{required && <><span aria-hidden="true"> *</span><span className="tirlik-sr-only"> ({t("common.fields.required")})</span></>}</label>;
}

export function FieldMessages({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return <div className="tl-field__messages">
    {hint && <div className="tl-field__hint" id={`${id}-hint`}>{hint}</div>}
    {error && <div className="tl-field__error" id={`${id}-error`}><AlertCircle aria-hidden="true" size={18} /><span>{error}</span></div>}
  </div>;
}

type InputFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & FieldContent & { ref?: Ref<HTMLInputElement> };

export function InputField({ id: suppliedId, label, hint, error, unit, className = "", required, ref, ...props }: InputFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <div className={`tl-field ${className}`}>
    <FieldLabel id={id} label={label} required={required} />
    <div className="tl-field__control" data-invalid={Boolean(error) || undefined} data-disabled={props.disabled || undefined}>
      <input {...props} ref={ref} id={id} required={required} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={fieldDescriptionIds(id, { hint, error, unit, describedBy: props["aria-describedby"] })} />
      {unit && <span className="tl-field__unit" id={`${id}-unit`}>{unit}</span>}
    </div>
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}

type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldContent, "unit"> & { ref?: Ref<HTMLTextAreaElement> };

export function TextareaField({ id: suppliedId, label, hint, error, className = "", required, ref, rows = 4, ...props }: TextareaFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <div className={`tl-field ${className}`}>
    <FieldLabel id={id} label={label} required={required} />
    <textarea {...props} className="tl-textarea" ref={ref} rows={rows} id={id} required={required} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={fieldDescriptionIds(id, { hint, error, describedBy: props["aria-describedby"] })} />
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & Omit<FieldContent, "unit"> & { ref?: Ref<HTMLSelectElement> };

export function SelectField({ id: suppliedId, label, hint, error, className = "", required, ref, children, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <div className={`tl-field ${className}`}>
    <FieldLabel id={id} label={label} required={required} />
    <div className="tl-field__control" data-invalid={Boolean(error) || undefined} data-disabled={props.disabled || undefined}>
      <select {...props} ref={ref} id={id} required={required} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={fieldDescriptionIds(id, { hint, error, describedBy: props["aria-describedby"] })}>{children}</select>
      <ChevronDown aria-hidden="true" size={18} className="tl-select__arrow" />
    </div>
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}

type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & Omit<FieldContent, "unit"> & { ref?: Ref<HTMLInputElement> };

export function CheckboxField({ id: suppliedId, label, hint, error, className = "", required, ref, ...props }: CheckboxFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <div className={`tl-field tl-checkbox-field ${className}`}>
    <div className="tl-checkbox-field__row">
      <span className="tl-checkbox-field__target">
        <input {...props} ref={ref} id={id} type="checkbox" required={required} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={fieldDescriptionIds(id, { hint, error, describedBy: props["aria-describedby"] })} />
        <span className="tl-checkbox-field__box" aria-hidden="true"><Check size={18} /></span>
      </span>
      <FieldLabel id={id} label={label} required={required} />
    </div>
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}
