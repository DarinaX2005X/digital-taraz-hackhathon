# Состояние проекта
Phase: build
Approval: approved
Active stage: 03
Active task: 03.2

## Сейчас

Tirlik, полный v4 утверждён «подтверждаю!»2026-10-13, базовая версия f5f1da6230454c3d04aef02f6142bf40e37e3d8f. Полный продукт продолжается автономно, только локально; stop после02 отменён. Последнее поручение15октября полностью сохранено в BRIEF. MAIN восстановил AGENTS/BRIEF/TESTING/REQUIREMENTS/PROJECT/DESIGN/PLAN/PLAN-HUMAN и текущие stages; PROTOCOL.md отсутствует, действующие договоры PROJECT C3-C8/PLAN/AGENTS. Только VibeMachina, никаких других skills/plugins.

Первичный UX и отдельный fresh code review committed+WIP завершены. Главная проблема фактическая: цель сохраняется, но не исполняется; результат открывается preview без редактора; structured source CTA ведёт в отсутствующий materials hub; scan/photo остаются partial. Подтверждённые defects и evidence в stages/12-independent-review.md. Первый приоритет внутри полного scope: свой прайс+запрос -> смета+предложение -> прямое редактирование -> изменение цены без потери ручной фразы -> файлы -> возврат. PROJECT/DESIGN/оба плана уточнены, ранние bindings/demo/onboarding больше не ждут всех бизнес-модулей.

HEAD8b1b8649eab2b5ed5488b3813601106d37fa0afa, origin/main совпадает на момент восстановления.204 uncommitted source/test/config paths до новых исправлений, индекс пуст. Старый WIP сохраняется, не объявляется принятой поставкой. Последние полные checks14октября предшествуют последнему source edit; текущий snapshot требует новой проверки. MAIN не читает/пишет feature code, source integration делегирована.

Во время повторного helper активные source/test/config paths заморожены. Владельцам разрешена подготовка следующего кода только в ignored .local-data/agent-scratch/<agent>/ без применения к продукту/запуска тяжёлых checks; это не часть проверяемой ревизии. После push MAIN явно разрешает перенос в их прежние exclusive paths и обычную проверку.

## Следующие шаги

1. Первый recovered baseline готовится к штатному checkpoint: все десять writers STOP/read-only. Document import-panel lint blocker исправлен и весь documents lint/19tests PASS. Integration исправил exhaustive HTTP partition (отдельный runtime phase), tx-aware artifacts/ACL/current source vector и move routing. Полный helper из12 реальных checks затем commit/push; materials draft island исключён. Не возвращать весь suite в одну300s фазу.
2. Новые owners получают целые journeys: public/auth/workspace/onboarding, source intake/OCR, materials hub/mapping, документы, таблицы, макеты, AI tools/J1, exports и связанное обновление/пример. Общие пути только одному integration owner; UI owners получают весь новый BRIEF и shared design refs. На handover STOP только нужных package writers, на общий helper frozen build.
3. Сначала реальные create/import/edit/save/reopen, далее выполнение задачи/export и связанное изменение. Не принимать компонент без route/caller. Продолжать полный одобренный объём после первого пути.
4. Перед dispatch/checkpoint и после handover читать весь TESTING. F001/F004-F006 ожидают пользовательской проверки, F002/F003 остаются открыты по качеству/видимой поставке; новое F007 о ценности/первом опыте в работе.

sheets_finish передал первый bounded repair и STOP: cycle detection/TS fix,7/7 engine tests PASS. Paths calculate.ts/cycles.ts/engine.test.ts плюс existing domain model/formulas как dependency closure. designs_finish также READY+STOP: actions.ts/test actions+geometry,18/18 focused tests и eslint PASS, toReversed/sourcevector исправлены, snap fixture скорректирован без смены algorithm. Общий snapshot ещё не проверен/не закоммичен. Документы/источники/materials/journey завершают только bounded repairs и останавливаются; agent_execution/exports/connected read-only до release. Новая package batch отложена до первого baseline checkpoint.

