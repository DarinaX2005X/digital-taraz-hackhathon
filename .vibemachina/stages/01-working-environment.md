# 01 Новая рабочая среда и первый полезный результат
Status: active

Пользователь приносит задачу и материалы, получает пригодный новый результат и может сразу работать с ним. Новый сайт объясняет это за несколько секунд. Шесть самостоятельных пакетов заменяют прежнее дробление основы, редакторов, AI и первого входа; готовые механизмы не переписываются без причины.

Общие требования, контракты K0–K6, проверки P1–P6 и правила передачи: [PLAN](../PLAN.md). Все интерфейсы следуют [DESIGN](../DESIGN.md), включая RU/KK/EN, keyboard/touch, narrow, hover/pressed/focus/selected и сохранение контекста при ошибке. Paths эксклюзивны; root wiring и общие schemas принадлежат 01.3. Параллельный старт разрешён по утверждённым contracts; обязательные producer handovers до done перечислены в PLAN и не заменяются fixtures; интегрированный результат всех пакетов принимает 04.1.

## 01.1 Переписать общую визуальную систему
Status: done
Requirements: R09, R31, R32, R33, R34, R38, R39, R40, R44, R45, R46, R47, R48, R49, R60, R101, R108
Depends on: none
Owner: SUBAGENT shared_controls
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

F013 вновь открыл конкретный shared regression: idle loading indicator оставляет пустое место у «Начать обучение», а hover светлого состояния сохраняет белую подпись у нескольких кнопок. shared_controls получает точечное продолжение общих controls/CSS с проверкой реальных color pairs и idle/busy geometry; feature overrides исправляет01.2. Это не повтор полной визуальной переработки.

Shared F013 repair принят: Button при pending=false не выводит пустой icon slot, spinner существует только в busy; симметричный padding центрирует подпись без изменения API/aria-busy/disabled. Secondary/quiet hover: #17332E на #EAF0EC, contrast11.73:1; danger #B42318 на #FDECE8,5.74:1. Focused UI contracts8files/73tests, scoped ESLint и diff PASS. Четыре whole files src/ui/button.tsx,src/ui/controls.css,tests/ui-contracts/control-contracts.test.ts,tests/ui-contracts/tokens.test.ts сохранены в bb70f61, writer остановлен. Пользовательская визуальная проверка остаётся отдельной границей.

## 01.2 Объединить свободную сессию, материалы и рабочий контекст
Status: active
Requirements: R08, R10, R14, R16, R21, R25, R26, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R76, R92, R97, R99, R103, R105, R106, R107, R108, R109
Depends on: none
Owner: SUBAGENT session_integration
Paths: src/features/workspace/, src/features/materials/, src/features/sources/, src/features/runs/client/, src/features/runs/ui/, src/features/runs/locales/, tests/workspace/, tests/materials/, tests/sources/, src/app/api/projects/, src/app/api/materials/, src/app/api/sources/, src/app/app/work/, src/app/app/materials/, src/app/app/runs/

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

Промежуточный whole-file handover включает собственные файлы в composer, idempotent project/upload/run recovery, source/session return context, lifecycle services и mounts; сохранён f04ff7c с общими checks/build PASS. Дополнительный tests/workspace/own-work-lifecycle.integration.test.ts расширен до3 realDBcases и PASS: mapping/correction→runrefs→selected-artifact reopen; destination ACL/replay/body mismatch/move/duplicate/independent edits/trash/restore;100k mapped rows, две bounded50-row pages, exactaggregate и10-row context. Прежний owner завершил запись; новый session_integration получает продолжение UI/transport, без повторной реализации этих сервисов. Остаток: money preview/action consumer, F013 hover overrides и общий рабочий интерфейс demo по K5 injectable transport.

Следующий handover session_integration принят как quiescent: реальные Finance/Forecast/ProcurementWorkspaces mounted, явный recalculation обновляет локальный preview и ссылки base/branch без изменения исторической Run projection. AssistantSession принимает явные scoped transport/hrefs, auth defaults сохранены. Source init освобождён от eager OCR/Sharp/Office/полного registry: лёгкий source-format и динамическое извлечение по необходимости. Scoped session/source lint и20source tests PASS. ONEsource97a27fb прошёл init201, PUT200/replay409, finalize200, version/detail/list/library/preview/original200 за74–103ms; исходный503 устранён. Общий HTTP test истёк90s только при cold compile страницы исходника, поэтому целиком PASS не заявляется. Demo consumer и mounted HTTP остаются следующей границей.

