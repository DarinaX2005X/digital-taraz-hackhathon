"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button, ErrorState, LocaleSelect, ProductHeader } from "@/ui";
import { useArtifactTranslations } from "@/features/artifacts/ui/common";

export default function Error({ reset }: { reset: () => void }) {
  const t = useArtifactTranslations();
  return <><ProductHeader homeLabel={t("artifacts.navigation.home")}><LocaleSelect compact /></ProductHeader><main className="tl-page"><ErrorState title={t("artifacts.errors.unavailable")} action={<><Button icon={RefreshCw} onClick={reset}>{t("artifacts.actions.retry")}</Button><Link href="/">{t("artifacts.navigation.home")}</Link></>} /></main></>;
}
