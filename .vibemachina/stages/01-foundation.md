# 01 Проверяемая основа и ранние ограничения
Status: active

Сначала проверяем, что выбранные редакторы, модели и размещение действительно подходят. Готовим повторяемый запуск, общие правила данных и реалистичные учебные материалы.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 01.1 Зафиксировать контракты и воспроизводимый запуск
Status: done
Requirements: R18, R50, R51, R52, R53, R54, R55, R58, R59, R74, R77, R81, R87, R88, R89, R105
Depends on: none
Owner: /root/foundation
Paths: scripts/dev/, scripts/check.mjs, scripts/check-integration.mjs, scripts/check-build.mjs, tests/foundation/

**Контракт и результат.** C2-C4, C11. После явного approval MAIN фиксирует версию пакета, создаёт минимальный Next/TS каркас, shared contracts/schema/route registry и передаёт работнику только указанные пути. Одна команда start: проверка Node/Docker/env без печати значений, npm ci при смене lock hash, PostgreSQL/Mailpit health, advisory-lock migration, идемпотентный demo seed, свободный localhost-порт. stop останавливает только собственный процесс. Повторный запуск не стирает базу. Shared Money/Quantity, ArtifactEnvelope, Command, ошибки и capability registration из PROJECT интегрирует MAIN.

**Вход в работу и состояния.** Пока нет продуктового экрана: оператор получает адрес, причину недоступного Docker/порта и точную команду восстановления. Локальный запуск и проверки не зависят от VibeMachina; приватный checkpoint вызывает их снаружи.

### 01.1.1 Контракты, миграции и независимые проверки
Status: done

MAIN принимает schemas и минимальный scaffold; worker проверяет CLI/env, отдельные test namespaces и типизированный error envelope. node scripts/check.mjs действительно исполняет type/lint/unit/locales/contracts, а не заглушку.

Принято 2026-10-13: Zod contracts Money/Quantity/locale/ArtifactEnvelope/SourceRef/Command/group/capability; минимальный Next16.4/React19.3/TS5.9, Drizzle schema и SQL migration journal с hash/advisory lock; явный synthetic catalog seed без аккаунтов. `node scripts/check.mjs`: types/lint/unit PASS; `node scripts/check-build.mjs`: Webpack production build PASS. Turbopack на Windows дал junction error87, штатный Webpack подтверждён. `node scripts/check-integration.mjs`: настоящие PostgreSQL+Mailpit, migrate/seed,5 tests PASS (повтор без потери UUID/правки, concurrent lock, history hash mismatch, transaction rollback/recovery, synthetic constraint). Label-verified cleanup удаляет только отдельные test containers/volume. Locale test пока проверяет коды; parity словарей относится к01.2. Runtime/start/restart ещё не реализованы. Первый increment ac6e5a6 pushed; SQL файл на диске был пропущен в explicit commit scope, включается в текущий проверенный checkpoint вместе с DB wrapper.

### 01.1.2 Повторяемый запуск без потери работы
Status: done

start -> запись -> stop/start -> тот же UUID/значение; второй start не дублирует seed, занятый порт не захватывается. MAIN отдельно проверяет ignored secrets и штатный scoped checkpoint.

Release /root/foundation 2026-10-13 после commit/push e466058f2ada71c5ea33a397048bad83c9f863e5 (7configured checks PASS, включая real DB). Изолированный DB wrapper и SQL приняты в01.1.1. Далее worker реализует supervisor/runtime/HTTP/restart proof.

Принято 2026-10-13: check.mjs types/lint/64tests PASS; check-integration.mjs 7tests PASS, включая настоящий Next HTTP:200 -> PostgreSQL stop -> типизированный503 без credentials -> PostgreSQL start ->200. Next закрыт по живому owned child handle, test containers/volume удалены после проверки labels. `node tests/foundation/lifecycle.acceptance.mjs` на Windows подтвердил start -> запись -> stop/start: UUID63210895-4f44-45ec-896c-40e1406dcca3, значение и файл сохранены, seed UUID прежний/count1. Повторный start возвращает текущий instance/PID; явный занятый порт отклоняется, автоматический выбирает свободный, чужой сервер остаётся жив. Tokenless/wrong-token/foreign-Origin stop получают403, посторонний supervisor не меняет runtime. Отказ записи runtime не мешает остановке собственного child; незавершённый control socket ограничен deadline. POSIX process-group ветка покрыта unit, но не исполнялась на реальной POSIX ОС. Ручной lifecycle harness не входит в обычный checkpoint, поскольку перезапускает dev app. MAIN HTTP health200 database=ready подтверждён. UI не проверялся; это foundation, не готовый пользовательский путь.