Собственные checkpoints01.2.1/01.2.2 приняты в bb70f61 с прежними3DBcases и дополнительным mounted production proof01.6: upload/import/edit/undo/calculate/export4/4 и artifact lifecycle/page/access1/1. Контракты возврата, revision-aware editors, собственные неоднородные источники и bounded100k query проверены; внешний вид не проверялся. Активной записи01.2 больше нет. Parent01.2 ожидает обязательный финальный handover01.3.1; demo consumer относится к01.5.2, а не новому параллельному редактору.

F018–F021 reopened: original PDF6350471bytes сохранён; finalize PDF.js exception потерян в broad catch, повтор exactbytes/всех30pages/fullpipeline успешен. Исходная production причина ещё не установлена; успешный source parser не исключает bundle/worker-path проблему. Cancel возник от явного удаления в UI, его нельзя самовольно отменять. Последнее уточнение пользователя: уже найденное исправить сейчас; только общий поиск остальных цветовых дефектов оставить04.

Source handover F018–F021 DONE/quiescent: failed/processing stored upload повторно finalized без File/reupload, explicit Remove сохраняет cancel; безопасная диагностика PDF не пишет содержимое. Source DB10/10 включает6.35MB/30pages stored-original retry. Persistent composer хранит draft/intent key, flush+refresh передаёт точный currentArtifact, definite409 обновляет контекст без потери ввода; readonly ancestry загружается порциями. Исправлены найденные контрасты header/result hover/paper-form, межпанельный отступ и внутренний scroll документа с доступным toolbar. Focused29tests/lint/diff и общий typecheck PASS. Подготовлен mounted6–7MBPDF HTTP init/PUT/failed→retry/finalize/preview/original-byte-identity, требуется новый production build. Без этого initial production failure не закрывается; visual findings ждут пользователя.

Пакет сохранён и отправлен7bd3233 вместе с текущим F021 runtime и F024 demo producer/consumer. Все4configured checks и production build PASS, без исключённых sourceWIP. Fresh production8vK16tlitbA51RS2VLcAq/health200 поднят; UI приёмка не заявлена.

F018 compiled-runtime repair принят на9b4c339: explicit PDF worker loader общий дляextract/OCR, parser14/14PASS. Mounted run e6d09f461af748fa9a9ed537179cce3c прошёл2/2 за16.38s: valid6–7MiB30-page PDF, init/PUT, stored failed→same-upload finalize→ready manifest30pages/30fragments/complete, preview и original byte identity/SHA ETag/security/stream headers. Второй case проверил source/library/access/partial scan/recognition/page image. Migrate/seed/production mount/cleanup PASS. Это дополняет прежний DB proof exact stored user PDF6.35MB/30pages; UI не автоматизировался.

F026 новый scoped repair material_completion готов/quiescent: technical save/continuation note удалён RU/KK/EN, существующий пример стал textarea placeholder. Document toolbar отделяет tools/save и использует container720/480 flow, сохраняя autosave/revisions/undo/status. Четыре точных loans вSTATE, lint/diff и existing13/13tests PASS. Требуется новая live сборка и пользовательская визуальная проверка.

## 01.3 Научить харнесс доводить задачу до новых рабочих материалов
Status: active
Requirements: R01, R02, R03, R04, R05, R07, R08, R10, R12, R14, R15, R16, R17, R26, R42, R43, R56, R75, R76, R79, R82, R83, R84, R85, R86, R90, R91, R96, R99, R100, R105, R106, R107, R109, R110
Depends on: none
Owner: SUBAGENT runtime_completion
Paths: src/features/agent-tools/, src/features/commercial/, src/features/runs/server/, src/features/runs/domain/, src/contracts/, src/server/db/, src/app/api/runs/, src/app/layout.tsx, src/app/app/layout.tsx, tests/agent-tools/, tests/commercial/, tests/runs/, evals/agent-tools/, evals/commercial/, package.json, package-lock.json, scripts/dev/, scripts/check.mjs, scripts/check-build.mjs, scripts/check-integration.mjs, scripts/eval-live.mjs, tests/foundation/, vitest.integration.config.ts, migrations/0021_library_lifecycle.sql, migrations/0022_demo_execution_scopes.sql, tests/database/library-lifecycle-schema.integration.test.ts

**Результат.** Свободная цель приводит к работе предметных инструментов и пригодному комплекту, а не к обещаниям в чате. Для J1: запрос клиента, нормы/прайс, текущие заказы, сроки и ресурсы → варианты выполнения с основаниями → выбор → связанные редактируемые смета, предложение и план. Цена сама по себе не является ценностью; убирается ручное согласование исходников, ограничений и выходных материалов. K1 сохраняет существующий strict DTO; K2 даёт новый планировщик, K3 — canonical commands и transactional bundle.

