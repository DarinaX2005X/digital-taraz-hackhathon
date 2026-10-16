# 01 Новая рабочая среда и первый полезный результат
Status: active

Пользователь приносит задачу и материалы, получает пригодный новый результат и может сразу работать с ним. Новый сайт объясняет это за несколько секунд. Шесть самостоятельных пакетов заменяют прежнее дробление основы, редакторов, AI и первого входа; готовые механизмы не переписываются без причины.

Общие требования, контракты K0–K6, проверки P1–P6 и правила передачи: [PLAN](../PLAN.md). Все интерфейсы следуют [DESIGN](../DESIGN.md), включая RU/KK/EN, keyboard/touch, narrow, hover/pressed/focus/selected и сохранение контекста при ошибке. Paths эксклюзивны; root wiring и общие schemas принадлежат 01.3. Параллельный старт разрешён по утверждённым contracts; обязательные producer handovers до done перечислены в PLAN и не заменяются fixtures; интегрированный результат всех пакетов принимает 04.1.

## 01.1 Переписать общую визуальную систему
Status: done
Requirements: R09, R31, R32, R33, R34, R38, R39, R40, R44, R45, R46, R47, R48, R49, R60, R101, R108
Depends on: none
Owner: SUBAGENT visual_system
Paths: src/ui/, src/i18n/, public/brand/, public/fonts/, tests/ui-contracts/

**Результат и граница.** Полная замена шаблонных токенов/компонентов по DESIGN с сохранением имени, слогана, brand mark и совместимых API. Это общий reusable контракт для остальных владельцев, а не отдельный набор демонстрационных кнопок. Параллельно 01.2–01.6 и 02–03; глобальный layout меняет только 01.3 по готовому handover.

**Порядок.** Сначала сверить существующий UI WIP и потребителей, затем непрозрачные поверхности/типографика/палитра/размеры. Обновить buttons, fields, tabs, menus, dialog, toast, progress, skeleton, data surfaces и error/empty states, сохранив семантику и доступные names. Отдать стабильные exports/пример использования владельцам страниц; вписать каждое общее состояние в реальный интерфейс. Открытие модалки сохраняет место, Escape и focus return работают; pressed не меняет layout. Motion и reduced motion заданы в DESIGN.

**Проверка.** Контраст считается по фактическим парам; type/lint и структурные контракты доказывают совместимость, не красоту. Внешний вид, focus/hover и narrow проверяет пользователь. Продуктовые страницы перерабатывают их владельцы, не этот пакет.

### 01.1.1 Новые токены и рабочие примитивы
Status: done
Один согласованный набор с проверенными imports и состояниями на существующих consumers; никаких параллельных legacy themes. Handover включает изменённые API и потребителей, которым нужна адресная миграция.

Принято: visual_system передал src/ui/, public/brand/, tests/ui-contracts/ и прекратил запись. Новые токены, surfaces, menu/progress, feedback и brand palette сохраняют существующие exports/signatures; legacy aliases совместимы. Focused Vitest: 8 files / 73 tests PASS, включая фактические WCAG-пары и semantic contracts; scoped ESLint/TypeScript/diff PASS. Свежие src/i18n/public/fonts изменения не заявлены. Это не пользовательская визуальная приёмка.

### 01.1.2 Совместимость всей системы
Status: done
Все общие элементы используют новую систему, readable contrast и disabled/loading не уничтожают подписи. Regression checks по реальным рискам; user-owned visual findings остаются needs-user-check до ответа.

Focused compatibility принята вместе с01.1.1. Общий стабильный checkpoint6a2f6c7 прошёл check-plan, diff check, typecheck/lint/unit/domain/locale/contracts и production build; отправлен в origin/main. Подключённые consumers компилируются, существующие API сохранены. Внешний вид остаётся пользовательской проверкой.

## 01.2 Объединить свободную сессию, материалы и рабочий контекст
Status: active
Requirements: R08, R10, R14, R16, R21, R25, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R76, R92, R97, R99, R103, R105, R106, R107, R108, R109
Depends on: none
Owner: SUBAGENT working_session
Paths: src/features/workspace/, src/features/materials/, src/features/sources/, src/features/runs/client/, src/features/runs/ui/, src/features/runs/locales/, tests/workspace/, tests/materials/, tests/sources/, src/app/api/projects/, src/app/api/materials/, src/app/api/sources/, src/app/app/work/, src/app/app/projects/, src/app/app/materials/, src/app/app/runs/