## 01.2 Собрать общие элементы понятного интерфейса
Status: done
Requirements: R09, R31, R32, R33, R34, R38, R39, R40, R44, R45, R46, R47, R48, R49, R60, R101, R108
Depends on: 01.1
Owner: /root/ui_foundation
Paths: src/ui/, src/i18n/, public/brand/, public/fonts/, tests/ui-contracts/

**Контракт и результат.** C2, C4, DESIGN целиком. Токены, локальный Noto Sans с казахскими глифами, логотип/favicon, кнопки Lucide с tooltip/accessible name, поля label/unit/error, combobox, dialog, tabs, table frame, save-status, toast, skeleton, empty/error states. Каталоги ru/kk/en разделены по namespaces; feature worker владеет своим namespace внутри feature, shared dictionary здесь. Смена локали не перемонтирует несохранённый editor store; server cookie и explicit preference согласованы. Focus return, Escape без потери черновика, reduced motion, 44px touch targets, fixed toolbar dimensions.

**Вход в работу и состояния.** Элементы внутри будущих Работа/Материалы/Бизнес; не публичный каталог компонентов вместо сервиса. Компактные панели, белый лист, бирюзовое действие и коралловые акценты по DESIGN. На узком экране вторичная панель становится drawer.

### 01.2.1 Токены, шрифты и локали
Status: done

Contrast calculation, наличие glyphs, parity ключей, fallback policy и отсутствие secret/client imports. Иконки и focus semantics проверяются по исходникам, внешний вид ещё не принят.

Принято 2026-10-13: semantic token/CSS parity и contrast, официальный pinned Noto Sans400/500/600/700 с OFL/hash/cmap/embedding checks, сохранённый T-знак/favicon/monochrome. Полные typed shared ru/kk/en catalogs и Intl без float loss для денег; pure locale store сохраняет identity и сериализует account preference writes. Worker27focused tests/type/lint PASS. MAIN подключил root font/CSS/server locale/provider и добавил regression fractional signDisplay (28UI unit tests), общий check.mjs PASS. Настоящие HTTP checks всех3 cookie locales/invalid cookie -> Accept-Language/local icon+font и прежние DB cases PASS (12integration tests). Account API ещё02.1, реальные controls01.2.2; mounted editor/focus/locale language quality и внешний вид пользователь ещё не проверял.

### 01.2.2 Рабочие состояния контролов
Status: done

Unit reducer tests dialog/combobox/debounce/cancel и сохранение значения при locale switch. Типы и CSS constraints проходят check.mjs; пользователю список состояний для визуальной проверки.

Принято 2026-10-13: Ariakit controls, Lucide buttons/tooltips, label/unit/error fields, strict-ID combobox с debounce250/AbortController/epoch/retry, dirty dialog с mounted draft и explicit discard, tabs с сохранением panels, table frame/toolbar/save/empty/error/skeleton/toasts/LocaleSelect.55focused tests PASS (27новых state/AST/CSS contracts), typecheck/scoped lint PASS. MAIN подключил единый ToastProvider внутри стабильного LocaleProvider. Системные toast strings используют locale resolver; error/action notifications persistent, info>=6s и pause hover/focus. Native validity запрещает произвольный текст вместо ID; серверный caller обязан проверить право на выбранный ID. Source review не заменяет реальный focus/tab/touch/locale-retention: матрица src/ui/README.md ждёт пользователя на продуктовых routes. Публичная gallery не создавалась.

## 01.3 Подготовить неоднородные материалы трёх бизнес-моделей
Status: done
Requirements: R01, R02, R07, R15, R75, R76, R82, R99
Depends on: 01.1
Owner: /root/business_fixtures
Paths: fixtures/business/, scripts/fixtures/, tests/fixtures/

**Контракт и результат.** C1, C5, C9, C13. Synthetic розница товаров для дома, сервисная компания и малое производство: истории операций, возвраты, прайсы с разными единицами/упаковками, запрос на предложение, собственные условия, бренд-набор и фото с проверенной лицензией. Manifest происхождения, ожидаемых сумм, противоречий, недостающих полей и контрольных изменений. Для прогноза достаточно длинный ряд с train/holdout, сезонностью и выбросами, не подмена фактической истории. Никаких реальных PII, фальшивых местных партнёров и обещаний прибыли.

