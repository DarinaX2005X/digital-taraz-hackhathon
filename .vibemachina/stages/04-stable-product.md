# 04 Проверка, исправления и готовое локальное приложение
Status: active

Здесь соединяется полный продукт, выполняется независимое review и устраняются конкретные дефекты. README и чистый запуск фиксируют реально воспроизводимую поставку. Это обязательная проверка готового поведения, не место, куда откладывают UI или недостающие функции.

По прямому поручению17октября независимая часть04.1 и подготовка04.4 начинаются параллельно03. Полная приёмка04.1 всё ещё требует завершённых01–03, final independent review04.2 и repairs04.3 идут после неё; README/clean-start финализируются после этих repairs. Подготовка не объявляется готовой поставкой.

Прямое уточнение пользователя17октября: общий поиск цветовых проблем выполнить здесь, но последующее «да но закрой вот то что я уже нашла и с разбором пдф будто серьезно и демо пусть они закончат тоже или закончили» требует исправить известные F018–F023 сейчас в01.2/01.3/01.5. Здесь затем повторяется только затронутый regression и весь сквозной color/state audit shared controls/feature overrides; source checks не подменяют пользовательскую визуальную приёмку. Не устраивать ещё одну полную переработку01–02 ради поиска новых cosmetic issues.

## 04.1 Проверить все работы вместе и восстановление после сбоев
Status: active
Requirements: R01, R02, R06, R07, R08, R10, R11, R13, R14, R15, R16, R18, R22, R23, R25, R39, R40, R41, R42, R43, R44, R45, R50, R51, R52, R53, R54, R55, R56, R58, R59, R60, R74, R75, R76, R77, R79, R81, R82, R83, R84, R85, R87, R88, R89, R90, R91, R92, R93, R94, R95, R96, R97, R98, R99, R100, R102, R103, R104, R105, R106, R107, R108, R109, R110
Depends on: none
Owner: SUBAGENT stability_integration
Paths: tests/journeys/, tests/resilience/, evals/suite/, scripts/ops/, docs/operations/

**Результат.** P1–P6 проходят через реальные handlers, domain tools, DB, editors' data contracts и export. Все J1–J5 есть в runtime, локали и восстановление проверены. Ready stage не доказывается health200, scripted gateway или ручным созданием artifact вместо AI. Новые контексты включают три business fixtures и изменённые исходники, не один зашитый ответ.

**Порядок.** Сейчас проверить existing01–02 source/state/color contracts и подготовить meaningful journey/resilience cases, переиспользуя действующие proofs; принимать новые03 handovers по готовности. Installed Next guides обязательны, точечные source/shared loans выдаётMAIN до правок. Общие type/lint/build через checkpoint, DB/HTTP/compile serial slot согласовать с runtime_completion; не запускать дублирующие широкие suites. Единственный paid executor runtime_completion выполняет live evaluation с ledger. Run reconnect/resume/cancel/late commit, malformed output, cost cap/provider outage; ACL/409/source drift/partial import/render/backup/restore/restart. C11 queue/backpressure/parser limits synthetic; editor доступен. Vercel/R2 owned vercel_delivery, самостоятельные cloud probes не назначены. Done требует полных01–03 и P1–P6, не только этого раннего пакета.

**Вход для пользователя.** Дать локальный URL и небольшой перечень существенных P1–P6, не checklist каждого hover. Пользователь проверяет визуал, язык, взаимодействие и timed first result. Findings из оригинального TESTING/чата получают owner и исправление, не игнорируются после зелёных тестов.

### 04.1.1 Полные предметные проходы
Status: active
Реальные сохранённые результаты J1–J5: create→edit→change→export→return с правильными revisions/ACL. Отсутствующий механизм остаётся блокирующим, а не снижает критерий.

Приняты новые journey proofs: campaign-runtime3/3 в isolatedDB754730309ed54a35a8f5880a9252849e использует реальные upload/finalize, businessWork adapter/durable run, human editorial selection и persisted document/two designs/receipt. Mounted keyless run41f40a1d44d04144a4e91600485a017c: manual edit→AI waiting_input/configuration с requests/reserved/spent=0→PDF export→fresh cookie client reopen/download,1/1 PASS, migrate/seed/cold app/cleanup. Test environment явно local и очищает inherited R2/VERCEL flags. Это не realpaidP1; P1, fresh productionPDF/demo и C11/R110 остатки ещё открыты. До ближайшего checkpoint новых load files не создавать; после RELEASE — bounded meaningful gaps с переиспользованием годных proofs.

### 04.1.2 Устойчивость и единый проверенный snapshot
Status: todo
Local clean lifecycle, load bounds, budget/cancel/failure и восстановление подтверждены. Общие checks выполняются на остановленных writers/переданных путях; повторить только изменённое/сломанное. Визуальные пункты отдельно needs-user-check.

По R110 повторить измерения cold/warm HTTP, количества процессов, CPU/RAM и размера generated caches/exports после исправлений01.3. Показать конкретное изменение нагрузки; не запускать параллельные Next compilers ради проверки. Retention/cleanup не затрагивает пользовательские исходники, сохранённые результаты и активные jobs.

