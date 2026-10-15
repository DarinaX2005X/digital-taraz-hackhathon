'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Link2, Table2, FilePlus2, Search, Settings2, Undo2, Redo2, Save, X, Lock, Unlock, ImagePlus, Database, Eraser } from 'lucide-react';
import { useLocale } from '@/i18n/provider';
import { Button, IconButton, Dialog, InputField, LoadingState } from '@/ui';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import type { ArtifactOperation } from '@/features/artifacts/client/operations';
import { ArtifactError } from '@/features/artifacts/ui/common';
import { createDocumentController } from '../client/controller';
import { documentExtensions } from '../client/extensions';
import { documentFindKey, findDocumentText } from '../client/find';
import { documentLock } from '../domain/commands';
import { asJson, fromEditorJson } from '../domain/document';
import { importDocumentHtml, safeDocumentLink, type DocumentImport } from '../domain/import-html';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { documentCopies, lossCopyKeys, type DocumentCopy } from '../locales';
import { DocumentImagePicker, DocumentFactPicker, currentDocumentFact, type DocumentFact } from './document-pickers';
import { bindDocumentField, changeDocumentField, materialText, replaceDocumentFieldValue } from '../domain/fields';
import { DocumentFieldContext } from './document-field-context';
import styles from './documents.module.css';

export interface DocumentEditorProps {
  session: ArtifactSession;
  onFlushReady?: (flush: (() => Promise<boolean>) | null) => void;
  resources?: boolean;
}

