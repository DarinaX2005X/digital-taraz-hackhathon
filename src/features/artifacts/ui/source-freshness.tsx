"use client";

import { CheckCircle2, CircleHelp, Link2, LockKeyhole, PencilLine, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import type { ArtifactSnapshot, ArtifactVersionDetail } from "../contracts";
import { createArtifactTargetResolver } from "../domain/targets";
import { useArtifactTranslations } from "./common";
import { textValue } from "./preview-model";
import styles from "./artifacts.module.css";

export function SourceFreshnessPanel({ snapshot }: { snapshot: ArtifactSnapshot | ArtifactVersionDetail }) {
  const t = useArtifactTranslations();
  const resolver = useMemo(() => createArtifactTargetResolver(snapshot.content, snapshot.artifact.bindings, snapshot.locks ?? {}), [snapshot.content, snapshot.artifact.bindings, snapshot.locks]);
  const targetIds = [...new Set([...snapshot.artifact.bindings.map((binding) => binding.targetElementId), ...Object.keys(snapshot.locks ?? {})])];
  return <section className={styles.sources} aria-label={t("artifacts.sources.title")}>
    <h2 className={styles.sectionHeading}><Link2 size={18} aria-hidden="true" />{t("artifacts.sources.title")}</h2>
    {snapshot.sourceFreshness.length ? <ul className={styles.sourceList}>{snapshot.sourceFreshness.map((source, index) => {
      const Icon = source.status === "current" ? CheckCircle2 : source.status === "stale" ? TriangleAlert : CircleHelp;
      return <li key={`${source.sourceRef.sourceId}/${source.sourceRef.sourceVersionId}/${index}`}><span>{t("artifacts.sources.source", { number: index + 1 })}</span><span className={styles.freshness} data-status={source.status}><Icon size={17} aria-hidden="true" />{t(`artifacts.sources.${source.status}`)}</span><span className={styles.meta}>{t("artifacts.sources.revision", { revision: source.sourceRef.revision })}</span></li>;
    })}</ul> : <p className={styles.meta}>{t("artifacts.sources.none")}</p>}
    {targetIds.length > 0 && <ul className={styles.sourceList}>{targetIds.map((targetId, index) => {
      const target = resolver(targetId);
      const binding = snapshot.artifact.bindings.find((entry) => entry.targetElementId === targetId);
      const lock = snapshot.locks?.[targetId] ?? binding?.lock;
      const manual = binding?.override;
      const value = target ? textValue(target.value) : "";
      return <li key={targetId}><strong>{t("artifacts.sources.target", { number: index + 1 })}</strong>{value && <p className={styles.sourceValue}>{value}</p>}{lock && <div className={styles.bindingNotice}><LockKeyhole size={16} aria-hidden="true" /><div><strong>{t("artifacts.sources.locked")}</strong><p>{lock.reason}</p></div></div>}{(manual || binding?.updateMode === "manual") && <div className={styles.bindingNotice}><PencilLine size={16} aria-hidden="true" /><div><strong>{t("artifacts.sources.manual")}</strong>{manual && <p>{manual.reason}</p>}</div></div>}</li>;
    })}</ul>}
  </section>;
}
