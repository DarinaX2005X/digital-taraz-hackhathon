"use client";

import { ArrowLeft, ArrowRight, Check, Image as ImageIcon, Layers, Minus } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { formatCalendarDate, formatInstant, formatNumber } from "@/i18n";
import { useLocale } from "@/i18n/provider";
import { Button, EmptyState, IconButton, SelectField, TableFrame } from "@/ui";
import type { ArtifactContent, DesignLayer, DocumentNode } from "../domain/content-models";
import { useArtifactTranslations } from "./common";
import { columnLabel, documentBlocks, documentCellSpans, documentFieldValue, previewCell } from "./preview-model";
import styles from "./artifacts.module.css";

function DocumentNodeView({ node }: { node: DocumentNode }) {
  const t = useArtifactTranslations();
  const children = node.content?.map((child, index) => <DocumentNodeView key={typeof child.attrs?.id === "string" ? child.attrs.id : index} node={child} />);
  if (node.type === "text") {
    let text: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = <strong>{text}</strong>;
      if (mark.type === "italic") text = <em>{text}</em>;
      if (mark.type === "underline") text = <u>{text}</u>;
      if (mark.type === "strike") text = <s>{text}</s>;
      if (mark.type === "code") text = <code>{text}</code>;
    }
    return text;
  }
  switch (node.type) {
    case "doc": return <>{children}</>;
    case "paragraph": return <p>{children ?? <br />}</p>;
    case "heading": return node.attrs?.level === 1 ? <h3>{children}</h3> : node.attrs?.level === 2 ? <h4>{children}</h4> : <h5>{children}</h5>;
    case "bulletList": return <ul>{children}</ul>;
    case "orderedList": return <ol start={typeof node.attrs?.start === "number" && Number.isSafeInteger(node.attrs.start) ? node.attrs.start : undefined}>{children}</ol>;
    case "listItem": return <li>{children}</li>;
    case "blockquote": return <blockquote>{children}</blockquote>;
    case "hardBreak": return <br />;
    case "pageBreak": return <hr />;
    case "dataField": return <span className={styles.dataField}>{documentFieldValue(node) ?? t("artifacts.preview.field")}</span>;
    case "table": return <TableFrame label={t("artifacts.kinds.table")} minWidth={400}><table><tbody>{children}</tbody></table></TableFrame>;
    case "tableRow": return <tr>{children}</tr>;
    case "tableHeader": return <th {...documentCellSpans(node)}>{children}</th>;
    case "tableCell": return <td {...documentCellSpans(node)}>{children}</td>;
    case "image": return <figure className={styles.imagePlaceholder}><ImageIcon size={24} aria-hidden="true" /><figcaption>{typeof node.attrs?.alt === "string" ? node.attrs.alt : t("artifacts.preview.image")}<span className={styles.meta}>{t("artifacts.preview.imageUnavailable")}</span></figcaption></figure>;
  }
}

function DocumentPreview({ content }: { content: Extract<ArtifactContent, { kind: "document" }> }) {
  const [shown, setShown] = useState(80);
  const t = useArtifactTranslations();
  const blocks = documentBlocks(content);
  return <div className={styles.document}>{blocks.slice(0, shown).map((node, index) => <DocumentNodeView node={node} key={typeof node.attrs?.id === "string" ? node.attrs.id : index} />)}{shown < blocks.length && <Button onClick={() => setShown((count) => count + 80)}>{t("artifacts.preview.more")}</Button>}</div>;
}

function TablePreview({ content }: { content: Extract<ArtifactContent, { kind: "table" }> }) {
  const t = useArtifactTranslations();
  const [selectedSheet, setSelectedSheet] = useState(content.workbook.sheetOrder[0]!);
  const [start, setStart] = useState(0);
  const sheetId = content.workbook.sheets[selectedSheet] ? selectedSheet : content.workbook.sheetOrder[0]!;
  const sheet = content.workbook.sheets[sheetId];
  if (!sheet) return <EmptyState title={t("artifacts.preview.empty")} />;
  const first = Math.min(start, Math.max(0, sheet.rowCount - 1));
  const end = Math.min(first + 50, sheet.rowCount);
  return <div className={styles.stack}>
    <SelectField label={t("artifacts.kinds.table")} value={sheetId} onChange={(event) => { setSelectedSheet(event.target.value); setStart(0); }}>{content.workbook.sheetOrder.map((id) => <option key={id} value={id}>{content.workbook.sheets[id]?.name ?? id}</option>)}</SelectField>
    <TableFrame label={sheet.name} minWidth={Math.min(1200, Math.max(400, sheet.columnCount * 120))}><table className={styles.sheet}><caption className="tirlik-sr-only">{sheet.name}</caption><thead><tr><th scope="col">{t("artifacts.preview.row")}</th>{Array.from({ length: sheet.columnCount }, (_, index) => <th scope="col" key={index}>{columnLabel(index)}</th>)}</tr></thead><tbody>{Array.from({ length: end - first }, (_, offset) => {
      const row = first + offset;
      return <tr key={content.stableIds[sheetId]?.rows[row] ?? row}><th scope="row">{row + 1}</th>{Array.from({ length: sheet.columnCount }, (_, column) => {
        const cell = previewCell(sheet.cellData[String(row)]?.[String(column)]);
        return <td key={column}><span>{cell.missingResult ? t("artifacts.preview.resultMissing") : cell.value}</span>{cell.formula && <span className={styles.formula}><span className="tirlik-sr-only">{t("artifacts.preview.formula")}: </span>{cell.formula}</span>}</td>;
      })}</tr>;
    })}</tbody></table></TableFrame>
    <div className={styles.pagination}><span>{t("artifacts.preview.range", { start: first + 1, end, total: sheet.rowCount })}</span><IconButton icon={ArrowLeft} label={t("artifacts.preview.previous")} disabled={first === 0} onClick={() => setStart(Math.max(0, first - 50))} /><IconButton icon={ArrowRight} label={t("artifacts.preview.next")} disabled={end >= sheet.rowCount} onClick={() => setStart(end)} /></div>
  </div>;
}

