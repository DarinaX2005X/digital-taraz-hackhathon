"use client";

import { FileClock, GitBranch, History, RotateCcw } from "lucide-react";
import { formatInstant } from "@/i18n";
import { useLocale } from "@/i18n/provider";
import { EmptyState } from "@/ui";
import type { ArtifactHistory, ArtifactVersion } from "../contracts";
import { useArtifactTranslations } from "./common";
import styles from "./artifacts.module.css";

export function ArtifactHistoryList({ history, selectedId, onSelect }: { history: ArtifactHistory; selectedId?: string; onSelect: (groupId: string) => void }) {
  const t = useArtifactTranslations();
  const { locale } = useLocale();
  if (!history.groups.length) return <EmptyState title={t("artifacts.history.empty")} description={t("artifacts.history.emptyDescription")} icon={History} />;
  return <ol className={styles.timeline} aria-label={t("artifacts.history.changes")}>{history.groups.map((group) => <li key={group.commandGroupId}><button type="button" className={styles.timelineItem} aria-current={group.commandGroupId === selectedId ? "true" : undefined} onClick={() => onSelect(group.commandGroupId)}><span className={styles.timelineIcon}>{group.state === "undone" ? <RotateCcw size={18} aria-hidden="true" /> : <History size={18} aria-hidden="true" />}</span><span className={styles.timelineContent}><strong>{group.reason}</strong><span className={styles.meta}>{group.actorId === history.viewer.userId ? t("artifacts.history.you") : group.actorName ?? t("artifacts.history.member")}{group.origin !== "human" && <> · {group.origin === "ai" ? t("artifacts.history.ai") : t("artifacts.history.imported")}</>}</span><time className={styles.meta} dateTime={group.createdAt}>{formatInstant(locale, group.createdAt)}</time>{group.state === "undone" && <span className={styles.tag}>{t("artifacts.history.undone")}</span>}</span></button></li>)}</ol>;
}

export function ArtifactVersionList({ versions, selectedRevision, currentRevision, onSelect }: { versions: ArtifactVersion[]; selectedRevision?: number; currentRevision: number; onSelect: (revision: number) => void }) {
  const t = useArtifactTranslations();
  const { locale } = useLocale();
  if (!versions.length) return <EmptyState title={t("artifacts.versions.empty")} icon={FileClock} />;
  return <ol className={styles.timeline} aria-label={t("artifacts.history.versions")}>{versions.map((version) => <li key={version.id}><button type="button" className={styles.timelineItem} aria-current={version.revision === selectedRevision ? "true" : undefined} onClick={() => onSelect(version.revision)}><span className={styles.timelineIcon}>{version.branchParent ? <GitBranch size={18} aria-hidden="true" /> : <FileClock size={18} aria-hidden="true" />}</span><span className={styles.timelineContent}><strong>{t("artifacts.versions.version", { revision: version.revision })}</strong><span>{version.reason}</span><time className={styles.meta} dateTime={version.createdAt}>{formatInstant(locale, version.createdAt)}</time>{version.revision === currentRevision && <span className={styles.tag}>{t("artifacts.versions.current")}</span>}</span></button></li>)}</ol>;
}
