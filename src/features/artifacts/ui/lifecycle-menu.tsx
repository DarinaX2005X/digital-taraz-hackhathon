"use client";

import * as Ariakit from "@ariakit/react";
import { Archive, Copy, MoreHorizontal, MoveRight, PencilLine, Trash2, Undo2 } from "lucide-react";
import { IconButton } from "@/ui";
import type { ArtifactOperation } from "../client/operations";
import type { ArtifactSnapshot } from "../contracts";
import { useArtifactTranslations } from "./common";
import styles from "./artifacts.module.css";

export type ArtifactLifecycleKind = Exclude<ArtifactOperation["kind"], "undo" | "redo" | "branch" | "restore-version">;

const items = [
  { kind: "rename", icon: PencilLine },
  { kind: "duplicate", icon: Copy },
  { kind: "move", icon: MoveRight },
  { kind: "archive", icon: Archive },
  { kind: "restore", icon: Undo2 },
  { kind: "trash", icon: Trash2 },
  { kind: "purge", icon: Trash2 },
] as const;

/** Shared lifecycle entry point. The owning page prepares and runs the reviewed
 * operation through ArtifactSession so uncertain requests remain recoverable. */
export function ArtifactLifecycleMenu({ snapshot, disabled, onAction }: {
  snapshot: ArtifactSnapshot;
  disabled: boolean;
  onAction: (kind: ArtifactLifecycleKind) => void;
}) {
  const t = useArtifactTranslations();
  return <Ariakit.MenuProvider>
    <Ariakit.MenuButton render={<IconButton icon={MoreHorizontal} label={t("artifacts.actions.more")} />} />
    <Ariakit.Menu gutter={8} portal className={styles.menu}>
      {items.filter((item) => snapshot.permissions[item.kind]).map(({ kind, icon: Icon }) => <Ariakit.MenuItem key={kind} className={styles.menuItem} disabled={disabled} onClick={() => onAction(kind)}><Icon size={18} aria-hidden="true" />{t(`artifacts.actions.${kind}`)}</Ariakit.MenuItem>)}
    </Ariakit.Menu>
  </Ariakit.MenuProvider>;
}
