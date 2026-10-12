# 03 Сохранённая работа и настоящий редактор
Status: todo

Результат становится вашим рабочим материалом, а не сообщением чата. Начинаем с документа и общей истории, на которые затем опираются таблицы, макеты и планы.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 03.1 Сохранить команды, версии и защищённую отмену
Status: todo
Requirements: R10, R25, R42, R92, R93, R94, R102, R105
Depends on: 02.1
Owner: SUBAGENT to assign
Paths: src/features/artifacts/, tests/artifacts/

**Контракт и результат.** C3-C4, C6. Artifact service create/read/rename/duplicate/move/archive/restore/delete dependency checks. Atomic Command validator: actor+ACL/authzVersion, baseRevision, stable targetIds, beforeHash, locked fields, expected sources, schema; one transaction revision+inverse+receipt+event. Retry commandId exactly-once, payload mismatch rejected. Last100 confirmed groups persisted; typing group700ms/drag-end/paste/AI package unified history adapter. Conditional inverse cannot undo чужое изменение; restore creates new revision, branch has parent. IndexedDB pending queue user/workspace isolated, no cross-account draft leakage.

**Вход в работу и состояния.** Общий editor header save status, undo/redo arrows, version menu. Conflict preserves local and server values; user picks version/merge, not forced overwrite. Offline draft visible as not saved; logout warns and clears private local cache. Same state/labels across ru/kk/en; phone controls remain available.

### 03.1.1 Команды и неизменяемая история
Status: todo

Domain tests insert/delete/move/undo/redo/restore/branch, stable references after row insert, locks, duplicate command and beforeHash conflict. Migrations через MAIN.

### 03.1.2 Сохранение и конкурирующие правки
Status: todo

Two actors edit same/different targets via real DB; stale base returns409 without loss, event cursor only after commit. Restart retains history; logout/login other workspace cannot recover old private draft.

## 03.2 Организовать работу вокруг проектов и текущего результата
Status: todo
Requirements: R08, R21, R25, R31, R32, R33, R35, R36, R37, R38, R39, R40, R41, R44, R45, R97
Depends on: 03.1, 01.2
Owner: SUBAGENT to assign
Paths: src/features/workspace/, tests/workspace/

**Контракт и результат.** C1, C4, C6, DESIGN маршруты/композиция. Работа list/search/filter/recent/archive, Project с Goal и attachments/results, free-form input retaining draft. Create blank document/table/design/plan and AI goal are equal entry points; no mandatory company wizard. Cursor pagination, invalid filter IDs rejected; async stale request cancelled, keep loaded rows on failure. Workspace event snapshot+cursor then bounded polling per C4; late responses/revocations/resetRequired invalidate narrowly without reload or editor reset. MAIN owns app route composition; worker exports screens/handlers.

**Вход в работу и состояния.** Navigation Работа/Материалы/Бизнес, no agent-role tabs. Project opens dominant selected editor; result rail and contextual Источники/Изменения/AI only when relevant. «Новая работа», attach, submit and recent work immediately reachable. Empty/partial/pending/failed/archived and404 purposeful. Mobile one main pane with labelled drawers and preserved return selection.

### 03.2.1 Личная работа и навигация
Status: todo

API create/list/open/archive, same project on return, search/filter validation and 404 HTTP status. Route action inventory points to real handlers, no dead CTA.

### 03.2.2 Согласованное состояние без reload
Status: todo

Reducer/event tests stale response, pagination reset, reconnect cursor, role revoke, locale change retaining edits. User checks clarity, desktop/mobile first path and no panel overload.

## 03.3 Редактировать документы напрямую и сохранять структуру
Status: todo
Requirements: R10, R16, R34, R39, R40, R44, R45, R92, R93, R94, R95
Depends on: 03.2, 02.3
Owner: SUBAGENT to assign
Paths: src/features/documents/, tests/documents/

**Контракт и результат.** C3, C6-C7. Tiptap typed blocks stable IDs: headings/paragraphs/lists/tables/images/page breaks, inline marks, links, source-bound fields with source/value/status, find/replace and paste sanitisation. Import DOCX best-effort structured content with explicit loss report; PDF is source not perfect editable Word import. All edits via single Command history adapter; protect block/field from AI and local override separately from changing source. Serialize ProseMirror versioned schema, migration tests; user text preserved across language generation.

**Вход в работу и состояния.** Document primary white sheet; familiar formatting toolbar, insert menu and inline bound-field action «Изменить здесь» / «Открыть источник». Visible undo/redo, save status, export. No mandatory chat for text edits. Narrow toolbar wraps predictable groups into labelled menu, table horizontal scroll not page overflow.

### 03.3.1 Структурированный документ и импорт
Status: todo

Schema roundtrip blocks/tables/images/Kazakh, sanitised paste, DOCX losses, invalid node rejected. Editing one paragraph leaves all unrelated IDs/hashes intact.

### 03.3.2 Редактор с историей и источниками
Status: todo

Command adapters tested direct edits/format/find/replace/locks undo through DB reopen; stale source marks field without replacing local text. User verifies caret/selection/keyboard/mobile.

## 03.4 Выгрузить документ и зафиксировать состав пакета
Status: todo
Requirements: R13, R16, R25, R42, R43, R95
Depends on: 03.3, 01.4
Owner: SUBAGENT to assign
Paths: src/features/exports/, tests/exports/

**Контракт и результат.** C3-C4, C7. Export service extensible by artifact kind: initial DOCX/PDF via docx/PDFKit, same typed model, local embedded fonts ru/kk/en, table/pagebreak/images. Fixed revision IDs/layout/locale/private policy hash persisted before render, immutable ExportBundleManifest files/hashes/sourceVersions. Queued/rendering/partial/ready/failed; never mix revisions on retry. Download rechecks current rights; revoke removes access even historic link. Draft unresolved critical binding blocks ordinary approved bundle; explicit historic draft export labelled.

**Вход в работу и состояния.** «Экспорт» dialog lists formats, selected revision, files included, internal data warning and status with retry/cancel. Opens no browser automatically. Current edit during export yields «Выгружена версия N», not false current. Mobile same selections and download.

### 03.4.1 Документ в пригодных форматах
Status: todo

Parse DOCX zip/XML and PDF text/page/font/image objects; golden Unicode, totals, pagebreaks and long tables. Not raster screenshot QA; user opens files in own applications.

### 03.4.2 Версионный пакет и безопасный повтор
Status: todo

Actual object storage writes, interruption between files -> same manifest retry, duplicate request one bundle, ACL revocation and checksum. Export reflects saved revision not latest mutable state.

