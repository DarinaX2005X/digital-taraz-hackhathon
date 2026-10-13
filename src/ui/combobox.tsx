"use client";

import * as Ariakit from "@ariakit/react";
import { Check, ChevronDown, LoaderCircle, RotateCw, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "@/i18n/provider";
import { Button, IconButton } from "./button";
import { FieldLabel, FieldMessages, fieldDescriptionIds, type FieldContent } from "./field";
import { createOptionSearch, selectedOption, type OptionLoader, type SelectOption } from "./state/option-search";

export type { SelectOption, OptionLoader } from "./state/option-search";
export type ComboboxProps = FieldContent & {
  id?: string;
  name?: string;
  value: SelectOption | null;
  onChange: (option: SelectOption | null) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
} & ({ options: readonly SelectOption[]; loadOptions?: never } | { options?: never; loadOptions: OptionLoader });

export function Combobox({ id: suppliedId, name, label, hint, error, value, onChange, required, disabled, placeholder, className = "", options, loadOptions }: ComboboxProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations();
  const { locale } = useLocale();
  const [controller] = useState(() => createOptionSearch(250));
  const search = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const loader = useMemo<OptionLoader>(() => loadOptions ?? (async (query) => {
    const normalized = query.normalize("NFKC").toLocaleLowerCase(locale);
    return (options ?? []).filter((option) => option.label.normalize("NFKC").toLocaleLowerCase(locale).includes(normalized));
  }), [loadOptions, options, locale]);

  useEffect(() => { controller.setLoader(loader); }, [controller, loader]);
  useEffect(() => () => controller.cancel(), [controller]);
  const selectionError = touched && !value && Boolean(search.query) ? t("common.fields.chooseOption") : undefined;
  const visibleError = error ?? selectionError;
  const busy = search.phase === "loading" || search.phase === "debouncing";
  const emptyMessage = search.query.trim() ? t("common.fields.noMatches") : t("common.fields.noOptions");
  useEffect(() => {
    inputRef.current?.setCustomValidity(!value && (required || search.query) ? t("common.fields.chooseOption") : "");
  }, [value, required, search.query, t]);

  const combobox = Ariakit.useComboboxStore({
    inputValue: value?.label ?? search.query,
    selectedValue: value?.id ?? "",
    setInputValue: (query) => controller.search(query),
    open,
    setOpen: (next) => {
      setOpen(next);
      if (!next) controller.cancel();
    },
    resetValueOnHide: false,
    resetValueOnSelect: false,
  });

  const choose = (id: string) => {
    const option = selectedOption(controller.getSnapshot(), id);
    if (!option) return;
    inputRef.current?.setCustomValidity("");
    onChange(option);
    setTouched(false);
  };
  const beginSearch = () => {
    controller.search(value ? "" : controller.getSnapshot().query, true);
    combobox.show();
  };

  return <div ref={fieldRef} className={`tl-field ${className}`}>
    <FieldLabel id={id} label={label} required={required} />
    <div className="tl-field__control tl-combobox__control" data-invalid={Boolean(visibleError) || undefined} data-disabled={disabled || undefined}>
      <Ariakit.Combobox
        store={combobox}
        ref={inputRef}
        id={id}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={Boolean(visibleError) || undefined}
        aria-describedby={fieldDescriptionIds(id, { hint, error: visibleError })}
        onFocus={beginSearch}
        onClick={() => { if (controller.getSnapshot().phase === "idle") beginSearch(); }}
        onChange={() => { onChange(null); inputRef.current?.setCustomValidity(t("common.fields.chooseOption")); }}
        onBlur={() => setTouched(true)}
        autoSelect={false}
      />
      <span className="tl-combobox__progress">{busy && <LoaderCircle className="tl-spin" aria-hidden="true" size={18} />}</span>
      <span className="tl-combobox__clear" data-empty={!(value || search.query) || undefined}><IconButton icon={X} label={t("common.actions.clear")} disabled={disabled || !(value || search.query)} onClick={() => { onChange(null); controller.search("", true); setTouched(false); inputRef.current?.focus(); }} /></span>
      <IconButton icon={ChevronDown} label={t("common.actions.choose")} disabled={disabled} aria-expanded={open} onClick={() => { if (open) combobox.hide(); else { inputRef.current?.focus(); if (!combobox.getState().open) beginSearch(); } }} />
    </div>
    {name && <input type="hidden" name={name} value={value?.id ?? ""} disabled={disabled} />}
    <Ariakit.ComboboxPopover store={combobox} sameWidth gutter={4} portal className="tl-combobox__popover" aria-busy={busy || undefined} hideOnInteractOutside={(event) => !(event.target instanceof Node && fieldRef.current?.contains(event.target))}>
      {search.options.map((option) => <Ariakit.ComboboxItem
        key={option.id}
        store={combobox}
        value={option.id}
        disabled={option.disabled || search.phase !== "ready"}
        setValueOnClick={false}
        selectValueOnClick={false}
        className="tl-combobox__option"
        onClick={() => choose(option.id)}
      >
        <span className="tl-combobox__option-text"><span>{option.label}</span>{option.description && <span className="tl-combobox__option-description">{option.description}</span>}</span>
        <span className="tl-combobox__check">{value?.id === option.id && <Check aria-hidden="true" size={18} />}</span>
      </Ariakit.ComboboxItem>)}
      {!search.options.length && <div role="option" aria-selected={false} aria-disabled="true" className="tl-combobox__empty">{busy ? t("common.fields.searching") : search.phase === "error" ? t("common.errors.loadFailed") : emptyMessage}</div>}
    </Ariakit.ComboboxPopover>
    <FieldMessages id={id} hint={hint} error={visibleError} />
    <span role="status" className="tirlik-sr-only">{busy ? t("common.fields.searching") : search.phase === "ready" && !search.options.length ? emptyMessage : ""}</span>
    {search.phase === "error" && <div className="tl-inline-recovery"><span>{t("common.errors.loadFailed")}</span><Button icon={RotateCw} onClick={() => { controller.retry(); combobox.show(); }}>{t("common.actions.retry")}</Button></div>}
  </div>;
}
