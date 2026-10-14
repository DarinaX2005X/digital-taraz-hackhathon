# 03 Сохранённая работа и настоящий редактор
Status: active

Результат становится вашим рабочим материалом, а не сообщением чата. Начинаем с документа и общей истории, на которые затем опираются таблицы, макеты и планы.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 03.1 Сохранить команды, версии и защищённую отмену
Status: active
Requirements: R10, R25, R42, R92, R93, R94, R102, R105
Depends on: 02.1
Owner: /root/business_fixtures (server/domain), /root/ui_foundation (client/UI)
Paths: src/features/artifacts/, tests/artifacts/, src/contracts/events.ts, src/server/db/artifact-schema.ts, src/server/db/project-schema.ts, src/server/db/source-schema.ts, migrations/0005_artifacts.sql, src/features/workspace/server/project-core.ts, src/features/sources/server/source-heads.ts, src/features/identity/server/access.ts, src/server/db/identity-schema.ts, tests/identity/server/team.integration.test.ts

**Контракт и результат.** C3-C4, C6. Artifact service create/read/rename/duplicate/move/archive/restore/delete dependency checks. Atomic Command validator: actor+ACL/authzVersion, baseRevision, stable targetIds, beforeHash, locked fields, expected sources, schema; one transaction revision+inverse+receipt+event. Retry commandId exactly-once, payload mismatch rejected. Last100 confirmed groups persisted; typing group700ms/drag-end/paste/AI package unified history adapter. Conditional inverse cannot undo чужое изменение; restore creates new revision, branch has parent. IndexedDB pending queue user/workspace isolated, no cross-account draft leakage.

Интеграция по C3: минимальная canonical Project persistence/create/read входит в03.1, поскольку projectId уже обязателен;03.2 продолжает ту же модель. Минимальные Source/SourceVersion heads продолжаются02.3 без второго source registry. MAIN выдаёт явные loans для schema/migration/project/source paths и изменения project guard после приёмки02.1; root registry/routes/package остаются MAIN. Conflict refs в общем409 содержат только разрешённые ID/revision/hash, не закрытые значения. WorkspaceEvent cursor выделяется под блокировкой workspace head в той же транзакции, не обычной sequence, которая допускает поздний commit с меньшим cursor. Раннее чтение03.1 завершено без реализации; запуск после фактической приёмки02.1.

Dispatch после a0f110c: business_fixtures владеет artifacts/server/, artifacts/domain/, artifacts/contracts.ts и index.ts; tests/artifacts/server/, domain/, contracts/; всеми перечисленными SQL/schema/project/source/event loans и identity access.ts, identity-schema.ts, team.integration.test.ts для canonical Project FK/owner guard. UI worker отдельно владеет artifacts/client/, ui/, locales/ и tests/artifacts/client/, ui/. Это непересекающиеся whole paths. UI работает с общими transport/domain schemas server worker, не создаёт вторые команды. MAIN owns root indexes, shared errors, routes/package/config. Ранний coherent0005/contracts handover нужен до mounted handlers и local migration;0001-0004 immutable. Клиентские проверки IndexedDB выполняются в Node через fake-indexeddb, не через браузер.

Новое указание2026-10-14 отменило прежнюю остановку после02: продолжать весь утверждённый продукт автономно. Ближайший coherent handover0005/schema/contracts+Project/source heads и client persistence/grouping/autosave сохраняется для проверенного checkpoint, после него03.1 продолжается полностью. MAIN делегирует source review и общую интеграцию отдельному агенту; будущий feature owner03.2 получает реальные pages/routes вместе с модулем. Partial checkpoint не означает весь03.1 done.

**Вход в работу и состояния.** Общий editor header save status, undo/redo arrows, version menu. Conflict preserves local and server values; user picks version/merge, not forced overwrite. Offline draft visible as not saved; logout warns and clears private local cache. Same state/labels across ru/kk/en; phone controls remain available. Реализовать SourceFreshness для прямых sourceRefs уже здесь; полные транзитивные предложения08.1 позже. Content chunks используют immutable structural sharing по C3, lifecycle/archive/trash/purge/tombstones по C6, не неопределённое хранение «пока нужно».

### 03.1.1 Команды и неизменяемая история
Status: active

Domain tests insert/delete/move/undo/redo/restore/branch, stable references after row insert, locks, duplicate command and beforeHash conflict. Migrations через MAIN.