function LayerView({ layer }: { layer: DesignLayer }) {
  const t = useArtifactTranslations();
  const { locale } = useLocale();
  const label = layer.type === "image" ? t("artifacts.preview.imageLayer") : t(`artifacts.preview.${layer.type}`);
  return <li className={styles.layer}><div className={styles.layerHeading}><strong>{label}</strong>{layer.hidden && <span className={styles.tag}>{t("artifacts.preview.hidden")}</span>}</div>{layer.text && <p className={styles.layerText}>{layer.text}</p>}<dl className={styles.propertyList}><div><dt>{t("artifacts.preview.position")}</dt><dd>{formatNumber(locale, layer.transform.x)}, {formatNumber(locale, layer.transform.y)}</dd></div><div><dt>{t("artifacts.preview.size")}</dt><dd>{formatNumber(locale, layer.transform.width)} × {formatNumber(locale, layer.transform.height)}</dd></div><div><dt>{t("artifacts.preview.rotation")}</dt><dd>{formatNumber(locale, layer.transform.rotation)}°</dd></div></dl>{layer.layers?.length ? <details><summary>{t("artifacts.preview.layers")} ({layer.layers.length})</summary><ul className={styles.layerList}>{layer.layers.map((child) => <LayerView key={child.id} layer={child} />)}</ul></details> : null}</li>;
}

function DesignPreview({ content }: { content: Extract<ArtifactContent, { kind: "design" }> }) {
  const t = useArtifactTranslations();
  const [pageIndex, setPageIndex] = useState(0);
  const page = content.pages[Math.min(pageIndex, content.pages.length - 1)]!;
  return <div className={styles.stack}><SelectField label={t("artifacts.kinds.design")} value={pageIndex} onChange={(event) => setPageIndex(Number(event.target.value))}>{content.pages.map((page, index) => <option key={page.id} value={index}>{t("artifacts.preview.page", { number: index + 1 })}</option>)}</SelectField><div className={styles.previewHeading}><Layers aria-hidden="true" size={20} /><h3>{t("artifacts.preview.layers")}</h3><span className={styles.meta}>{page.width} × {page.height} {page.unit}</span></div>{page.layers.length ? <ul className={styles.layerList}>{page.layers.map((layer) => <LayerView layer={layer} key={layer.id} />)}</ul> : <EmptyState title={t("artifacts.preview.empty")} />}</div>;
}

function PlanPreview({ content }: { content: Extract<ArtifactContent, { kind: "plan" }> }) {
  const t = useArtifactTranslations();
  const { locale } = useLocale();
  const [shown, setShown] = useState(50);
  if (!content.entries.length) return <EmptyState title={t("artifacts.preview.empty")} />;
  return <div className={styles.stack}><TableFrame label={t("artifacts.kinds.plan")} minWidth={640}><table><thead><tr><th scope="col">{t("artifacts.preview.task")}</th><th scope="col">{t("artifacts.preview.status")}</th><th scope="col">{t("artifacts.preview.dates")}</th></tr></thead><tbody>{content.entries.slice(0, shown).map((entry) => <tr key={entry.id}><th scope="row"><p>{entry.title}</p>{entry.notes && <p className={styles.planNotes}>{entry.notes}</p>}{entry.checklist.length > 0 && <ul className={styles.checklist}>{entry.checklist.map((item) => <li key={item.id}>{item.done ? <Check size={16} aria-label={t("artifacts.preview.checked")} /> : <Minus size={16} aria-label={t("artifacts.preview.unchecked")} />}<span>{item.text}</span></li>)}</ul>}</th><td>{t(`artifacts.preview.${entry.status}`)}</td><td>{entry.startDate ? formatCalendarDate(locale, entry.startDate) : entry.startAt ? formatInstant(locale, entry.startAt, { dateStyle: "medium", timeStyle: "short", timeZone: content.timezone }) : t("artifacts.preview.noDate")}{(entry.endDate || entry.endAt) && <><br />{entry.endDate ? formatCalendarDate(locale, entry.endDate) : formatInstant(locale, entry.endAt!, { dateStyle: "medium", timeStyle: "short", timeZone: content.timezone })}</>}</td></tr>)}</tbody></table></TableFrame>{shown < content.entries.length && <Button onClick={() => setShown((count) => count + 50)}>{t("artifacts.preview.more")}</Button>}</div>;
}

export function ArtifactContentPreview({ content, contentKey }: { content: ArtifactContent; contentKey: string }) {
  const t = useArtifactTranslations();
  return <section aria-label={t("artifacts.versions.readOnly")} className={styles.preview}><Fragment key={contentKey}>{content.kind === "document" ? <DocumentPreview content={content} /> : content.kind === "table" ? <TablePreview content={content} /> : content.kind === "design" ? <DesignPreview content={content} /> : <PlanPreview content={content} />}</Fragment></section>;
}