Первый helper attempt15октября12:07–12:18 прошёл checks1–8: план/privacy/diff, typecheck15.1s, lint26.1s, unit59.7s, build110.1s, DBphase иHTTPidentity. Check9 http-product превысил hardcoded300s, assertion failure не показан; commit/push не предпринимались. Все writers остаются STOP. recovery_inventory завершил bounded split на http-artifacts/http-workspace/http-sources с exhaustive19-file partition; scoped lint/parse/partition PASS, cleanup только принадлежащих failed run containers выполнен, dev app не затронут. После repair штатный helper повторяется с полным real config, без нового Git wrapper/cache и без пропуска сценариев.

Attempt2: full unit654 tests дал653PASS/1timeout (100000-record business-changes fixture34.267s при30s). Тот же isolatedfixture без изменения теста прошёл8/8 за21.83s, предел30s сохранён. Фактические tsconfig/eslint/vitest/Nextinputs исключают ignored scratch. Проверены673nonignoredfiles: после первого PASSsource snapshot изменились только STATE и2runnerfiles; src/tests/public/package/lock/migrations неизменны. Поэтому первый PASStype/lint/unit/build/DB/identity переиспользуется, fixture дополнительно подтверждён изолированно. Completion helperprofile9 реальных checks:4plan/privacy/diff, scopedlint двухrunnerfiles,4оставшихсяHTTPphases. После commit вернуть сохранённый full12profile; это повторная проверка затронутого runner и оставшихся границ, не пропуск неуспешных assertions. Future unit maxWorkers согласуетintegration послеrelease, сейчас конфигурацияunit неизменна.

Attempt3 completionprofile: scopedrunnerlint PASS, http-artifacts PASS177s. http-workspace:11/12PASS, aggregate public-account-pages case превысил90s (suite201.43s), commit не предпринимался. Integration анализирует cold compilation и получает точный testfile loan для независимых route cases с сохранением всех no-personal-record assertions; увеличения лимитов вслепую нет. Ранее успешные неизменённые app checks иartifactsHTTP сохраняются; source/runtimeHTTP ещё предстоят. Весь TESTING повторно прочитан, новых пользовательских записей нет.

Workspace HTTP harness repair: прежний общий loop заменён it.each для всех8public routes,2opaque-intent redirects,3recoveryroutes. Проверки locale/referrer/no-personal-record сохранены и выполняются отдельно длякаждойстраницы; default30s/case иAbortSignal25s оставлены ограниченными. Устранён хвост прерванного общегоloop, который накладывался на следующие случаи. Scopedlint PASS. Completionprofile теперь проверяет4plan/privacy/diff, typecheck+scopedlint изменённогоtest/runner и3remainingHTTPphases; предыдущий PASShistory/artifacts повторно не запускается. Основнойsrc всё ещё unchanged; новое дерево остаётся scratch-only.

## Проверено

Recovery inventory: старые source/tests/scripts/migrations не менялись во время аудита; последнее старое изменение14октября21:31:45+05. Прежних project Node writers нет, старые handles текущему дереву недоступны, их ownership снят. Пользовательские изменения не удалять.

0001–0010 применены, SHA256 совпадают с SQL journal; immutable.0011_material_collections.sql.draft пока не применяется.0012 зарезервирована для source visual assets, файла ещё нет. Lock hashfc9f3ebc…4648ba совпал с installed receipt, Tiptap3.32/htmlparser2/saxes/yauzl уже установлены в WIP; fontkit ещё нет. Новый package batch только после process coordination.

Live proof уже выполнен14октября16:29:36UTC, run7feb005b-9a23-43d7-942a-2f54889de2f1, runtime.model-proof, xiaomi/mimo-v2.6-flash exact xiaomi/fp8.2 succeeded calls:0.00005852+0.000028=$0.00008652. Общий grant user-2026-10-14-autonomy-usd10 active, reserved0/spent0.00008652, endpointproofpassed. Не повторять proof. Price expiry2026-10-15T16:28:03.470Z требует штатного metadata refresh перед новыми calls. Это connectivity, не реальный J1.