Ранний server handover2026-10-14 frozen:0005/schema/contracts, canonical Project create/read, Source/SourceVersion heads и авторизованный freshness reader, event contracts/commit-ordered cursor, project access integration и updated identity fixture. Type/lint и5contract tests PASS;6реальныхDB cases ещё выполняются integration worker в общем runner0005→0006. ArtifactService lifecycle/commands/history/versions/chunk operations и HTTP endpoints пока не доставлены; task/checkpoint остаются active.

### 03.1.2 Сохранение и конкурирующие правки
Status: todo

Two actors edit same/different targets via real DB; stale base returns409 without loss, event cursor only after commit. Restart retains history; logout/login other workspace cannot recover old private draft.

Промежуточный клиентский результат:11 Node IndexedDB API tests PASS для reopen, immutable pending payload, user/workspace/artifact isolation, authz epoch invalidation между connections, abort races при session expiry, newest draft generation, quota/unavailable errors и подтверждённого user-wide signout clear. Это часть пакета, не приёмка checkpoint: grouping/autosave/confirmed history и реальная server integration ещё разрабатываются. Браузерная persistence не проверена агентами.

Цельный ранний client handover2026-10-14: src/features/artifacts/client/ и tests/artifacts/client/ frozen,39focused Node tests/type/lint PASS. Добавлены700ms grouping и flush, immutable pending command/retry IDs, canonical typed receipts, persisted revocation/account epoch и atomic draft-generation cleanup. UI/routes/HTTP transport/полная confirmed history остаются для продолжения03.1, не объявлены готовыми. Integration принимает common batch перед checkpoint; пользовательская visual/browser проверка не выполнялась.

Интеграционный handover: исправлен найденный equal-createdAt replay ordering дефект через durable insertion sequence;41client tests PASS. Общий isolated runner9files/45tests PASS, включая6Project/source DB cases и identity regression; fresh0001-0006 и primary local migration journal подтверждены. Все writers STOP для штатного Git checkpoint. Это проверенный ранний фундамент, не окончание03.1.1/03.1.2.

## 03.2 Организовать работу вокруг проектов и текущего результата
Status: todo
Requirements: R08, R21, R25, R31, R32, R33, R35, R36, R37, R38, R39, R40, R41, R44, R45, R97
Depends on: 03.1, 01.2
Owner: SUBAGENT to assign
Paths: src/features/workspace/, tests/workspace/

**Контракт и результат.** C1, C4, C6, DESIGN маршруты/композиция. Работа list/search/filter/recent/archive, Project с Goal и attachments/results, free-form input retaining draft. Create blank document/table/design/plan and AI goal are equal entry points; no mandatory company wizard. Cursor pagination, invalid filter IDs rejected; async stale request cancelled, keep loaded rows on failure. Workspace event snapshot+cursor then bounded polling per C4; late responses/revocations/resetRequired invalidate narrowly without reload or editor reset. Feature worker владеет screens/handlers и явно назначенными app pages/routes; MAIN не выполняет эту часть за агента. Shared layout согласуется через единственного integration owner.

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
Depends on: 03.2, 02.4
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
Depends on: 03.3
Owner: SUBAGENT to assign
Paths: src/features/exports/, tests/exports/

Локальный допуск опирается на принятый format proof01.4.1; remote01.4.2 отложен по указанию пользователя. Реальные локальные DOCX/PDF и их содержимое проверяются здесь; пригодность cloud execution/storage отдельно обязательна11.2/13.2.

**Контракт и результат.** C3-C4, C7. Export service extensible by artifact kind: initial DOCX/PDF via docx/PDFKit, same typed model, local embedded fonts ru/kk/en, table/pagebreak/images. Fixed revision IDs/layout/locale/private policy hash persisted before render, immutable ExportBundleManifest files/hashes/sourceVersions. Queued/rendering/partial/ready/failed; never mix revisions on retry. Download rechecks current rights; revoke removes access even historic link. Draft unresolved critical binding blocks ordinary approved bundle; explicit historic draft export labelled.

**Вход в работу и состояния.** «Экспорт» dialog lists formats, selected revision, files included, internal data warning and status with retry/cancel. Opens no browser automatically. Current edit during export yields «Выгружена версия N», not false current. Mobile same selections and download.

### 03.4.1 Документ в пригодных форматах
Status: todo

Parse DOCX zip/XML and PDF text/page/font/image objects; golden Unicode, totals, pagebreaks and long tables. Not raster screenshot QA; user opens files in own applications.

### 03.4.2 Версионный пакет и безопасный повтор
Status: todo

Actual object storage writes, interruption between files -> same manifest retry, duplicate request one bundle, ACL revocation and checksum. Export reflects saved revision not latest mutable state.