**Результат.** «Начать работу» открывает поле свободной задачи с вложениями сразу, без предварительного пустого проекта и длинной настройки. Сохранённые работы остаются рядом; «Создать материал» открывает ручной документ/таблицу/макет/план. Рабочая сессия удерживает разговор, источники, новые материалы, историю и переход обратно. Entry — существующие work-page/project-page/artifact-page; K1/K3 и C3–C6 являются единственными контрактами.

**Вход и данные.** Текст, PDF/DOCX/XLSX/CSV/TXT/изображения по C5; URL только существующим bounded importer. Несколько приложений к задаче могут содержать разные сроки/единицы. SourceVersion сохраняет оригинал и extracted text/rows/regions, DatasetVersion — подтверждённое mapping; preview исходника не называется результатом AI. Владелец подтверждает спорные columns/units/record keys, исправляет факты с provenance и undo. Library: поиск/фильтры/категории, versions, archived/trash, move/rename/duplicate и reuse с проверкой права на destination.

**Порядок.** Сначала composer держит выбранные файлы и текст как локальный незапущенный ввод. Явное «Начать» создаёт project через существующий API без отдельного экрана, затем существующие init → bytes PUT → finalize загружают файлы в этот project и только ready source refs запускают run. Pre-project server upload сейчас отсутствует; не изобретать новый staging storage ради пропуска одного экрана. Вход/ошибка сохраняют выбранные файлы в текущем контексте; после refresh честно обозначать файл, который нужно выбрать снова. Затем сохранение draft intent; реальный run snapshot/SSE K1, plan/questions/ready parts и восстановление по cursor. Подключить существующие editor mounts K3 и контекстные commands/history/export; закончить mapping/query/large dataset paths и все page states. Потребляет exports 01.6, tools 01.3, plan 01.4, design 02.2 по каноническим интерфейсам; может стартовать параллельно на готовом artifact/source boundary.

**Состояния.** Empty показывает конкретный ввод, loading — текущую операцию и уже пригодные материалы, partial — что пригодно и что требует данных. Invalid mapping/413/unsupported type сохраняют остальные файлы; cancel/retry не дублируют проект/run. 401 сохраняет ввод, 409 оставляет обе версии. Private/removed sources не раскрываются через поиск, citations или history. На узком экране разговор/материал переключаются без потери выделения.

### 01.2.1 Своя задача с собственными исходниками
Status: active
HTTP/DB: создать работу с двумя неоднородными источниками → mapping/correction → start run → reconnect; ACL и revision vectors реальны. 100k dataset читает страницы/агрегаты, не весь набор в браузер/LLM. P6 поддержан сервером; время и ясность оценивает пользователь.

### 01.2.2 Сохранённая работа и управляемые материалы
Status: active
Реальные редакторы mounted, reopen/history/move/trash/reuse и context return проверены через server/domain contracts. Список работ, результаты сессии и фактический artifact GET показывают одну ревизию; новые UI состояния включены в этот пакет.

Промежуточный whole-file handover включает собственные файлы в composer, idempotent project/upload/run recovery, source/session return context, lifecycle services и mounts. Current shared typecheck PASS; это не полный01.2 proof. Ещё требуются реальные lifecycle command cases, mapping/correction в общем own-work path и100k bounded dataset case. Money preview/action consumer также остаётся отдельным незавершённым соединением в01.2/02.1.