**Порядок.** Source/static reconcile принятой основы; принять экспортируемые tool descriptors и schemas каждого домена. Уточнить процедуры business.goal: evidence → unknowns → bounded tool work → consistency check → durable ready result → repair/continuation. Не добавлять обязательные вопросы, когда вход достаточен. Run/step/tool/projection SSE отражает commit, не имитирует token stream; потребителю доступны полезные части до завершения всей задачи. Предложения условий и выбор альтернатив имеют явное согласие, обычные внутренние операции — нет. Сохранить source revisions, costs/receipts, idempotency, cancel epoch и возобновление после сбоя.

**Интеграция.** Единственный владелец runtime tool registry, общих contracts/schema/migration registry/package files и указанных root layouts. Feature owners создают свои domain exports/routes, shared изменения передают сюда точным diff/contract; общая DB миграция имеет совместимость и rollback/restore plan без потери пользовательских данных. Базовая реализация J1 идёт параллельно 01.4; настоящий совместный proof обязателен до завершения пакета. J2/J3/J5 descriptors подключаются этим владельцем по готовности, общий join в 04.1. Только назначенный в STATE executor делает оплачиваемые вызовы; остальные используют deterministic fixtures с честной маркировкой.

Завершённый subloan library_lifecycle внутри01.3: src/contracts/library-lifecycle.ts, src/contracts/sources.ts, src/contracts/materials.ts, src/server/db/library-lifecycle-schema.ts, migrations/0021_library_lifecycle.sql, tests/database/library-lifecycle-schema.integration.test.ts. Writer остановлен, принятые шесть файлов сохраняются; metadataRevision источников/коллекций отделён от immutable content revision. Services/handlers/UI остаются01.2. Registration в src/server/db/schema.ts и vitest.integration.config.ts принадлежит runtime_completion; root config loan включает классификацию реальных новых DB suites. Runtime/J1/demo этим subloan не разделяются.

**Проверка.** P1 с реальным economical endpoint и новым существенным ограничением: инструмент строит план, создаёт три typed artifacts, read-back совпадает, edit/reopen/export использует их же. Missing provider/invalid tool args/несовпадение units/timeout/cancel не даёт success; invalid model step исправляется ограниченно. Injection в файле не даёт authority. J1 прежнего кода проверен scripted gateway, это не live acceptance.

F013: сначала измерить причины медленных local HTTP/compiles и роста .local-data; read-only runtime_efficiency под01.3 исследует процессы/нагрузку/storage и source startup boundary без UI/новых компиляторов. Правки и очистка только после конкретного handover, через существующего exclusive integration owner; пользовательские данные/active runtimes не удаляются. Полная повторная performance/storage проверка остаётся04.1/04.4.

R110 audit принят: cold /settings111s содержит107s Next compile и3.2s application; editor packages на этом пути отсутствуют, root/identity barrels расширяют graph. Runtime owner вводит direct leaf imports и явный production launcher после новой проверенной сборки. Пользователь F015 подтвердил задержки на разных страницах, поэтому итоговая проверка включает несколько маршрутов. Безопасно удалено4,195,802,981bytes неактивных compiler/test caches с сохранением logs/DB/user files. После принадлежащего приложению restart working set4.800GB→1.830GB, private6.800GB→2.112GB; это cold health baseline, не равная прогретая нагрузка и не закрытие performance задачи.

Read-only checkpoint_boundary (Paths: none) проверил dependency closure143selected paths относительно HEADf04ff7c: auth removal/leaf imports, money/session/source/editor adapters и runtime producer/launcher. Recursive static resolution470local modules:0unresolved imports,0crossings в13excluded demo consumer WIP paths. F017 показал предел проверки: nullable callback type mismatch старого HEADconsumer остался незамеченным и маскировался локальным WIP. Цельный source snapshot7f91823 без excluded WIP прошёл все4helper checks и push; F017 исправлен, cloud deployment не проверялся.

### 01.3.1 Совместимые предметные процедуры и tool loop
Status: active
Typed handlers, authoritative facts/calculations, projections и transaction receipts работают на domain/DB cases; malformed output, repeat invocation и late result имеют проверяемое поведение. Общие exports переданы потребителям без второго runtime.

Принят K5 producer substep: capability-hash-only scope на24часа, изолированные identity/workspace/project и synthetic resources/availability, real run authority/replay, token denial, revision conflict и explicit signed-in copy/replay. Isolated DB1/1 PASS; adapter authority/expiry2/2 и contracts+adapter6/6 PASS. Новый bounded workPreview≤18KB связан с exact artifactId/revision той же операции, сохраняется в context и SSE/reload; adapter+run contracts7/7 PASS. Producer независимо компилируется без новых demo consumer files, подтверждено узким dependency audit. Live J1 и consumer HTTP ещё не закрыты.