Выявленная local build boundary: check-build.mjs пишет прямо в .local-data/build, которую использует ordinary production server. При checkpoint7f91823 MAIN остановил приложение перед завершением сборки и запустил после PASS. До safe staging/promote либо встроенного stop guard обязательно останавливать принадлежащий приложению runtime перед build; проверка04.1/04.4 должна исключить обслуживание смешанных build revisions и сохранить БД/пользовательские файлы.

Ранний stability handover готов: пять exactCSSloans исправляют semantic roles/contrast и pointer-onlyhover с сохранением selected/focus/touch; это source evidence, не visualacceptance. Buildguard в трёх loans использует start-lock и fail-closed active/ambiguousownedproduction check перед изменением servedbuild. Local backup/verify/restore вscripts/ops иdocs/operations/local-backup.md: hashes/migrations, автоматическая pre-restore safety copy, transactionalpg_restore/filesystemrollback, безretentiondeletion. Focused18/18/scopedlint/syntax/diff PASS; isolatedDB c470a4a888fb48108b7d5229b8ca2904 migrate/seed+realroundtrip1/1PASS, containers/volume removed. Whole-file handover передан для следующего checkpoint. FullP1–P6/missing-key/recovery/load acceptance ещё продолжается;01–03 не объявлены завершёнными.

## 04.2 Независимо проверить исходные обещания и реализацию
Status: todo
Requirements: R02, R03, R04, R05, R06, R20, R50, R51, R52, R53, R54, R55, R57, R58, R60, R87, R100, R109
Depends on: 04.1
Owner: SUBAGENT to assign
Paths: none

Свежий GPT-5.6 Sol сначала получает только полный BRIEF со всеми remarks, original TESTING, код и ограничения. Запрещено сначала читать PROJECT/DESIGN/PLAN/REQUIREMENTS/stages или оправдания MAIN. По flow/05-review выводит acceptance из слов пользователя, прослеживает реальные source→operation→savedresult→export→return, возвращает конкретные findings. Затем тот же reviewer получает утверждённые contracts/design и проверяет несовпадения/границы. Ни записи памяти, ни Git, ни браузера, ни дополнительных paid calls. MAIN хранит только actionable findings в этом stage/STATE, без отдельного отчёта.

### 04.2.1 Первый взгляд из оригинального запроса
Status: todo
Finding: severity, нарушенное обещание, file:line, воспроизведение, expected/actual и нужная пользовательская проверка. Результат отдаётся до чтения плана.

### 04.2.2 Контракты и реальные отказные ветки
Status: todo
Права/стоимость/версии/локали/качество результатов и API review; конкретные исправления переданы 04.3. Нельзя заявить визуальную готовность или cloud readiness по исходникам.

## 04.3 Исправить подтверждённые дефекты без потери работы
Status: todo
Requirements: R06, R57, R59, R60, R88, R89
Depends on: 04.2
Owner: SUBAGENT to assign
Paths: tests/review-regressions/, scripts/review/

Repair scopes следуют findings и пользовательскому TESTING, не придуманным дополнительным рефакторам. MAIN выдаёт точные exclusive loans уже освобождённых feature paths и возвращает их после проверки; не разрешает безграничную запись в src/. Сохранять пользовательские данные/черновики/совместимость; миграционный repair требует preview и backup. Проверка соответствует риску: data-loss/core/security/launch issues блокируют выпуск; визуальный fixed-by-code всё ещё требует пользователя.

### Входящие подтверждённые пользовательские дефекты

- F018: local PDF «How to Win the Datathon.pdf»6202KB. Upload6350471bytes/hash/original сохранены, finalize parser выдал sources.errors.pdf, затем UI cancel перевёл upload вcancelled. Проверить причину parser на сохранённом оригинале без раскрытия содержания, исправить bounded processing/retry и понятное сообщение; не удалять проект/готовые файлы.
- F019/F020: нечитаемое действие сворачивания и result links на тёмной поверхности, пересечение панелей; длинный документ раздувает страницу. Нужны проверенные пары rest/hover/focus/disabled/loading, ограниченная высота workspace и scroll внутри редактора с доступными инструментами. Предоставленные пользователем изображения вTESTING, браузер/рендерер не использовать.
- F021: белые labels на белых формах и продолжение скрыто за«Изменить задачу». Постоянный conversation composer должен оставаться рядом с отдельной рабочей областью после первого результата. Runtime review выявил разрыв: child continuation использовал только первоначальные inputs; отсутствовали structured currentArtifact ref и инструмент правки созданного документа. Требуется canonical id/revision pin + authorised current context + bounded patch через ArtifactService commands/AI origin/target hashes/base revision/locks, сохранение ручных правок/409. Решение: explicit human continuation отделён от автоматической рекурсии, предел2/12 сообщений отменён; каждый child сохраняет ancestry и собственные run limits, общие budget caps действуют. Regression13followups проверяет продолжение за прежним пределом. Пустая новая chat UI не закрывает finding.

