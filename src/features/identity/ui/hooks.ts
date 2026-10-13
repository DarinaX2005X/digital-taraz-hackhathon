"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale } from "@/i18n/provider";
import { identityTranslator } from "../locales";
import { createIdentityOperation } from "./operation";

export function useIdentityTranslations() {
  const { locale } = useLocale();
  return useMemo(() => identityTranslator(locale), [locale]);
}

export function useIdentityOperation<T>() {
  const [operation] = useState(() => createIdentityOperation<T>());
  const snapshot = useSyncExternalStore(operation.subscribe, operation.getSnapshot, operation.getSnapshot);
  useEffect(() => () => operation.cancel(), [operation]);
  return { ...snapshot, run: operation.run, cancel: operation.cancel, clear: operation.clear };
}