### 01.3.2 Живой полезный результат и интеграция инструментов
Status: active
P1 от настоящего входа до новых сохранённых материалов с проверкой выполнимости и выбором человека; paid receipt и budget записаны приватно. Domain descriptors подключены по готовности без параллельного registry ownership. Ограниченный live proof не объявляет все J2–J5 завершёнными.

F022 исправлен7f91823: reservation call_key включает identity конкретного step вместе с epoch/attempt; последовательные business.decide больше не сталкиваются по unique(run_id,call_key). Replay того же step остаётся идемпотентным.17unit/35DB PASS, run7f2e9602b4ac41dab8f4540570dc1df2 cleaned; общийbuildPASS. Существующий failed parent не удаляется/не запускается повторно: canonical human continuation с goal создаёт связанный child и сохраняет материалы. F021 добавляет выбранный artifact/revision в этот child и безопасные document commands. Real paid P1 остаётся обязательным.

F021 producer сохранён7bd3233: ResumeRun.currentArtifact{id,revision} проверяет same-project ACL/current head, child input context использует canonical inputRefs. revise_document применяет bounded canonical commands с locks/baseRevision/target hashes, старые ручные правки сохраняются; stale head409. Human conversation не ограничена artificial depth2/12, automatic step/request/cost limits сохранены. Runtime/business40/40DB (включая13human follow-ups), procedure3/3, type/lint/generalchecks/build PASS. Real P1v2/v3 остановлены на malformed arguments/неподходящем source-only finance tool для artifact-only context; committed gating/replay guard уже есть, следующий repair делает descriptors applicability общим. Полный3artifact+currentArtifact follow-up/export proof НЕ завершён; settled costs/history сохранены в budget ledger/STATE. Invalid model output не трактуется как отсутствующий ответ человека.

Следующий runtime handover готов: applicability predicate проверяется и при выдаче, и при выполнении tools; source-backed descriptors недоступны без pinned sources/datasets. Settled malformed output получает максимум один business_decision_correction с ограниченными ошибками и резервом≤USD0.15, затем invalid_result; это не blind retry неизвестного платежа и не ask_user. Exact positive USD config TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD(default10) применяется к activation/readiness; существующий grant можно только атомарно уменьшить при reserved0 и spent≤нового cap. Isolated runtime/business run f2ea9aa9b53d44fe86d3f76d83f036b4:43/43 PASS, migrate/seed/cleanup. Ignored local config=2; сам grant и paidP1 меняются только после matching fresh build и остановки old dispatcher. Runtime продолжает отдельный03.2 bridge; общий build/live proof ещё не завершён.

## 01.4 Строить выполнимую работу с ресурсами и ограничениями
Status: done
Requirements: R01, R11, R14, R16, R34, R35, R40, R91, R92, R93, R94, R95, R109
Depends on: none
Owner: SUBAGENT work_planner
Paths: src/features/operations/, tests/operations/, evals/operations/, src/app/api/operations/

**Результат.** Из заказов/этапов, доступности людей и оборудования, материалов и сроков Tirlik сам предлагает размещение работ. Пользователь меняет дату/исполнителя/зависимость, закрепляет решение и получает пересчёт затронутого. План применим к услугам и производству, ресурсу не требуется аккаунт. Entry — редактор plan artifact и свободная задача K1; кнопки «Предложить расписание», «Закрепить», «Сравнить изменения», «Применить» сохраняют текущий контекст.

**Механизм.** K2 и C10: bounded deterministic search строит candidate assignments в canonical OperationalPlanContent, затем validateOperationalPlan и assessPlanCapacity проверяют тот же candidate. Текущий validator допускает строки без assignments: отдельно учитывать каждую active entry без назначения как unresolved, никогда не считать пустой план feasible. Учитывать units/effort/duration, calendars/availability exceptions, resource capabilities, зависимости, known deliveries, locked assignments и objective. Сохранять исходную версию доступности; unknown не превращать в 100% capacity. Infeasible требует доказанного противоречия, exhaustion даёт unknown. Модель может понять задачу и объяснить вариант, но не выдумывает свободное окно.

**Порядок.** Реализовать solver и proof receipts на canonical OperationalPlanContent; затем tool descriptor для 01.3 и ручной solve/compare/apply path; переработать plan/resource/availability UI по DESIGN, calendar/list/assignment detail, narrow alternative и экспорт ICS/PDF. Общие migration/schema changes через 01.3. Параллельно все 01–03, общие acceptance P1/P4.