Известные findings выше исправляются текущими01 owners по последнему пользовательскому уточнению; для04 это вход regression/review, не разрешение оставить их незавершёнными. Полные user text/screenshots вTESTING. Общий поиск аналогичных цветовых и отказных проблем остаётся обязательным04. Точные feature/shared loans выдаются только перед actual writes.

### 04.3.1 Устранить причины найденных ошибок
Status: todo
Каждый реальный дефект имеет reproducer и проверяемое изменение, regression только если проверяет значимое поведение. Связанные paths переданы вместе для coherent checkpoint. Если дефектов нет, не создавать пустой commit.

### 04.3.2 Закрепить устойчивую версию
Status: todo
Затронутые проходы и обязательные общие checks проходят после последнего repair; targeted review только при изменившемся evidence. Незакрытые существенные обещания не объявлены выполненными.

## 04.4 Подготовить README и воспроизвести чистый запуск
Status: active
Requirements: R17, R18, R25, R50, R51, R52, R53, R54, R55, R56, R58, R59, R62, R63, R64, R65, R66, R74, R77, R78, R79, R81, R85, R86, R87, R88, R89, R101, R105, R110
Depends on: none
Owner: SUBAGENT delivery_readme
Paths: README.md, docs/product/, docs/assets/, scripts/verify-clean-start.mjs, tests/docs/, scripts/release/, tests/deployed/

**Результат.** Русский README показывает Tirlik/слоган/mark, полезные работы и достоверные иллюстрации рядом с объяснениями, actual stack, architecture/tools/human control, входные форматы/ограничения/экспорт и точный запуск. Одна основная команда после env, Docker/Postgres/SMTP prerequisites, stop/restart/backup, реальные ссылки и лицензии. Никаких private brief/agent chatter/fake metrics/полотна хешей. Только VibeMachina delivery guidance.

**Порядок.** Из проверенной поставки написать README; воспроизвести независимую чистую копию без node_modules/cache/private memory/skills с отдельными портами/DB. install→migration→start→HTTP real workflow→stop/start→reopen, проверка отсутствия ключа. Нельзя пользоваться скрытым skill config как продуктовой зависимостью. Удалять только проверенные собственные test resources, не чужие процессы.

Последнее разрешение17октября заменяет deferral: повторить Vercel. Preflight existing account/project/Neon/Workflow/environment идёт отдельным owner параллельно текущим исправлениям; для hosted files пользователь выбрал private Cloudflare R2 и создаёт bucket/credentials. Deployment stable snapshot после handover, Node22, без paid purchase/других hosting исследований. Self-deploy по умолчанию хранит файлы локально и работает без cloud keys; отсутствие AI key ограничивает только AI action с понятным сообщением, не запуск/ручные файлы/редакторы/экспорт. Здесь закрепить оба воспроизводимых режима, HTTP/API/large-upload/readback/persistence/restart/resume checks и точный рабочий URL либо честный конкретный blocker. Build/health без durable app paths не закрывает deployment. Cloudflare Workers workaround не внедряется после выбора Vercel.

Vercel/R2 source handover готов:15 whole files (storage/service/handlers/transport,dependency/env и tests), unit11/11, sourceDB11/11(run0760fd3891104e18b0d2aabd763b4780), scoped lint/diff PASS. Actual private R2:6,350,000bytes signed immutable PUT200, exact production CORS/Expose ETag, server bounded HEAD/GET/size/SHA256 verified, retry412, delete/missing-read cleanup PASS. Source/export streams сохраняют SHA ETag/security/no-store без Content-Length; mounted assertions требуют fresh build. Production env пока пустой, старый Ready deployment не app-ready. Существующий owned Neon Free non-sandbox ресурс пригоден: preview branch сохраняет migration ledger с13октября, без TTL/несовпадений; только0001–0002 из22 migrations, runtime/authority/cloud spend ещё отсутствуют. После checkpoint тот же ресурс подключается кProduction, выполняются20 remaining migrations/synthetic seed и env/API gates. Cloud AI key/grant только после runtime handoff local2+Neon8; новые ресурсы и перенос local user data не нужны.

### 04.4.1 Понятная документация фактического продукта
Status: active
README проверен против кода/реальных команд/exports/env names без значений; links/assets/privacy/credits корректны. User screenshots только предоставленные; честные diagrams допустимы, не выдаются за UI.

README + docs/product/{architecture,self-hosting,clean-start}.md, scripts/verify-clean-start.mjs и tests/docs/delivery.test.ts переданы source-ready/quiescent. Focused8/8/lint/syntax/diff PASS. Clean-copy verifier исключает private env/.codex/.vibemachina/cache/dependencies, работает без skill. Actual clean E2E ждёт отдельного serial slot после общей сборки; deploy/media остаются честно pending,04.4 не завершён.

R110: описать классы локального хранения, ограничение временных файлов и безопасную штатную очистку, измеренную память/время запуска и обычный режим использования. Не придумывать минимальные серверные требования и не удалять данные пользователя ради меньшего размера.

### 04.4.2 Чистая локальная поставка
Status: todo
Запуск без частной памяти, реальное сохранение/возврат после restart, missing provider state и безопасная остановка. Проверенные paths/commands переданы в финальный комплект; внешний вид README проверяет пользователь.
