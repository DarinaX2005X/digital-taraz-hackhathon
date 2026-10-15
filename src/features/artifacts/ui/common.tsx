"use client";

import { AlertCircle } from "lucide-react";
import { useMemo } from "react";
import { useLocale } from "@/i18n/provider";
import { ArtifactRequestError } from "../client/transport";
import { ArtifactStorageError } from "../client/indexed-db";
import { PrivacyBoundaryError } from "../client/privacy";
import { artifactTranslator, type ArtifactMessageKey } from "../locales";
import styles from "./artifacts.module.css";

export function useArtifactTranslations() {
  const { locale } = useLocale();
  return useMemo(() => artifactTranslator(locale), [locale]);
}

export function artifactErrorKey(error: unknown): ArtifactMessageKey {
  if (error instanceof PrivacyBoundaryError) return "artifacts.recovery.access";
  if (error instanceof ArtifactStorageError) return error.reason === "blocked" ? "artifacts.recovery.changed" : "artifacts.recovery.storage";
  if (error instanceof ArtifactRequestError) {
    if (error.status === 401) return "artifacts.recovery.auth";
    if (error.status === 403 || error.status === 404) return "artifacts.errors.forbidden";
    if (error.status === 409) return "artifacts.errors.conflict";
    if (error.status === 429) return "artifacts.errors.rateLimited";
    if (error.status === 400 || error.status === 422) return "artifacts.errors.validation";
    if (error.kind === "network") return "artifacts.errors.network";
    if (error.kind === "timeout") return "artifacts.errors.timeout";
    if (error.kind === "invalid-response") return "artifacts.errors.invalid";
    if (error.status >= 500) return "artifacts.errors.unavailable";
  }
  return "artifacts.errors.generic";
}

export function ArtifactError({ error }: { error: unknown }) {
  const t = useArtifactTranslations();
  if (!error) return null;
  return <div role="alert" className={styles.error}><AlertCircle size={20} aria-hidden="true" /><div><p>{t(artifactErrorKey(error))}</p>{error instanceof ArtifactRequestError && error.envelope?.requestId && <p className={styles.meta}>{t("artifacts.errors.requestId", { id: error.envelope.requestId })}</p>}</div></div>;
}