## 01.3 Научить харнесс доводить задачу до новых рабочих материалов
Status: active
Requirements: R01, R02, R03, R04, R05, R07, R08, R10, R12, R14, R15, R16, R17, R42, R43, R56, R75, R76, R79, R82, R83, R84, R85, R86, R90, R91, R96, R99, R100, R105, R106, R107, R109
Depends on: none
Owner: SUBAGENT harness_integration
Paths: src/features/agent-tools/, src/features/commercial/, src/features/runs/server/, src/features/runs/domain/, src/contracts/, src/server/db/, src/app/api/runs/, src/app/layout.tsx, src/app/app/layout.tsx, tests/agent-tools/, tests/commercial/, tests/runs/, evals/agent-tools/, evals/commercial/, package.json, package-lock.json, scripts/dev/, scripts/check.mjs, scripts/check-build.mjs, scripts/check-integration.mjs, scripts/eval-live.mjs, tests/foundation/, vitest.integration.config.ts, migrations/0021_library_lifecycle.sql, migrations/0022_demo_execution_scopes.sql, tests/database/library-lifecycle-schema.integration.test.ts

**Результат.** Свободная цель приводит к работе предметных инструментов и пригодному комплекту, а не к обещаниям в чате. Для J1: запрос клиента, нормы/прайс, текущие заказы, сроки и ресурсы → варианты выполнения с основаниями → выбор → связанные редактируемые смета, предложение и план. Цена сама по себе не является ценностью; убирается ручное согласование исходников, ограничений и выходных материалов. K1 сохраняет существующий strict DTO; K2 даёт новый планировщик, K3 — canonical commands и transactional bundle.

**Порядок.** Source/static reconcile принятой основы; принять экспортируемые tool descriptors и schemas каждого домена. Уточнить процедуры business.goal: evidence → unknowns → bounded tool work → consistency check → durable ready result → repair/continuation. Не добавлять обязательные вопросы, когда вход достаточен. Run/step/tool/projection SSE отражает commit, не имитирует token stream; потребителю доступны полезные части до завершения всей задачи. Предложения условий и выбор альтернатив имеют явное согласие, обычные внутренние операции — нет. Сохранить source revisions, costs/receipts, idempotency, cancel epoch и возобновление после сбоя.

**Интеграция.** Единственный владелец runtime tool registry, общих contracts/schema/migration registry/package files и указанных root layouts. Feature owners создают свои domain exports/routes, shared изменения передают сюда точным diff/contract; общая DB миграция имеет совместимость и rollback/restore plan без потери пользовательских данных. Базовая реализация J1 идёт параллельно 01.4; настоящий совместный proof обязателен до завершения пакета. J2/J3/J5 descriptors подключаются этим владельцем по готовности, общий join в 04.1. Только назначенный в STATE executor делает оплачиваемые вызовы; остальные используют deterministic fixtures с честной маркировкой.

Точный независимый subloan library_lifecycle внутри01.3: src/contracts/library-lifecycle.ts, src/contracts/sources.ts, src/contracts/materials.ts, src/server/db/library-lifecycle-schema.ts, migrations/0021_library_lifecycle.sql, tests/database/library-lifecycle-schema.integration.test.ts. Только этот worker пишет шесть файлов; metadataRevision источников/коллекций отделён от immutable content revision. Existing list query/summary schemas расширяются без второго DTO. Services/handlers/UI остаются01.2. Registration в src/server/db/schema.ts и vitest.integration.config.ts сохраняет harness_integration; root config loan включает классификацию реальных новых DB suites. Runtime/J1/demo этим subloan не разделяются.

**Проверка.** P1 с реальным economical endpoint и новым существенным ограничением: инструмент строит план, создаёт три typed artifacts, read-back совпадает, edit/reopen/export использует их же. Missing provider/invalid tool args/несовпадение units/timeout/cancel не даёт success; invalid model step исправляется ограниченно. Injection в файле не даёт authority. J1 прежнего кода проверен scripted gateway, это не live acceptance.

### 01.3.1 Совместимые предметные процедуры и tool loop
Status: active
Typed handlers, authoritative facts/calculations, projections и transaction receipts работают на domain/DB cases; malformed output, repeat invocation и late result имеют проверяемое поведение. Общие exports переданы потребителям без второго runtime.

Принят K5 producer substep: capability-hash-only scope на24часа, изолированные identity/workspace/project и synthetic resources/availability, real run authority/replay, token denial, revision conflict и explicit signed-in copy/replay. Isolated DB1/1 PASS; adapter authority/expiry2/2 и contracts+adapter6/6 PASS. Новый bounded workPreview≤18KB связан с exact artifactId/revision той же операции, сохраняется в context и SSE/reload; adapter+run contracts7/7 PASS. Producer независимо компилируется без новых demo consumer files, подтверждено узким dependency audit. Live J1 и consumer HTTP ещё не закрыты.