Точный integration subloan: src/features/operations/server/ai-business-tool.ts после whole-file handover01.4 пишет только runtime_completion для runtime/J1 wiring до handback. Остальные operations files переданы work_planner и quiescent; параллельных writers одного файла нет.

### 01.4.1 Планировщик действительно находит решение
Status: done
Две конкурирующие работы/один ресурс/одна закреплена: найти свободный интервал другой; два ресурса/зависимость/выходной/нехватка материала покрыты domain cases. Изменённое ограничение меняет конкретное назначение; no-solution/unknown различимы.

Принят scoped handover work_planner: bounded proposeWorkPlan и authoritative resource snapshot reader; operations unit10files/42tests PASS, direct K2 7/7, scoped ESLint PASS. Проверены locks/dependencies/weekend, unknown materials, reassignment, infeasible vs exhausted, неназначенная active работа и invalid lock. Checkpoint6a2f6c7 включает готовые domain/reader/eval files и trusted J1 integration; все общие checks/build PASS, push origin/main. API/editor/apply остаются01.4.2 до своего proof.

### 01.4.2 План пригоден для работы и пересмотра
Status: done
Tool → candidate → human edit/lock → apply → reopen/export: revisions совпадают. Удалённый ресурс, concurrent apply и отозванное право не портят принятый план. Capacity conflict виден у задачи; пользователь проверяет удобство calendar/list и навигации.

Принят whole-file handover01.4.2: proposal HTTP/transport, plan input JSON Schema, persistent locks, candidate compare/apply с повторной проверкой content hash, pinned resource/availability revisions, локали и editor states.44 focused tests и5 isolated PostgreSQL/handler cases PASS, scoped ESLint/strict TypeScript/diff PASS. Actual-file bridge в tests/operations/service.integration.test.ts применяет candidate, заново читает сохранённый plan, архивирует ресурс и проверяет ICS через parsePlanCalendar и PDF через pdfjs: принятая revision, расписание и историческое имя ресурса совпадают. Bounded rerun5/5 PASS, миграция/seed/cleanup выполнены. Пакет сохранён в checkpointf04ff7c, все общие checks/build PASS, push origin/main; UI не проверялся браузером.

## 01.5 Сделать ясный вход, содержательный лендинг и живой пример
Status: active
Requirements: R02, R07, R08, R09, R10, R11, R15, R19, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R38, R39, R40, R41, R43, R44, R45, R46, R47, R48, R49, R56, R64, R67, R75, R76, R82, R83, R90, R97, R98, R99, R101, R106, R107, R108, R109
Depends on: none
Owner: SUBAGENT first_entry_finish
Paths: src/features/public-site/, src/features/demo/, src/features/onboarding/, src/features/identity/, public/site/, tests/public-site/, tests/demo/, tests/onboarding/, tests/identity/, src/app/page.tsx, src/app/demo/, src/app/api/demo/, src/app/api/auth/, src/app/auth/, src/app/app/profile/

**Результат.** DESIGN задаёт выразительный сайт с предметной сценой, разными работами, конкретными результатами, входом и полезным футером. «Попробовать пример» открывает synthetic заказ на занятую неделю; «Начать работу» сохраняет своё намерение. Лендинг не содержит отчёт разработчика/техническую архитектуру/тарифы. Пользователь понимает смысл за пять секунд и получает существенный результат примерно за две минуты; это цель timed pass, не выдуманный показатель.

**Порядок.** Пересобрать landing/copy/composition и routes, затем K5 isolated demo на тех же инструментах/typed editors, auth lifecycle/profile/logout/return intent и короткий контекстный onboarding. Имя/слоган неизменны. Наблюдение страницы/тура не создаёт личный проект; «Сохранить в своей работе» после входа создаёт одну явную копию с refs. Cancel входа оставляет временные правки. Не использовать старое «поменяй цену и сохрани слова» как основное доказательство.

**Границы.** 01.3 предоставляет canonical demo execution scope/runtime extension; 01.2 предоставляет source-add semantic anchors и workspace resume, этот пакет не пишет их страницы. `/demo` и API имеют явные routes K5; demo export использует canonical 01.6. Можно начать сайт/auth/контроллеры параллельно по контрактам; закрыть K5 только реальным producer, не scripted gateway. Видео slot предусмотрен, сам ролик приходит из 05.2.