Старый отдельный ledger: confirmed$0.0400707, unresolved$0.480832, attempted ceilings$0.81472<=старого$1. Не освобождать/не повторять uncertain outcome. Новый общий максимум$10 для всех agents/processes, exact reservations/costs, экономичные non-top модели, secrets server-only. Новые paid calls только назначенному AI/runtime owner после integration readiness, сначала synthetic и bounded quote; остальные agents не расходуют.

Независимые reviewers нашли cycle->0 в sheet engine (focused test FAIL), stale source-vector вdocuments/designs, move-history reload404, pending-close/intent/auth-draft defects, XLSX package-absolute target rejection и2import-key defects.153/155 focused artifact/editor tests PASS; второй FAIL snap fixture требует исправить ложное ожидание, не менять nearest algorithm. Детали передаются владельцам. Browser/visualQA не выполнялся.

Промежуточные handovers15октября: sources parser9/9+lint PASS, canonical original adapter прошёл DB; documents19/19+scopedlint PASS, preexisting import-panel state-mutation lint blocker исправлен immutable state, весь documents lint PASS; journey238/238(25files)+tsc+lint PASS; sheets7/7 иdesigns18/18 PASS. Integration isolated databasephase42.3s PASS (txrollback/replay/ACL/source adapter/move old404→newvalid), runtimeHTTP103.8s PASS, source-vector7tests+lint PASS. Materials8unit+tsc+lint PASS,3SQLregressions pending0011, остаются вне baseline. Никаких новых paidcalls или browserQA.

## Сервисы

Local: http://127.0.0.1:59676/
Mailpit: http://127.0.0.1:8029/
Дашборд планирования: http://127.0.0.1:4177/

15октября recovery_inventory восстановил штатный node scripts/dev/start.mjs --port59676, exit0/health200/database ready. Supervisor131236, app133440, instance230de5bb-4326-4506-870d-ae8fcc7e29a4; log.local-data/dev/app-230de5bb-4326-4506-870d-ae8fcc7e29a4.log. Старые86632/155196 завершены. PostgreSQL54329 container1721cc62aab3/Mailpit8029 f27924efa78f labels этогоcheckout, Docker backend24588. DashboardPID88536/health exact root. Stop/start только собственных процессов без потери данных, никаких браузерных вкладок. Не печатать private controltokens изruntime files.

## Работники

Исторические handles прежнего MAIN больше не владеют путями. Текущие read-only audits: ux_value_audit done; recovery_inventory inventory/start done; review_entry done; review_materials done; review_runtime done; review_editors done. Их исходники readonly; финальный12review всего продукта остаётся впереди.

Все десять назначений ниже запущены15октября; каждый получил полный context packet и обязан читать исходный BRIEF/TESTING, а не только краткую задачу. MAIN alone memory/Git; source integration owner получает package/lock/root registry/layouts и artifact transactional boundary; другие wholepaths не пересекаются. Implementation workers обязаны прочитать полный BRIEF со всеми verbatim remarks и TESTING, не только этот курсор.