### 01.3.2 Живой полезный результат и интеграция инструментов
Status: active
P1 от настоящего входа до новых сохранённых материалов с проверкой выполнимости и выбором человека; paid receipt и budget записаны приватно. Domain descriptors подключены по готовности без параллельного registry ownership. Ограниченный live proof не объявляет все J2–J5 завершёнными.

## 01.4 Строить выполнимую работу с ресурсами и ограничениями
Status: done
Requirements: R01, R11, R14, R16, R34, R35, R40, R91, R92, R93, R94, R95, R109
Depends on: none
Owner: SUBAGENT work_planner
Paths: src/features/operations/, tests/operations/, evals/operations/, src/app/api/operations/

**Результат.** Из заказов/этапов, доступности людей и оборудования, материалов и сроков Tirlik сам предлагает размещение работ. Пользователь меняет дату/исполнителя/зависимость, закрепляет решение и получает пересчёт затронутого. План применим к услугам и производству, ресурсу не требуется аккаунт. Entry — редактор plan artifact и свободная задача K1; кнопки «Предложить расписание», «Закрепить», «Сравнить изменения», «Применить» сохраняют текущий контекст.

**Механизм.** K2 и C10: bounded deterministic search строит candidate assignments в canonical OperationalPlanContent, затем validateOperationalPlan и assessPlanCapacity проверяют тот же candidate. Текущий validator допускает строки без assignments: отдельно учитывать каждую active entry без назначения как unresolved, никогда не считать пустой план feasible. Учитывать units/effort/duration, calendars/availability exceptions, resource capabilities, зависимости, known deliveries, locked assignments и objective. Сохранять исходную версию доступности; unknown не превращать в 100% capacity. Infeasible требует доказанного противоречия, exhaustion даёт unknown. Модель может понять задачу и объяснить вариант, но не выдумывает свободное окно.

**Порядок.** Реализовать solver и proof receipts на canonical OperationalPlanContent; затем tool descriptor для 01.3 и ручной solve/compare/apply path; переработать plan/resource/availability UI по DESIGN, calendar/list/assignment detail, narrow alternative и экспорт ICS/PDF. Общие migration/schema changes через 01.3. Параллельно все 01–03, общие acceptance P1/P4.

Точный integration subloan: src/features/operations/server/ai-business-tool.ts после подтверждённого whole-file handover01.4 пишет только harness_integration для runtime/J1 wiring до handback. Остальные operations files остаются work_planner; параллельных writers одного файла нет.

### 01.4.1 Планировщик действительно находит решение
Status: done
Две конкурирующие работы/один ресурс/одна закреплена: найти свободный интервал другой; два ресурса/зависимость/выходной/нехватка материала покрыты domain cases. Изменённое ограничение меняет конкретное назначение; no-solution/unknown различимы.

Принят scoped handover work_planner: bounded proposeWorkPlan и authoritative resource snapshot reader; operations unit10files/42tests PASS, direct K2 7/7, scoped ESLint PASS. Проверены locks/dependencies/weekend, unknown materials, reassignment, infeasible vs exhausted, неназначенная active работа и invalid lock. Checkpoint6a2f6c7 включает готовые domain/reader/eval files и trusted J1 integration; все общие checks/build PASS, push origin/main. API/editor/apply остаются01.4.2 до своего proof.

### 01.4.2 План пригоден для работы и пересмотра
Status: done
Tool → candidate → human edit/lock → apply → reopen/export: revisions совпадают. Удалённый ресурс, concurrent apply и отозванное право не портят принятый план. Capacity conflict виден у задачи; пользователь проверяет удобство calendar/list и навигации.