Exact producer subloan01.3: src/features/demo/server/execution-scope.ts пишет исключительно runtime_completion; first_entry_finish потребляет его exports и сохраняет остальные demo routes/client/UI/tests. Canonical migration migrations/0022_demo_execution_scopes.sql принадлежит runtime_completion;0021 завершена library_lifecycle. Wire/schema contracts согласуются напрямую между текущими владельцами, без дублирующего demo runtime.

Текущий01.5 owner first_entry_finish получил exclusive F014 loan migrations/0023_remove_email_verification.sql и src/server/db/identity-schema.ts; runtime_completion подтвердил отсутствие записи в оба пути. Удаляется только identity_email_tokens; identity_verifications для password recovery и identity_invitations сохраняются. Existing migrate.ts автоматически читает sorted SQL, нового registry нет. Execution-scope/0022 остаются runtime_completion.

**Состояния.** Auth failed/cancel/signed-out/stale cookies, session expired, provider unavailable, rate cap, partial result и retry сохраняют контекст. Onboarding skip/resume/replay не делает неожиданный переход в «Материалы» и не запускается вновь после refresh. RU/KK/EN и mobile сохраняют CTA/пример/профиль, все public/private границы server-checked.

Последующее F013 и прямое уточнение16октября входят в эту же задачу: полностью удалить email verification, включая optional flow/UI/routes/code/mail/callback/guard/locales; signup сразу выдаёт сессию, login email/password. Одна primary hero action по auth state, равные video/deck actions со SVG и широкий зелёный example band по DESIGN. Обычный demo workspace переиспользует01.2 session/editor components и настоящие K5 scoped endpoints, а не отдельный UI. Реальный найденный auth defect safe /ru/demo→/app устраняется здесь. Commercial decision и workDecision оба позволяют явно продолжить до сохранённых материалов; голое HTTP200 не закрывает пример.

### 01.5.1 Новый сайт и сохранённое намерение
Status: done
Content/route/HTTP/auth checks подтверждают правильные действия, profile/menu/logout и return. F001–F012 читаются полностью; проверка кода не закрывает пользовательскую оценку визуала и понятности.

F014 функционально закрыт: HTTP/PostgreSQL/Mailpit lifecycle d2d03b630d764fbfa3e373d393127ed6 —4/4PASS. Signup сразу выдаёт сессию, другой device входит email/password, удалённые verify/resend routes404 и писем подтверждения нет; password recovery/session revocation/intent binding сохранены. Focused10files102tests/type/lint PASS. F015/F016 добавляют readable hover example band и цельный layout login/signup без отдельного language selector, с сохранением текущей локали сайта:48focusedtests/type/lint PASS. Полный public/auth handover принят в checkpointbb70f61, общие checks/build PASS и push origin/main; production builddih-b34RQAb0LZqhXkjFT уже работает59850. F015/F016 —needs-user-check, визуальную приёмку эти проверки не заменяют. Живой K5 consumer остаётся01.5.2.

### 01.5.2 Полезный пример на настоящем механизме
Status: active
P6 и K5: start → real plan/materials → change one constraint → explicit copy → reopen. No unwanted records, isolation/TTL/rate/cancel/duplicate-copy проверены через HTTP/DB. Первые две минуты и UX принимает пользователь.

F024 source handover DONE/quiescent: ordinary authenticated operations API был ошибочно вызван из demo без user session. Canonical operations UI теперь принимает capability-scoped transport/routes для resources/availability/propose; seeded resources подтверждены. Today nowrap. Старый failed run сохраняется, новое явное действие создаёт fresh root из текущих saved revisions. Typecheck/lint/demo+operations10tests/diff PASS. Подготовлен mounted HTTP resources/history/proposal/apply/revision/foreign-scope404/failed-root-restart; требуется fresh build. Прежний6/6HTTP не доказывал эти действия, UI проверяет пользователь.

F024 canonical locks включены9b4c339; новая mounted проверка подтвердила locks, но обнаружила невозможные960continuous minutes при480/day. Следующий coherent repair сохраняет authoritative09–17 Asia/Qyzylorda и корректирует UTC instants. Поддержанный source facts первый выпуск540min/9m² представлен явно неутверждёнными dependent phases120+420; full960/18m², stock11 и supplierThu14 остаются видны. Narrow existing-scope repair только untouched canonical rev0 сохраняет любую human edit/unlock; DB9cc4299c6aad41ecaf845c58f26e417a2/2PASS. SourceHTTP4448ca29ed434028990424855f405ef1 достиг proposal/apply/PDF200, полный run не PASS из-за colddev compile и obsolete restart revision assertion; последняя исправлена по freshly read scope. Production rerun обязателен после новой сборки.