/** The route owns the session and title/export/version actions. The editor owns no second history. */
export function DocumentEditor({ session, onFlushReady, resources = true }: DocumentEditorProps) {
  const { locale } = useLocale(), t = documentCopies[locale];
  const [controller] = useState(() => createDocumentController(session, () => t.manualReason));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const snapshot = sessionState.snapshot;
  const [error, setError] = useState<unknown>();
  const [editError, setEditError] = useState(false);
  const [pasteLosses, setPasteLosses] = useState<DocumentImport['losses']>([]);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false), [activeMatch, setActiveMatch] = useState(0);
  const [inspector, setInspector] = useState(false), [linkOpen, setLinkOpen] = useState(false), [linkAddress, setLinkAddress] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [imageOpen, setImageOpen] = useState(false), [fieldOpen, setFieldOpen] = useState(false), [fieldDraft, setFieldDraft] = useState<{ id: string; value: string }>();
  const [fieldBusy, setFieldBusy] = useState(false);
  const fieldPosition = useRef<{ from: number; to: number; contentHash: string } | null>(null);
  const [historyReview, setHistoryReview] = useState<{ operation: ArtifactOperation; titles: string[]; label: string }>();
  const canEdit = Boolean(snapshot?.permissions.edit && sessionState.storageReady && ['ready', 'dirty', 'saving'].includes(state.phase) && !historyBusy && !historyReview && !fieldBusy && !sessionState.operation.operation);
  const history = useCallback(async (action: 'undo' | 'redo') => {
    if (historyBusy || !session.getSnapshot().snapshot?.permissions.edit) return;
    setHistoryBusy(true); setError(undefined);
    try {
      if (!await controller.flush()) return;
      const current = session.getSnapshot().snapshot!;
      const group = current.history.find((item) => action === 'undo' ? item.canUndo : item.canRedo);
      if (!group) return;
      const prepared = await session.prepareHistory(action, group.commandGroupId);
      if (prepared.group.artifacts.length > 1) setHistoryReview({ operation: prepared.operation, titles: prepared.group.artifacts.map((item) => item.title), label: action === 'undo' ? t.undo : t.redo });
      else await session.run(prepared.operation);
    } catch (failure) { setError(failure); }
    finally { setHistoryBusy(false); }
  }, [session, controller, historyBusy, t]);
  const historyAction = useRef(history);
  useEffect(() => { historyAction.current = history; }, [history]);
  const runHistory = useCallback((action: 'undo' | 'redo') => { void historyAction.current(action); }, []);
  const editor = useEditor({
    immediatelyRender: false,
    // documentExtensions stores this callback; only a later keyboard shortcut reads the ref.
    // eslint-disable-next-line react-hooks/refs
    extensions: documentExtensions({ workspaceId: snapshot!.viewer.workspaceId, userId: snapshot!.viewer.userId, unavailable: t.imageUnavailable, allowFetch: resources }, runHistory),
    content: state.content.document,
    editable: canEdit,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': t.editor, spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html');
        if (!html) return false;
        event.preventDefault();
        try { const imported = importDocumentHtml(html); editor?.chain().focus().insertContent(imported.content.document.content ?? []).run(); setPasteLosses(imported.losses); }
        catch { setEditError(true); }
        return true;
      },
    },
    onUpdate: ({ editor: changed, transaction }) => {
      try {
        const content = fromEditorJson(changed.getJSON(), controller.getSnapshot().content);
        if (!controller.change(content, transaction.getMeta('paste') ? 'paste' : 'typing')) changed.commands.setContent(controller.getSnapshot().content.document, { emitUpdate: false });
        else setEditError(false);
      } catch { setEditError(true); changed.commands.setContent(controller.getSnapshot().content.document, { emitUpdate: false }); }
    },
  });
  const selection = useEditorState({ editor, selector: ({ editor: current }) => {
    if (!current) return null;
    const selected = current.state.selection;
    const node = selected instanceof NodeSelection ? selected.node : selected.$from.parent;
    return { id: typeof node.attrs.id === 'string' ? node.attrs.id : undefined, type: node.type.name, value: String(node.attrs.value ?? ''), alt: String(node.attrs.alt ?? ''), width: node.attrs.width as number | undefined, height: node.attrs.height as number | undefined, heading: current.getAttributes('heading').level as number | undefined, fontSize: current.getAttributes('textStyle').fontSize as number | undefined, color: current.getAttributes('textStyle').color as string | undefined, bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), strike: current.isActive('strike'), bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), quote: current.isActive('blockquote'), table: current.isActive('table'), matches: findDocumentText(current.state.doc, query, matchCase) };
  } });
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => { controller.setReason(() => t.manualReason); }, [controller, t.manualReason]);
  useEffect(() => { onFlushReady?.(controller.flush); return () => onFlushReady?.(null); }, [controller, onFlushReady]);
  useEffect(() => { editor?.setEditable(canEdit); }, [editor, canEdit]);
  useEffect(() => {
    if (!editor || state.phase === 'hidden') return;
    try {
      if (hashJson(asJson(fromEditorJson(editor.getJSON(), state.content))) !== hashJson(asJson(state.content))) editor.commands.setContent(state.content.document, { emitUpdate: false });
    } catch { editor.commands.setContent(state.content.document, { emitUpdate: false }); }
  }, [editor, state.content, state.phase]);
  useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta(documentFindKey, { query: findOpen ? query : '', matchCase, active: activeMatch })); }, [editor, findOpen, query, matchCase, activeMatch]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (controller.getSnapshot().phase !== 'ready') event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [controller]);

  if (!snapshot || state.phase === 'hidden') return null;
  if (!editor) return <LoadingState />;
  const binding = snapshot.artifact.bindings.find((item) => item.targetElementId === selection?.id);
  const fieldValue = fieldDraft?.id === selection?.id ? fieldDraft?.value ?? '' : selection?.value ?? '';
  const locked = Boolean(selection?.id && snapshot.locks?.[selection.id]);
  const source = binding && snapshot.sourceFreshness.find((item) => item.sourceRef.sourceId === binding.sourceRef.sourceId);
  const problem = state.phase === 'failed' ? t.failed : state.phase === 'conflict' ? t.conflict : state.phase === 'recovery' ? t.recovery : undefined;
  const historyHref = `/app/projects/${snapshot.artifact.projectId}/artifacts/${snapshot.artifact.id}/history`;
  function format(run: () => void) { if (!canEdit) return; run(); void controller.flush().catch(setError); }
  function selectMatch(index: number) {
    const matches = findDocumentText(editor!.state.doc, query, matchCase);
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setActiveMatch(next); editor!.commands.setTextSelection(matches[next]!); editor!.commands.scrollIntoView();
  }
  function replace(all: boolean) {
    if (!canEdit || !query) return;
    const matches = findDocumentText(editor!.state.doc, query, matchCase);
    const selected = all ? matches : matches.slice(activeMatch, activeMatch + 1);
    const transaction = editor!.state.tr;
    for (const match of [...selected].reverse()) transaction.insertText(replacement, match.from, match.to);
    editor!.view.dispatch(transaction); void controller.flush().catch(setError);
  }
  async function insertFact(fact: DocumentFact) {
    if (!editor || !fieldPosition.current) return;
    setFieldBusy(true);
    try {
      if (!await controller.flush()) return;
      if (fieldPosition.current.contentHash !== hashJson(asJson(fromEditorJson(editor.getJSON())))) throw new Error('document-selection-changed');
      const id = crypto.randomUUID();
      const transaction = editor.state.tr.replaceWith(fieldPosition.current.from, fieldPosition.current.to, editor.schema.nodes.dataField!.create({ id, value: materialText(fact.cell.value, locale) }));
      const desired = fromEditorJson(transaction.doc.toJSON(), controller.getSnapshot().content);
      if (await controller.command((base) => bindDocumentField(base, desired, id, fact.cell.sourceRef, fact.sourceFreshness, locale, t.fieldInsert), desired)) setFieldOpen(false);
    } finally { setFieldBusy(false); }
  }
  async function fieldAction(action: 'override' | 'restore' | 'unbind') {
    if (!selection?.id || !binding) return;
    setFieldBusy(true); setError(undefined);
    try {
      const fact = action === 'restore' ? await currentDocumentFact(session.getSnapshot().snapshot!, binding.sourceRef) : undefined;
      const value = fact ? materialText(fact.cell.value, locale) : fieldValue;
      const desired = action === 'unbind' ? undefined : replaceDocumentFieldValue(controller.getSnapshot().content, selection.id!, value);
      await controller.command((base) => changeDocumentField(base, selection.id!, action, value, t[action === 'restore' ? 'restoreBinding' : action], fact?.cell.sourceRef, fact?.sourceFreshness, locale), desired);
      setFieldDraft(undefined);
    } catch (failure) { setError(failure); } finally { setFieldBusy(false); }
  }
  return <div className={styles.editor}>
    <div className={styles.toolbar} role="group" aria-label={t.tools}>
      <div className={styles.toolGroup}>
        <IconButton icon={Undo2} label={t.undo} disabled={!canEdit || !(snapshot.history.some((item) => item.canUndo) || state.phase === 'dirty' || state.phase === 'saving')} onClick={() => { void history('undo'); }} />
        <IconButton icon={Redo2} label={t.redo} disabled={!canEdit || !snapshot.history.some((item) => item.canRedo)} onClick={() => { void history('redo'); }} />
        <select aria-label={t.paragraph} disabled={!canEdit} value={selection?.heading ?? 0} onChange={(event) => format(() => { const level = Number(event.target.value); if (level === 0) editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); })}>
          <option value="0">{t.paragraph}</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>{t.heading} {level}</option>)}
        </select>
      </div>
      <div className={styles.toolGroup}>
        <IconButton icon={Bold} label={t.bold} aria-pressed={selection?.bold} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleBold().run(); })} />
        <IconButton icon={Italic} label={t.italic} aria-pressed={selection?.italic} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleItalic().run(); })} />
        <IconButton icon={Underline} label={t.underline} aria-pressed={selection?.underline} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleUnderline().run(); })} />
      </div>
      <details name="document-tools" className={styles.toolMenu} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary>{t.moreTools}</summary><div className={styles.menuContent}>
      <div className={styles.toolGroup}>
        <IconButton icon={Strikethrough} label={t.strike} aria-pressed={selection?.strike} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleStrike().run(); })} />
        <IconButton icon={Eraser} label={t.clear} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().unsetAllMarks().run(); })} />
        <select aria-label={t.fontSize} value={selection?.fontSize ?? ''} disabled={!canEdit} onChange={(event) => format(() => { editor.chain().focus().setMark('textStyle', { fontSize: Number(event.target.value) }).run(); })}><option value="">{t.fontSize}</option>{[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].map((size) => <option key={size} value={size}>{size}</option>)}</select>
        <input type="color" aria-label={t.color} className={styles.swatch} value={selection?.color?.match(/^#[\da-f]{6}$/i) ? selection.color : '#202624'} disabled={!canEdit} onChange={(event) => format(() => { editor.chain().focus().setMark('textStyle', { color: event.target.value }).run(); })} />
      </div>
      <div className={styles.toolGroup}>
        <IconButton icon={List} label={t.bulletList} aria-pressed={selection?.bullet} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleBulletList().run(); })} />
        <IconButton icon={ListOrdered} label={t.orderedList} aria-pressed={selection?.ordered} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleOrderedList().run(); })} />
        <IconButton icon={Quote} label={t.quote} aria-pressed={selection?.quote} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().toggleBlockquote().run(); })} />
      </div>
      <div className={styles.toolGroup}>{([{ value: 'left', label: t.alignLeft, icon: AlignLeft }, { value: 'center', label: t.alignCenter, icon: AlignCenter }, { value: 'right', label: t.alignRight, icon: AlignRight }, { value: 'justify', label: t.alignJustify, icon: AlignJustify }]).map((align) => <IconButton key={align.value} icon={align.icon} label={align.label} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().setTextAlign(align.value).run(); })} />)}</div>
      </div></details>
      <details name="document-tools" className={styles.toolMenu} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}><summary>{t.insert}</summary><div className={styles.menuContent}>
      <div className={styles.toolGroup}>
        <Button icon={Link2} disabled={!canEdit} onClick={() => { setLinkAddress(String(editor.getAttributes('link').href ?? '')); setLinkOpen(true); }}>{t.link}</Button>
        <Button icon={Table2} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); })}>{t.insertTable}</Button>
        <Button icon={FilePlus2} disabled={!canEdit} onClick={() => format(() => { editor.chain().focus().insertContent({ type: 'pageBreak' }).run(); })}>{t.pageBreak}</Button>
        {resources && <Button icon={ImagePlus} disabled={!canEdit} onClick={() => setImageOpen(true)}>{t.imageChoose}</Button>}
        {resources && <Button icon={Database} disabled={!canEdit} onClick={() => { fieldPosition.current = { from: editor.state.selection.from, to: editor.state.selection.to, contentHash: hashJson(asJson(fromEditorJson(editor.getJSON()))) }; setFieldOpen(true); }}>{t.fieldInsert}</Button>}
      </div>
      </div></details>
      <IconButton icon={Search} label={t.find} aria-pressed={findOpen} onClick={() => setFindOpen(!findOpen)} />
      <IconButton icon={Settings2} label={t.inspect} aria-pressed={inspector} onClick={() => setInspector(!inspector)} />
      <Button icon={Save} disabled={!canEdit} onClick={() => { void controller.flush().catch(setError); }}>{t.save}</Button>
    </div>
    {selection?.table && <details className={`${styles.toolbar} ${styles.tableMenu}`}><summary>{t.table}</summary><div className={styles.menuContent} role="group" aria-label={t.table}>
      {([{ label: t.addRow, run: () => editor.chain().focus().addRowAfter().run() }, { label: t.addColumn, run: () => editor.chain().focus().addColumnAfter().run() }, { label: t.removeRow, run: () => editor.chain().focus().deleteRow().run() }, { label: t.removeColumn, run: () => editor.chain().focus().deleteColumn().run() }, { label: t.mergeCells, run: () => editor.chain().focus().mergeCells().run() }, { label: t.splitCell, run: () => editor.chain().focus().splitCell().run() }, { label: t.removeTable, run: () => editor.chain().focus().deleteTable().run() }]).map((action) => <Button key={action.label} variant="quiet" disabled={!canEdit} onClick={() => format(action.run)}>{action.label}</Button>)}
    </div></details>}
    {binding && <DocumentFieldContext key={`${selection?.id}:${snapshot.viewer.authzVersion}`} snapshot={snapshot} binding={binding} value={selection?.value ?? ''} disabled={!canEdit} resources={resources} onEdit={() => setInspector(true)} onRestore={() => { void fieldAction('restore'); }} onUnbind={() => { void fieldAction('unbind'); }} />}
    {findOpen && <div className={styles.find}>
      <label>{t.findText}<input value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setActiveMatch(0); }} /></label>
      <label>{t.replaceText}<input value={replacement} maxLength={100000} onChange={(event) => setReplacement(event.target.value)} disabled={!canEdit} /></label>
      <span className={styles.checkbox}><input id="document-match-case" type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /><label htmlFor="document-match-case">{t.matchCase}</label></span>
      <Button onClick={() => selectMatch(activeMatch - 1)}>{t.previous}</Button><Button onClick={() => selectMatch(activeMatch + 1)}>{t.next}</Button>
      <Button disabled={!canEdit || !query} onClick={() => replace(false)}>{t.replace}</Button><Button disabled={!canEdit || !query} onClick={() => replace(true)}>{t.replaceAll}</Button>
      <span role="status">{selection?.matches.length ? `${t.matches}: ${selection.matches.length}` : t.noMatches}</span>
      <IconButton icon={X} label={t.close} onClick={() => setFindOpen(false)} />
    </div>}
    <div className={styles.status} role="status">{!snapshot.permissions.edit ? t.readOnly : state.phase === 'ready' ? t.saved : state.phase === 'saving' || state.phase === 'applying' ? t.saving : state.localSaved ? t.localSaved : t.unsaved}</div>
    {problem && <div className={styles.notice}><p>{problem}</p>{state.phase === 'failed' && <Button onClick={() => { void controller.retry().catch(setError); }}>{t.retry}</Button>}<Link href={historyHref}>{t.recovery}</Link></div>}
    <ArtifactError error={error} />{editError && <p className={styles.error} role="alert">{t.editError}</p>}
    {pasteLosses.length > 0 && <div className={styles.notice}><ul>{pasteLosses.map((loss) => <li key={loss.code}>{t[lossCopyKeys[loss.code]]}</li>)}</ul><Button onClick={() => setPasteLosses([])}>{t.close}</Button></div>}
    <div className={`${styles.surface} ${inspector ? styles.surfaceWithInspector : ''}`}>
      <div className={styles.sheet}><EditorContent editor={editor} /></div>
      {inspector && <aside className={styles.inspector} aria-label={t.inspect}><div className={styles.inspectorHead}><h2>{binding ? t.field : t.selection}</h2><IconButton icon={X} label={t.close} onClick={() => setInspector(false)} /></div>
        <div className={styles.form}>
          <Button icon={locked ? Unlock : Lock} disabled={!canEdit || !selection?.id} onClick={() => { if (selection?.id) void controller.command((base) => documentLock(base, selection.id!, !locked, t.lockReason)).catch(setError); }}>{locked ? t.unlock : t.lock}</Button>
          {selection?.type === 'image' && <ImageProperties key={selection.id} t={t} alt={selection.alt} width={selection.width} height={selection.height} disabled={!canEdit} onApply={(attrs) => format(() => { editor.chain().focus().updateAttributes('image', attrs).run(); })} />}
          {binding && <><p>{binding.override ? t.localOverride : source?.status === 'current' ? t.sourceCurrent : source?.status === 'stale' ? t.sourceStale : t.sourceUnknown}</p><p>{selection?.value}</p>
            <InputField key={selection?.id} label={t.fieldValue} value={fieldValue} disabled={!canEdit} onChange={(event) => { if (selection?.id) setFieldDraft({ id: selection.id, value: event.target.value }); }} />
            <Button disabled={!canEdit} onClick={() => { void fieldAction('override'); }}>{t.override}</Button>
            {resources && <Button disabled={!canEdit || source?.sourceStatus === 'unknown'} onClick={() => { void fieldAction('restore'); }}>{t.restoreBinding}</Button>}
            <Button disabled={!canEdit} onClick={() => { void fieldAction('unbind'); }}>{t.unbind}</Button>
            {resources && source?.sourceStatus !== 'unknown' && <Link href={`/app/materials/sources/${binding.sourceRef.sourceId}`}>{t.openSource}</Link>}</>}
        </div>
      </aside>}
    </div>
    {imageOpen && <DocumentImagePicker snapshot={snapshot} onClose={() => setImageOpen(false)} onChoose={(asset) => { format(() => { editor.chain().focus().insertContent({ type: 'image', attrs: { id: crypto.randomUUID(), assetId: asset.id, alt: asset.name, width: asset.width, height: asset.height } }).run(); }); setImageOpen(false); }} />}
    {fieldOpen && <DocumentFactPicker snapshot={snapshot} onClose={() => setFieldOpen(false)} onChoose={insertFact} />}
    <Dialog open={linkOpen} onOpenChange={setLinkOpen} title={t.link} footer={<><Button onClick={() => { format(() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); }); setLinkOpen(false); }}>{t.removeLink}</Button><Button variant="primary" disabled={!safeDocumentLink(linkAddress)} onClick={() => { format(() => { editor.chain().focus().extendMarkRange('link').setLink({ href: linkAddress }).run(); }); setLinkOpen(false); }}>{t.apply}</Button></>}>
      <InputField label={t.linkAddress} value={linkAddress} onChange={(event) => setLinkAddress(event.target.value)} error={linkAddress && !safeDocumentLink(linkAddress) ? t.linkInvalid : undefined} />
    </Dialog>
    <Dialog open={Boolean(historyReview)} onOpenChange={(open) => { if (!open && !historyBusy) setHistoryReview(undefined); }} title={historyReview?.label ?? t.undo} footer={<><Button disabled={historyBusy} onClick={() => setHistoryReview(undefined)}>{t.cancel}</Button><Button variant="primary" pending={historyBusy} onClick={() => { if (!historyReview) return; setHistoryBusy(true); void session.run(historyReview.operation).then(() => setHistoryReview(undefined)).catch(setError).finally(() => setHistoryBusy(false)); }}>{t.apply}</Button></>}>
      <ul>{historyReview?.titles.map((title, index) => <li key={index}>{title}</li>)}</ul><ArtifactError error={error} />
    </Dialog>
  </div>;
}

function ImageProperties({ t, alt, width, height, disabled, onApply }: { t: DocumentCopy; alt: string; width?: number; height?: number; disabled: boolean; onApply: (attrs: { alt: string; width?: number; height?: number }) => void }) {
  const [description, setDescription] = useState(alt), [size, setSize] = useState(width ? String(width) : '');
  const valid = size === '' || Number.isInteger(Number(size)) && Number(size) >= 1 && Number(size) <= 20000;
  return <div className={styles.form}><InputField label={t.imageAlt} value={description} maxLength={2000} disabled={disabled} onChange={(event) => setDescription(event.target.value)} /><InputField label={t.width} type="number" min={1} max={20000} value={size} disabled={disabled} onChange={(event) => setSize(event.target.value)} /><Button disabled={disabled || !valid} onClick={() => onApply({ alt: description, ...(size ? { width: Number(size), ...(width && height ? { height: Math.max(1, Math.round(height * Number(size) / width)) } : {}) } : {}) })}>{t.apply}</Button></div>;
}