Принят whole-file handover01.4.2: proposal HTTP/transport, plan input JSON Schema, persistent locks, candidate compare/apply с повторной проверкой content hash, pinned resource/availability revisions, локали и editor states.44 focused tests и5 isolated PostgreSQL/handler cases PASS, scoped ESLint/strict TypeScript/diff PASS. Actual-file bridge в tests/operations/service.integration.test.ts применяет candidate, заново читает сохранённый plan, архивирует ресурс и проверяет ICS через parsePlanCalendar и PDF через pdfjs: принятая revision, расписание и историческое имя ресурса совпадают. Bounded rerun5/5 PASS, миграция/seed/cleanup выполнены. Пакет передан без дальнейшей записи, ожидает следующего Git checkpoint; UI не проверялся браузером.

## 01.5 Сделать ясный вход, содержательный лендинг и живой пример
Status: active
Requirements: R02, R07, R08, R09, R10, R11, R15, R19, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R38, R39, R40, R41, R43, R44, R45, R46, R47, R48, R49, R56, R64, R75, R76, R82, R83, R90, R97, R98, R99, R101, R106, R107, R108, R109
Depends on: none
Owner: SUBAGENT first_use
Paths: src/features/public-site/, src/features/demo/, src/features/onboarding/, src/features/identity/, public/site/, tests/public-site/, tests/demo/, tests/onboarding/, tests/identity/, src/app/page.tsx, src/app/demo/, src/app/api/demo/, src/app/api/auth/, src/app/auth/, src/app/app/profile/

**Результат.** DESIGN задаёт выразительный сайт с предметной сценой, разными работами, конкретными результатами, входом и полезным футером. «Попробовать пример» открывает synthetic заказ на занятую неделю; «Начать работу» сохраняет своё намерение. Лендинг не содержит отчёт разработчика/техническую архитектуру/тарифы. Пользователь понимает смысл за пять секунд и получает существенный результат примерно за две минуты; это цель timed pass, не выдуманный показатель.

**Порядок.** Пересобрать landing/copy/composition и routes, затем K5 isolated demo на тех же инструментах/typed editors, auth lifecycle/profile/logout/return intent и короткий контекстный onboarding. Имя/слоган неизменны. Наблюдение страницы/тура не создаёт личный проект; «Сохранить в своей работе» после входа создаёт одну явную копию с refs. Cancel входа оставляет временные правки. Не использовать старое «поменяй цену и сохрани слова» как основное доказательство.

**Границы.** 01.3 предоставляет canonical demo execution scope/runtime extension; 01.2 предоставляет source-add semantic anchors и workspace resume, этот пакет не пишет их страницы. `/demo` и API имеют явные routes K5; demo export использует canonical 01.6. Можно начать сайт/auth/контроллеры параллельно по контрактам; закрыть K5 только реальным producer, не scripted gateway. Видео slot предусмотрен, сам ролик приходит из 05.2.

Exact producer subloan01.3: новый src/features/demo/server/execution-scope.ts пишет исключительно harness_integration; first_use потребляет его exports и сохраняет остальные demo routes/client/UI/tests. Canonical migration migrations/0022_demo_execution_scopes.sql принадлежит harness_integration;0021 зарезервирована library_lifecycle. Wire/schema contracts согласуются напрямую между этими двумя владельцами, без дублирующего demo runtime.

**Состояния.** Auth failed/cancel/signed-out/stale cookies, session expired, provider unavailable, rate cap, partial result и retry сохраняют контекст. Onboarding skip/resume/replay не делает неожиданный переход в «Материалы» и не запускается вновь после refresh. RU/KK/EN и mobile сохраняют CTA/пример/профиль, все public/private границы server-checked.

### 01.5.1 Новый сайт и сохранённое намерение
Status: active
Content/route/HTTP/auth checks подтверждают правильные действия, profile/menu/logout и return. F001–F012 читаются полностью; проверка кода не закрывает пользовательскую оценку визуала и понятности.

### 01.5.2 Полезный пример на настоящем механизме
Status: active
P6 и K5: start → real plan/materials → change one constraint → explicit copy → reopen. No unwanted records, isolation/TTL/rate/cancel/duplicate-copy проверены через HTTP/DB. Первые две минуты и UX принимает пользователь.