F017: пользователь сообщил TS2769 в GitHub/Cloudflare build на committed demo-page.tsx:112 — старый onFlushReady не допускает null при снятии обработчика. Локальный WIP уже заменил этот consumer и скрыл несовместимость исключённого из bb70f61 файла; прежний bounded import review этого type-level разрыва не обнаружил. Исправлено цельным K5 handover7f91823: все semantic source changes вошли в commit, TypeScript/lint/tests/build PASS, push origin/main. Cloud deploy/probes не назначены.

Whole-file K5 handover готов и quiescent: SAME AssistantSession + ArtifactWorkspacePage, scoped editable saved inputs/decision/changed goal/export/explicit copy/reopen. Dev-source HTTP14d4de5dd89b4a25a65f358507e51a93 —6/6PASS (edit/history/versions/events/PDF/run/goal change/auth copy/reopen/idempotency/expiry/CSRF), isolated app/containers/volume cleaned, ordinary59850 untouched. Typecheck/focusedlint/contracts6/6/diff PASS. F017 nullable callback устранён заменой старого direct editor mount. До закрытия01.5.2 остаётся realP1 handover01.3.2; пользовательская визуальная оценка отдельна.

F023 выявил недоделку общей композиции уже в новом K5 source: гигантский marketing hero/24h privacy card остались над общими editors. First_entry_finish получил bounded release только demo files: сразу ordinary workspace composition/compact example label/prepared files/tasks, без отдельного landing shell. Route/contracts прежние; HTTP6/6 повторять только при значимом изменении поведения. Runtime одновременно исправляетF022 gateway collision: три реальных user runs успешно выполняли первый model/tool step, второй business.decide падал до charge из-за call_key безstepId. Gateway+regression repair обязателен передP1, сохранённые user results не потеряны.

F023 final handover: giant hero/privacy Surface/numbered case/footer удалены; compact example context, ordinary project header, prepared inputs/tasks и одна workspace composition до/послеstart. SAME AssistantSession/ArtifactWorkspacePage, capabilities/TTL/copy/routes сохранены. Final type/lint/contracts6/6/diff PASS; прежний6/6HTTP применим к неизменённым routes/contracts. F022 gateway: stable16-hex SHA256step fingerprint в attempt/call key; lookupOperation сначала возвращает completed semantic step без нового reserve/provider. Unitgateway17/17 и isolatedDBruntime35/35(run7f2e9602b4ac41dab8f4540570dc1df2,cleanup) PASS, type/lint/diff PASS. Весь пакет сохранён7f91823, все4helper checks/push PASS; freshproduction4cz_E5A9OJTuul_fHgj7g, /ru/demo200. F023needs-user-check, real paid P1 остаётся01.3.2; внешний вид не проверялся агентами.

## 01.6 Довести документы, таблицы и файлы до полноценной работы
Status: done
Requirements: R10, R12, R13, R14, R16, R25, R34, R35, R36, R39, R40, R42, R43, R44, R45, R91, R92, R93, R94, R95, R102, R105
Depends on: none
Owner: SUBAGENT material_completion
Paths: src/features/artifacts/, src/features/documents/, src/features/sheets/, src/features/exports/, tests/artifacts/, tests/documents/, tests/sheets/, tests/exports/, src/app/api/artifacts/, src/app/api/documents/, src/app/api/sheets/, src/app/api/exports/

F013 completion: прежний editable_materials передал01.6 и прекратил запись. material_completion сохраняет прошедшие DB/format checks, адаптирует общий ArtifactSession/редакторы к scoped K5 client и завершает mounted HTTP. Exact loan src/features/workspace/ui/artifact-page.tsx от01.2 — после явного quiescent handover — для внедрения транспорта/capabilities в ту же страницу и layout, без отдельного demo editor. Session bootstrap использует access/events/versions/version кроме snapshot/history/commands; runtime01.3 предоставляет проверенные scope методы,01.5 routes/adapter. Auth defaults сохранены, ни одно demo действие не уходит в authenticated endpoint с synthetic userId.

**Результат.** Новый документ/таблица создаётся вручную или инструментом и открывается именно редактором. Существующий artifact/version/commands engine сохраняется. Document: полноценные блоки/таблицы/списки/ссылки/изображения/формат/find/selection. Sheet: formulas, ranges, copy/paste/fill, insert/delete, sort/filter/freeze/find, formats и связанные charts; narrow — редактирование выбранной ячейки с координатами. Справки источников не заслоняют материал.