**Вход в работу и состояния.** Позднее доступны явно как «Учебный пример». Файлы скачиваемы и загружаются тем же импортом, что материалы пользователя. Малый quick-start и большой stress набор разделены; пример не ограничивает свободную задачу.

### 01.3.1 Рабочие материалы и контрольные ответы
Status: done

Генератор с seed, CSV/XLSX/DOCX/PDF/изображения, права на assets и manifest. Независимо вычислить golden totals, пропуски, дубли, revisions.

Принято 2026-10-13:79 файлов (seed20261013) для synthetic розницы, услуг и производства. CSV/XLSX/DOCX/PDF, brand assets и3 фото с лицензиями PD/CC0, закреплёнными provenance/hash/EXIF checks; quick/full working ZIP исключают golden и будущие evaluation observations. Истории1526/954/764 строк, возвраты/credit notes, MOQ/упаковки/доставка/актуальность, неизвестные налоги и противоречивые сроки. Независимый csv-parse/BigInt oracle подтверждает net revenue34244571.00/51671456.70/58875825.00 KZT и известную часть предложений141870/131900/563325 KZT; finalTotal=null при неизвестных условиях. По одному exact duplicate удаляется, обе конфликтующие строки одного ключа карантинируются,3 строки с пропусками исключаются. Прогноз60 месяцев:36train/12validation/12holdout и2rolling folds, без утечки в рабочий архив. `vitest tests/fixtures`:6PASS; scoped lint PASS; verify воспроизводит все79 файлов побайтово и разбирает реальные OOXML/PDF,2страницы ru/kk/en каждого PDF. Внешний вид не проверялся. Stress/reimport changes остаются01.3.2.

### 01.3.2 Проверочные изменения и большие наборы
Status: done

Новая цена, ручная формулировка, изменённая схема CSV, недостаточный ряд и 100k-row input. Воспроизводимые хеши и отсутствие настоящих PII; возможность скачать/перенести свой вариант.

Принято2026-10-13:65добавленных файлов контролируемых изменений/stress, исходные79файлов побайтно сохранены. Per-business cases: stableID reorder, same-file retry, overlap сдублями/конфликтом, одна новаяцена, partialupsert, отсутствующаястрока толькоconfirmedfullsnapshot, неоднозначныйключ/rename, явныйschema remap, stale mixedproposal не затрагивает manualwording. Forecast недостаточность отдельноdaily/weekly/monthly/annualseason. Stress100000records, CSV10103061bytes, ZIP443806bytes; генерация/распаковка/проверка потоковые, chunks250rows, независимые BigInt totals1209650960.00revenue/734598070.00costKZT. Нормальные workingarchives не содержат stress/goldens. npmrunfixtures:generate/fixtures:verify PASS, Vitest14/14PASS, scopedESLintPASS. MAIN проверил новые oracle/stream/negative tests; это fixtures, не реализованный importer или UI acceptance. Checkpoint ожидает общего безопасного handover writers.

## 01.4 Проверить модели, форматы и управляемое размещение
Status: active
Requirements: R17, R56, R79, R85, R86, R105
Depends on: 01.1
Owner: /root/preflight
Paths: scripts/preflight/, tests/preflight/, src/server/preflight/

**Контракт и результат.** C2, C7-C9, C12, C14. После approval ограниченные probes OpenRouter: schema/tool call, vision extraction, отдельная economical image generation с известной полной ценой; запрет OpenAI/Anthropic/дорогого fallback. Проверить лицензии и реальную поставку Univer data-only formulas, Fabric serialisation, DOCX/PDF/Unicode export, arima CTSA. MAIN управляет dependencies/env/deploy; worker только scripts/evidence. Vercel account/project/tier/regions, pooled PostgreSQL, private Blob и Workflow resume проверяются API на synthetic содержимом. Сервисы и платные опции без разрешения не покупать.

**Вход в работу и состояния.** Readiness gate, не публичная кнопка «всё работает». Показать разрешённые модели/цены, недоступную модальность и ограничения форматов. Если библиотека требует Pro, найти проверенную OSS реализацию контракта, не убрать функцию.

### 01.4.1 Форматы и стоимость подтверждены
Status: done

Roundtrip файлы, Unicode text extraction, formulas vs golden, schema/tool/vision result и usage без секретов. Live budget <= $1 batch; неоднозначный платный timeout не повторять вслепую.