## 01.6 Довести документы, таблицы и файлы до полноценной работы
Status: active
Requirements: R10, R12, R13, R14, R16, R25, R34, R35, R36, R39, R40, R42, R43, R44, R45, R91, R92, R93, R94, R95, R102, R105
Depends on: none
Owner: SUBAGENT editable_materials
Paths: src/features/artifacts/, src/features/documents/, src/features/sheets/, src/features/exports/, tests/artifacts/, tests/documents/, tests/sheets/, tests/exports/, src/app/api/artifacts/, src/app/api/documents/, src/app/api/sheets/, src/app/api/exports/

**Результат.** Новый документ/таблица создаётся вручную или инструментом и открывается именно редактором. Существующий artifact/version/commands engine сохраняется. Document: полноценные блоки/таблицы/списки/ссылки/изображения/формат/find/selection. Sheet: formulas, ranges, copy/paste/fill, insert/delete, sort/filter/freeze/find, formats и связанные charts; narrow — редактирование выбранной ячейки с координатами. Справки источников не заслоняют материал.

**Контракт.** C6/C7/C9 и K3: stable target IDs, prepared CalculationSpec authoritative server engine, same revision display/export, manual overrides и undo/redo. Dataset query API принадлежит 01.2; финансовые правила 02.1. Формулы вне поддержанного subset дают явную ошибку, cached value не подменяет вычисление. Money uses ISO scales, mixed units/FX требуют заданных преобразований. Import bounded 20k workbook view из 100k dataset; не обещать всю Office-совместимость.

**Порядок.** Reconcile WIP команд/расчётов; довести оба редактора и весь сохранённый lifecycle, затем DOCX/PDF/XLSX/CSV и переносимый editable format с revision vector, source policy/redaction и loss notices. Экспорт создаёт реальный файл; preview/download/error/retry сохраняют выбор. No headless UI rendering; использовать уже принятые data-only exporters. Параллельно 01.2/02.1; shared contracts/migrations только через 01.3. Mount остаётся у 01.2.

### 01.6.1 Полноценные правки и проверяемые вычисления
Status: active
Golden formulas/rounding/structural edits, manual override/undo, stale command409, source lineage и DB reopen. Прежний факт наличия редактора не заменяет этот полный path.

Принят готовый UI/editor подшаг: shared lifecycle menu и его01.2 mount, поиск previous/next matches, unknown-cell count, unregister flush callbacks, source freshness/manual-override presentation и переработанные document/sheet/export surfaces. Whole-file handover eight owned files+artifact-page,251 owned tests/scoped ESLint/typecheck PASS; user visual acceptance отсутствует. Полный stage proof требует server/DB/reopen/export integration после общего checkpoint; эта запись не закрывает01.6 целиком.

### 01.6.2 Пригодные согласованные файлы
Status: active
Actual OOXML/PDF/CSV структуры/Unicode/formula caches проверены без браузера, export revision совпадает с GET. Redaction/private citations, unsupported styles, formula injection и повтор скачивания имеют устойчивое поведение; оформление открытого файла смотрит пользователь.

Свежий isolated DB proof:5files/39tests PASS по artifacts/project-sources/retention/exports/calculation. Strengthened frozen DOCX/PDF/XLSX/CSV job:1file/11tests PASS; парсинг PDF/OOXML/XLSX/CSV подтверждает ручную русскую фразу, формулуA2+B2=143600 и тот же revision vector. Дополнительно4files/17tests по форматам/glyph errors/formula injection PASS. Mounted HTTP proof повторяется после исправления shared startup schema; полный01.6 пока не закрыт.

Разрыв mapped fact freshness закрыт: canonical readMaterialSourceFreshness используется artifact snapshot/retained reads. Reviewed current fact разрешает normal export; correction делает старую fact revision stale; unreviewed/unknown/missing и отозванный project grant не раскрывают закрытые факты и не получают false current. Actual material import/correction/export regression7/7 и повтор только затронутых5DB files40/40 PASS с migrate/seed/cleanup.02.1 подтвердил normal XLSX/DOCX без historicalDraft. Три новых whole files готовы к checkpoint. Остался mounted HTTP proof, который выполняется последовательно после demo runner; bounded cold-health allowance240s не меняет application assertions.