**Контракт.** C6/C7/C9 и K3: stable target IDs, prepared CalculationSpec authoritative server engine, same revision display/export, manual overrides и undo/redo. Dataset query API принадлежит 01.2; финансовые правила 02.1. Формулы вне поддержанного subset дают явную ошибку, cached value не подменяет вычисление. Money uses ISO scales, mixed units/FX требуют заданных преобразований. Import bounded 20k workbook view из 100k dataset; не обещать всю Office-совместимость.

**Порядок.** Reconcile WIP команд/расчётов; довести оба редактора и весь сохранённый lifecycle, затем DOCX/PDF/XLSX/CSV и переносимый editable format с revision vector, source policy/redaction и loss notices. Экспорт создаёт реальный файл; preview/download/error/retry сохраняют выбор. No headless UI rendering; использовать уже принятые data-only exporters. Параллельно 01.2/02.1; shared contracts/migrations только через 01.3. Mount остаётся у 01.2.

### 01.6.1 Полноценные правки и проверяемые вычисления
Status: done
Golden formulas/rounding/structural edits, manual override/undo, stale command409, source lineage и DB reopen. Прежний факт наличия редактора не заменяет этот полный path.

Принят готовый UI/editor подшаг: shared lifecycle menu и его01.2 mount, поиск previous/next matches, unknown-cell count, unregister flush callbacks, source freshness/manual-override presentation и переработанные document/sheet/export surfaces. Whole-file handover eight owned files+artifact-page,251 owned tests/scoped ESLint/typecheck PASS; user visual acceptance отсутствует. Полный stage proof требует server/DB/reopen/export integration после общего checkpoint; эта запись не закрывает01.6 целиком.

### 01.6.2 Пригодные согласованные файлы
Status: done
Actual OOXML/PDF/CSV структуры/Unicode/formula caches проверены без браузера, export revision совпадает с GET. Redaction/private citations, unsupported styles, formula injection и повтор скачивания имеют устойчивое поведение; оформление открытого файла смотрит пользователь.

Свежий isolated DB proof:5files/39tests PASS по artifacts/project-sources/retention/exports/calculation. Strengthened frozen DOCX/PDF/XLSX/CSV job:1file/11tests PASS; парсинг PDF/OOXML/XLSX/CSV подтверждает ручную русскую фразу, формулуA2+B2=143600 и тот же revision vector. Дополнительно4files/17tests по форматам/glyph errors/formula injection PASS. Mounted HTTP proof повторяется после исправления shared startup schema; полный01.6 пока не закрыт.

Разрыв mapped fact freshness закрыт: canonical readMaterialSourceFreshness используется artifact snapshot/retained reads. Reviewed current fact разрешает normal export; correction делает старую fact revision stale; unreviewed/unknown/missing и отозванный project grant не раскрывают закрытые факты и не получают false current. Actual material import/correction/export regression7/7 и повтор только затронутых5DB files40/40 PASS с migrate/seed/cleanup.02.1 подтвердил normal XLSX/DOCX без historicalDraft. Три новых whole files готовы к checkpoint. Остался mounted HTTP proof, который выполняется последовательно после demo runner; bounded cold-health allowance240s не меняет application assertions.

Следующий9-file scoped editor/F014-fixture handover material_completion принят quiescent. Canonical ArtifactClient resolvePath, injected session client/cache/identity, ExportPanel capabilities и SAME ArtifactWorkspacePage scoped composition не импортируют demo WIP и сохраняют auth defaults.39owned unit files252tests/type/lint PASS; DB8a2247bb8fd142368587b7164665348b —3files24testsPASS, cleanup выполнен. Эти adapters требуют реального demo consumer01.5; mounted artifacts/sheets HTTP выполняется одним изолированным lifecycle после fresh checkpoint, без параллельных Next компиляторов.

01.6 принят целиком после mounted production HTTP на BUILD_IDdih-b34RQAb0LZqhXkjFT: runb27ff70637da46989d81eeb4e66e2ba6 — sheets4/4PASS (upload/import, persisted edits/undo, authoritative calculation, XLSX/CSV bundle/download); run4746e92ade434db3bffa793e094f5312 — artifacts1/1PASS (create/edit/reopen/events/history/undo/version restore, authenticated page, guest/privacy/origin/query/session-expiry boundaries). Phase include filter потребовал два последовательных isolated runs, без параллельных серверов и увеличения timeout. Apps/DB/mail/containers/volumes и проверенная временная копия сборки удалены; logs, обычные данные/build/59850 сохранены. Evidence покрывает изменённые01.6 файлы bb70f61, не последующий demo WIP. Exact artifact-page loan завершён; writer остановлен. Пользовательская оценка редакторов/экспортного оформления остаётся открытой.