Принят ранний capability gate 2026-10-13 с явно выявленными ограничениями. Offline13focused tests/lint PASS:15Univer OSS formulas+recalculation, actual XLSX cached results/styles/date/merge/x14 roundtrip, editable DOCX и2page PDF с ru/kk/en extraction, Fabric object/ID/binding serialization без canvas surface,112point CTSA series/two holdouts. Evidence bytes/hashes/licence sources в tests/preflight/evidence, CTSA BSD notice добавлен отдельно. Full Office fidelity, browser editors и calibrated forecast не заявлены.

Live ledger намеренно `partial`, не замаскирован green: Mimo tool call выполнен/проверен; vision JSON object + strict local Zod PASS; Seedream4.5 JPEG2048x2048 PASS. Xiaomi endpoint НЕ поддержал provider-enforced JSON Schema, поэтому downstream использует JSON object + обязательную локальную проверку. Seedream minimum2K подтверждён реальным вызовом, несмотря на ошибочную1K metadata. Отдельный JSON output call получил ambiguous timeout: НЕ повторялся, резерв остаётся. Confirmed actual$0.0400707, unresolved reserved$0.480832, cumulative attempted ceilings$0.81472 <= original$1. Все обычные checks offline, live runner требует явных execute/cap и запрещает повтор ledger. Непрерывный tool-message loop ещё не доказан, его acceptance остаётся04.2; durable uncertain receipt/reconciliation02.2. Mimo expiration metadata2026-10-21 обязательно обработать до runtime02.2, readiness=false не прячется. Эти выявленные границы, а не поддержка всех запрошенных параметров, являются результатом ранней проверки.

### 01.4.2 Хостинг и региональные условия проверены
Status: blocked

Текущая граница: пользователь ответил «Пока продолжать только локально» на вопрос о конкретном remote proof. Новые hosting probes/deploy не запускать. Уже полученные direct proofs сохранены, но не заменяют Workflow start/redeploy/resume. Для локальных задач принят01.4.1; cloud gate остаётся обязательным11.2/13.2. Нельзя обходить прежний инструментальный policy denial другим транспортом.

Preview HTTP/API + workflow resume после redeploy; storage permissions и лимиты. Privacy gate отдельно для аккаунтов, бизнес-данных, backups и AI subprocessors; неподтверждённую локализацию не считать production-ready.

Release01.4.2: MAIN создал отдельный tirlik, Neon free_v3/fra1 и private Blob/fra1 толькоpreview. Worker получил exclusive loan src/server/preflight/ для token-gated synthetic Workflow probe, MAIN монтирует thin routes/config и marker SQL/schema. Probe по умолчанию disabled404, не содержит бизнес-данных; state вDB, private bytes/hash, hook/resume после redeploy. Preview secrets толькоignored env/providerenv. Отдельно проверяются limits/regions/Hobby/privacy, без покупки или принятия новых условий.

Промежуточный handover 2026-10-13: server probe и CLI готовы, 50 focused tests / 8 files и scoped ESLint PASS. Реальный Neon client TLS с проверенным сертификатом, reconnect persistence и unique UUID подтверждены. Private Blob: запись/чтение 141 байта с одинаковым SHA-256, анонимный GET403, overwrite rejected. Синтетические строка/объект удалены, cleanup подтверждён. Первый false-negative по pg_stat_ssl за transaction pooler сохранён отдельно; второй attempt проверяет правильную границу клиентского TLS. Реальный Workflow modern/legacy serializer проверен с Date/Map/Set/typed-array slices. HTTP handlers по умолчанию disabled404; включаются только в preview с отдельным bearer token, ограничивают тело/deadline/idempotency/rate. MAIN принимает пакет для checkpoint, но не закрывает 01.4.2 до deploy/redeploy HTTP proof. Хостинг/региональные ограничения и первичные источники: tests/preflight/evidence/hosting-facts.json.

Checkpoint 67b2dbf pushed: пакет server/CLI/direct proofs и fixtures 01.3.2 сохранён, все 7 configured checks PASS. Preview dpl_9miTEtGmYdWdAFYhWLyauLh4uoWW READY из этой версии; начальный bootstrap deployment стал production по поведению нового Vercel project, но production secrets отсутствуют и probe disabled. Запуск remote HTTP proof отклонён инструментальной средой до создания процесса (`blocked by policy`): Workflow не запускался, journal не создан, повторов и альтернативного обхода не делали. 01.4.2 остаётся неподтверждённым до разрешения ограничения среды и фактического start/redeploy/resume. Локальные независимые задачи продолжаются. Hobby noncommercial и региональные privacy ограничения остаются отдельным release gate, а не технически доказанной совместимостью с production.

