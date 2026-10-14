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
Status: active

Two actors edit same/different targets via real DB; stale base returns409 without loss, event cursor only after commit. Restart retains history; logout/login other workspace cannot recover old private draft.

Промежуточный клиентский результат:11 Node IndexedDB API tests PASS для reopen, immutable pending payload, user/workspace/artifact isolation, authz epoch invalidation между connections, abort races при session expiry, newest draft generation, quota/unavailable errors и подтверждённого user-wide signout clear. Это часть пакета, не приёмка checkpoint: grouping/autosave/confirmed history и реальная server integration ещё разрабатываются. Браузерная persistence не проверена агентами.

Цельный ранний client handover2026-10-14: src/features/artifacts/client/ и tests/artifacts/client/ frozen,39focused Node tests/type/lint PASS. Добавлены700ms grouping и flush, immutable pending command/retry IDs, canonical typed receipts, persisted revocation/account epoch и atomic draft-generation cleanup. UI/routes/HTTP transport/полная confirmed history остаются для продолжения03.1, не объявлены готовыми. Integration принимает common batch перед checkpoint; пользовательская visual/browser проверка не выполнялась.

Интеграционный handover: исправлен найденный equal-createdAt replay ordering дефект через durable insertion sequence;41client tests PASS. Общий isolated runner9files/45tests PASS, включая6Project/source DB cases и identity regression; fresh0001-0006 и primary local migration journal подтверждены. Все writers STOP для штатного Git checkpoint. Это проверенный ранний фундамент, не окончание03.1.1/03.1.2.

Foundation checkpoint9051568e4fb1eb802e9963ec1d15ef2bba488519 принят и pushed origin/main, все7configured checks PASS. Business_fixtures/ui_foundation release на весь оставшийся03.1. Server owner получает src/app/api/artifacts/, projects/, workspace-events/ и минимальный bounded Project list для ingestion; client/UI owner получает реальную protected history/version page src/app/app/projects/[projectId]/artifacts/[artifactId]/history/. Основной editor route и shell остаются03.2, не имитировать их до готовности. Migration0005 immutable. Source review и общие проверки у integration; MAIN только memory/Git/coordination. Точные whole-path ownership в STATE.

Следующий существенный client handover: transport/cache/autosave/index и persisted confirmed history с tests,8paths;57focused tests и lint PASS, owner держит пакет стабильным для source review integration. Реальный HTTP/DB boundary, mounted history page и полный03.1 acceptance ещё не пройдены. Business параллельно готовит domain stable-target/command/chunk пакет; общий Git checkpoint будет на совместной buildable границе, без включения незавершённого кода как готового.

Integration review возвратил3transport defects владельцу: потеря privacy status при timeout после403headers, lifecycle receipt другогоartifact, отсутствие stream cancel при early Content-Length rejection. Дополнительно выявлена потеря разрешённых drafts при harmless authzVersion bump: до полного03.1 требуется fresh server ACL revalidation с сохранением всё ещё разрешённого ввода, без old-epoch replay. Реальный revoke/cross-account переход скрывает и очищает private data; нельзя ослабить проверку прав ради сохранения черновика. Cache ещё не подключён к готовому editor UI, поэтому это boundary acceptance, а не утверждение о проверенном браузерном поведении.

Промежуточный client пакет принят integration после исправления всех трёх transport defects: повторно 66 focused tests, scoped lint и общий typecheck PASS. Восемь переданных путей готовы для checkpoint; новые UI/locales ещё не приняты и не входят в этот scope. Harmless authzVersion revalidation/draft preservation остаётся обязательным до полного03.1, как и настоящий mounted history workflow.

Общая buildable boundary ещё не сформирована из-за активных safety/domain fixes других owners. MAIN после оценки integration освободил эти восемь client paths для непосредственно связанного authz revalidation/lifecycle journal продолжения; расширенный пакет будет передан и проверен заново. Прежние проверки не выдаются за проверку нового кода, commit этого подэтапа пока не создан.

Следующая coherent boundary принята integration:11domain/contract paths,37tests/5files и scoped lint PASS. Stable targets/structural sharing/command semantics проверяют locks включая destination ancestors, manual bound overrides, conditional inverse, content size и document table geometry. Этот dependency-safe пакет включается в общий checkpoint. Server/chunk-store/lifecycle/Project/API/event-feed ещё WIP и исключены;03.1.1 остаётся active.

Расширенный client handover содержит authz-v2 revalidation, durable lifecycle journal, transport, localized unmounted previews/dialogs и новый session controller:94focused tests/lint/global typecheck PASS по отчёту владельца. Integration ещё не принял source/HTTP boundary; все эти изменённые client/UI/locales paths исключены из текущего checkpoint. Protected history page не смонтирована. Все writers подтвердили STOP до завершения helper, затем продолжают весь03.1.

## 03.2 Организовать работу вокруг проектов и текущего результата
Status: todo
Requirements: R08, R21, R25, R31, R32, R33, R35, R36, R37, R38, R39, R40, R41, R44, R45, R97
Depends on: 03.1, 01.2
Owner: SUBAGENT to assign
Paths: src/features/workspace/, tests/workspace/

Подготовительное чтение03.2 назначено новому /root/workspace_shell, Paths:none. Он читает весь исходный BRIEF/TESTING/Design и relevant skill/reference rules, канонические Project/artifact contracts и текущие services, согласует план реальных pages/API со смежными owners. Реализация только после принятия03.1; project-core/API сейчас business_fixtures, shared roots integration. Это read-only подготовка самостоятельного крупного feature, не выполнение зависимости заранее.

Read-only prep завершён: полный packet/исходники/references прочитаны, изменений/tests/расходов нет. Предлагаемые future paths: workspace feature/tests, переданные project-core и api/projects, app/work и project/main-artifact pages/layouts с исключением history owner. Shared app/layout/redirect/return allowlist согласуется с integration. Для private recent/selected-result view-state нужна новая additive migration после зарезервированной0008. До release согласовать stable list/snapshot DTO, project-scoped events, authorized project sources list и описанное выше authz/draft recovery. Worker ждёт фактического03.1 acceptance, ownership не выдан.

Уточнение топологической приёмки03.2: этот пакет доставляет настоящий Project lifecycle/list/search/draft, навигацию, result/history/source/run composition и typed capability adapters. Все четыре предметных редактора и исполнение AI физически интегрируются задачами03.3/04.1/05.1/06.1/07.4;03.2 не подменяет их фиктивными engines или кнопками. Временная доступность действий определяется фактически подключённым adapter: цель можно сохранять независимо, «Выполнить» появляется при готовности runtime+tools; создание и открытие материала доступны с соответствующим реальным пользовательским путём. Приёмка03.2 означает проверенный workspace mechanism, не закрытие обещания полноценного редактирования четырёх видов. Его общие requirements остаются прослеживаемыми в последующих tasks и сквозных04.2/11.1. Будущие library02.4/business09.1 pages не заменять placeholder routes; согласовать навигационный контракт и подключить реальные области при их readiness. Это разрешает существующий порядок зависимостей, не сокращает утверждённый объём.

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