- recovery_inventory -> integration continuation: exclusive package.json/package-lock.json, scripts/check-integration.mjs, scripts/dev/test-context.mjs, vitest.integration.config.ts, src/contracts/index.ts/errors.ts; post-release loans src/contracts/events.ts, commands.ts и vitest.config.ts; bounded current loan tests/contracts/identity-routes.integration.test.ts, src/server/db/schema.ts, src/features/identity/server/index.ts и access.ts (exclusive transaction-aware ACL loan), src/app/layout.tsx, src/app/app/layout.tsx/page.tsx, next.config.ts, src/instrumentation.ts; artifacts feature/tests + artifact/workspace-event API/history route. Bounded artifact current-source vector and transaction-aware effect helpers, history move routing; other feature code only review. Local lifecycle/migration execution and test scheduling, no paidcalls/Git/memory. All migrations immutable0001–0010; new DDL created by assignedfeature, applied only after review.
- journey_delivery:03.2/10.1/10.3 whole public/auth/workspace/onboarding journey. Exclusive src/features/public-site/,workspace/,onboarding/,identity/ui/,identity/locales/;src/ui/;public/site/; tests/public-site/,workspace/,onboarding/,identity/ui/,ui/,ui-contracts/ и identity/domain return-to pair. Routes root page/not-found, locale public subtree (кроме demo/** loan connected_delivery), sign-in/sign-up/auth/settings, app/work и project page/layout/artifact page (не history), api/projects и api/onboarding. Workspace-view schema/0009immutable; onboarding schema/new0013 loan. Rootlayouts только integration. Не трогать identity/server/contracts без запроса.
- sources_finish:02.3 sources feature/tests/contracts + src/server/db/source-schema.ts, source-ingestion-schema.ts, source-asset-schema.ts + api/sources + app/materials/add и sources/[sourceId].0008/0010immutable;0012visualassets draft/new final loan. Fullformats/OCR по runtime API, paidcalls не исполняет без координации AI owner.
- materials_finish:02.4 materials feature/tests/contracts и src/server/db/material-schema.ts +0011draft/final+api/materials + app/materials/page и collections/[collectionId]. Не source add/detail. Hub/mapping/facts/reimport/identity fixes, canonical pinned adapters.
- documents_finish:03.3 documents feature/tests +api/documents/import. Full TiptapUI/controllers/import/direct commands/locales; source vector fix. Main artifact route только journeyowner, export отдельный owner.
- sheets_finish:05.1 sheets feature/tests/api/sheets. Engine cycle fix, full grid/editor/query/import/XLSX/CSV, canonical materials and ArtifactSession. No other source/domain/history stores.
- designs_finish:06.1/06.3 designs/design-export feature/tests/api/designs. Full canvas/page/layer/editor and real exports; expectedsource fix, nearestsnap fixture correction. Private assets sourceowner, shared model artifacts integration. Generation06.2 separate later. No browser/canvas render QA.
- agent_execution:02.2 continuation +04.1/07.1 first J1; runs/agent-tools/commercial feature/tests/evals, contracts/runs + src/server/db/run-schema.ts/api/runs/app/runs/scripts/eval-live; новая0016_run_continuations.sql.draft/final; послеrelease exclusive src/contracts/calculations.ts (single CalculationSpecSchema), trusted-only confidential OCR propagation. Runtime transaction-aware artifacts уintegration; mainUI mounting уjourney. Only paid-call executor after quote+readiness within global$10; no proof replay. Runs core frozen before baselinecheckpoint on request.
- exports_delivery:03.4 exports feature/tests/api/exports/export-schema +new0014draft/final. Versioned immutable filemanifest/privatefiles, realDOCX/PDF; sheet/design register adapters, no competing exports.
- connected_delivery:08.1/08.2 +10.2 dependencies/change-review/demo feature/tests, contracts/dependencies + exclusive src/contracts/dependency-edges.ts +dependency-schema/new0015draft/final ifneeded, api/changesets/dependencies/demo +app/demo и исключительный loan src/app/[locale]/demo/**. Same pure domain transforms, no fakegeneration/personalrows onview; UI editor panels through journeyowner. Fullprojectpackages08.3 later afterexport adapters. No shared artifact source writes; asks integration.

## Передача

Полный scope PROJECT C1-C14/J1-J5,15stages/43tasks/86checkpoints сохранён, никакого MVP/остановки на первом пути. Последнее уточнение пользователя требует современного, понятного UX, сохранения понравившегося layout/hero и настоящего результата. Текущая работа после review разрешена без поэлементных согласований; существенную смену концепции сначала предъявить.

Только локально, не искать hosting/deploy/probes. Browser/CUA/Playwright/Selenium/Puppeteer/headless/screenshots/эквивалентная UI-автоматизация запрещены всем. Пользователь выполняет визуальную/браузерную проверку. Локальные reference images читать можно.

Git исключительно C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs с реальными configured checks, scoped --paths и --push в проверенныйorigin/main. MAIN alone, no manual add/commit/push. Private runtime/BRIEF/TESTING/env никогда не force-add. Product check/start scripts работают безskill. Стандартное escalation при sandboxEPERM, не обход отказа.

После полного продукта отдельный финальный review/README/cleanlaunch/repo и запрошенные презентация/видео/исходники/встраивание. Новое ограничение only VibeMachina приоритетнее старого предложения применить другой skill к презентации. Непроверенная публикация/UI не становятся готовыми по build.
