# Состояние проекта
Phase: build
Approval: approved
Active stage: 04
Active task: 04.1

## Сейчас

Полный Tirlik v4 утверждён пользователем 2026-10-13 ответом «подтверждаю!», утверждённая содержательная версия `f5f1da6230454c3d04aef02f6142bf40e37e3d8f`. Сохраняются C1-C14, J1-J5, 15 этапов, 43 задачи, 86 checkpoints и теперь 108 требований. Существенного сокращения объёма или новой концепции нет.

Первый приоритет изменён прямыми F008/F009/F011. Пользователь не принимает обычное редактирование и связанную правку цены как убедительную причину перейти из Word/Excel. AI должен быть видимой основой рабочей сессии и ассистентом по финансовым и операционным задачам; внутри этой сессии открываются полноценные предметные компоненты и редакторы. Первый proof начинается со свободной цели, потоково показывает изменяемый план AI, реальные инструменты и только обоснованные параллельные ветви, существенный вопрос, финансовое или операционное решение человека и применимые результаты. Hidden chain-of-thought не показывается; generic chat, театральные сабагенты, редактор сам по себе и одна автоматическая правка proof не закрывают. Весь public/workspace UI получает interaction-pass по R108.

Новый VibeMachina plan contract применён: PLAN содержит обещание, общие контракты и граф; stage files содержат task/checkpoint status и evidence; PLAN-HUMAN объясняет те же ID без статусов; этот STATE является коротким recovery cursor. `check-plan.mjs` после R107-R108 проходит:15 stages,43 tasks,86 checkpoints,108 requirements, без ошибок/предупреждений.

Checkpoint `d6ac5ff938e15d2f08a4d582387ede1306037007` сохранил и отправил в `origin/main` весь проверенный handoff WIP: sources/materials, workspace, documents, sheets, designs, exports, runtime/tools, demo/onboarding, миграции 0011-0016 и обновлённую каноническую память. Это WIP boundary, не принятие всех активных задач. Приватные BRIEF/TESTING/runtime/env, `.local-data`, obsolete NEXT-CHAT-PROMPT и `.codex/config.toml` не включены.

Fresh read-only review завершён. Он подтвердил пять конкретных разрывов A15-13..A15-17: demo hardcoded/no AI; server не авторитетен для formula recalculation; source fact не связан с price/quantity/formula chain; AI UI является отдельным техническим журналом; commercial procedure пока не проверяет margin/capacity/deadline. Работающие основания сохраняются: atomic editable artifacts, numeric provenance, отделённые data fields, changeset/apply/undo и fixed-revision export.

## Следующие шаги

1. Зафиксировать quiescent integration snapshot через штатный checkpoint с explicit paths и push. В память внести только evidence/границы, не объявлять весь продукт завершённым.
2. После checkpoint назначить strong demo owner на10.2: isolated replay той же реальной assistant procedure, no personal writes/fake streaming/local-only business logic. Это главный оставшийся product-value gap против Word/Excel.
3. Выполнить bounded live J1 только после demo/assistant HTTP readiness, runtime ledger и отдельного paid release. Предварительная readiness PASS, provider calls не выполнялись.
4. Затем 11.1/12.1 full independent review, 13.1 README/clean launch и дальнейшие presentation/video tasks. Hosting/cloud остаются отложены пользователем.

## Проверено

- Свежий плановый контракт PASS после R107-R108 и исправления write-path graph; source-preservation/plan consistency также PASS на108 requirements.
- Checkpoint `d6ac5ff`: все 6 configured checks PASS и push PASS. Включены `check-plan`, source-preservation/plan consistency, `git diff --check`, privacy/Git hygiene, `scripts/check.mjs` и свежий `scripts/check-build.mjs` на выбранном snapshot.
- Fresh review: 33/33 focused unit/domain, 17/17 canonical isolated PostgreSQL integration и `npm run typecheck` PASS. Это доказывает существующие части и воспроизводит разрывы, но не full HTTP/live J1.
- Детальные focused/DB/HTTP evidence по materials, sources, editors, exports, runtime и demo остаются в соответствующих stage tasks. Quiescent HTTP matrix на fresh production builds: `http-identity`, `http-artifacts`, `http-workspace`, `http-demo`, `http-sources`, `http-runtime`, `http-sheets` (4/4), `http-materials` и combined `http-product` PASS. Root unknown paths теперь semantic404 без redirect/error shell; `/ru/missing` и `/kk` recovery локализованы. `scripts/check.mjs` после последнего repair PASS. Live J1/provider calls ещё не выполнялись.
- Критические известные границы до live/financial acceptance: не доверять client cached formula value; не использовать универсальное minor/100; geometry/style-only change не создаёт value override; text/fill bindings независимы.
- Внешний вид, ясность AI-first композиции, 3–5 секунд понимания и 2–3 минуты знакомства не проверены агентами и остаются пользовательской проверкой.

## Сервисы

Dashboard: http://127.0.0.1:4177/

Mailpit: http://127.0.0.1:8029/

Windows сейчас держит exclusion range `59631-59830`, поэтому прежний порт59676 недоступен без владельца-процесса. Штатный launcher поднял текущий product на `http://127.0.0.1:59850/`: `/` и `/api/health` возвращают200, Mailpit `8029` возвращает200. Runtime instance `7162e25c-4d27-49dd-8447-6fd5222ed497`, supervisor179152, app198112, PostgreSQL54329. Логи текущего запуска лежат в `.local-data/dev/`; остановка только `node scripts/dev/stop.mjs`. Вкладки агентами не открывались.

## Работники

- `/root/core_authority` (GPT-5.6 Sol xhigh):05.1+08.1; `src/features/sheets/`, `src/features/dependencies/`, их tests/APIs/contracts/schema; exclusive artifact loans: server command-history/service/service-support/lifecycle + integration test, contracts artifacts/commands, domain content-models/operations/semantic-validation/targets/content-state + focused tests and necessary client snapshot consumers for property-scoped bindings; exact compatibility loans designs/domain/actions, designs/ui/design-editor + focused tests and demo/domain/store + focused test. Bounded loan `vitest.integration.config.ts` only for exact database classification of new sheet/operations/business tests. Shared root/migrations Git handover только MAIN.
- `/root/business_assistant` (GPT-5.6 Sol xhigh):04.1+07.1; `src/features/agent-tools/`, `src/features/commercial/`, их tests/evals. Runtime/workspace/operations consume-only.
- `/root/assistant_session` (GPT-5.6 Sol xhigh):03.2 AI-first work session; `src/features/workspace/`, runs UI/locales, workspace tests, exact work/project/artifact/runs page loans. Bounded F010/privacy loans: identity UI settings/account-menu/entry/private-tab-drafts, identity domain return-to and focused tests only for Work-vs-Settings navigation, validated assistant `run` context, preserved returnTo and owner-scoped session draft cleanup. Runtime server read-only.
- `/root/operations_delivery` (GPT-5.6 Sol high):07.4; operations feature/tests/evals/API, operations schema и0017 draft loan. Shared PlanEntry change requests to core owner.
- `/root/runtime_completion` (GPT-5.6 Sol high):02.2; runs client/domain/server, tests, API, runs contract/schema, immutable0016, forward-only exact loan `migrations/0020_run_event_kinds.sql` for F011 branch/projection events, and eval script. Runs UI/locales belong assistant_session;0017/0018/0019 reservations untouched.
- `/root/source_completion` (GPT-5.6 Sol high):02.3 source paths/routes/tests/contracts/schema; paid OCR only through accepted runtime ledger.
- `/root/materials_completion` (GPT-5.6 Sol high):02.4 materials paths/routes/tests/contracts/schema; canonical sources consume-only.
- `/root/export_completion` (GPT-5.6 Sol high):03.4 exports paths/tests; selectively review ignored CP2, fixed-revision DOCX+XLSX/package boundary. Exact compatibility loan `src/features/demo/server/export.ts` only to pass stable synthetic artifactId and `exclude-internal` into the new RenderInput; no demo behavior/copy redesign.
- `/root/public_ai_story` (GPT-5.6 Sol high):10.1 public-site feature/assets/tests and exact locale/public page loans; после первого handover возобновлён только для F011 interaction/craft pass, no workspace/runtime writes.
- `/root/not_found_repair_v2` (GPT-5.6 Sol high): bounded R41 Next16 repair; exact loans `next.config.ts` only for `experimental.globalNotFound`, `src/app/global-not-found.tsx`, `src/proxy.ts` only for direct semantic 404 of unknown first-segment public paths, focused identity route tests. Proxy excludes assets/API/app/auth/settings/supported locales; no redirects/auth bypass. No other config/app changes; no Git.
- `/root/runtime_integration_review` (GPT-5.6 Sol high): read-only review of `/root/runtime_completion` handover and scoped runtime checks; Paths:none, no source/Git/memory changes.
- `/root/operations_integration` (GPT-5.6 Sol high): review stable07.4 handover; exclusive shared loans only `migrations/0017_operations.sql.draft` -> reviewed final `0017_operations.sql` and `src/server/db/schema.ts` export. Runtime/export/workspace integrations read-only until their owners hand over.
- `/root/value_evidence_review`: done read-only, no paths retained.

Все новые workers читают полный BRIEF, TESTING и требуемые VibeMachina references; UI workers дополнительно читают DESIGN, foundation, anti-slop, UX, copy/system/art и полный F009. Имена старых работников в stage evidence и ignored scratch обозначают только историческое авторство.

## Передача

Только VibeMachina; другие skills/plugins не используются. MAIN владеет памятью, Git и координацией; substantial source review, implementation и integration делегируются. Визуальная/browser проверка полностью принадлежит пользователю: никаких CUA, Playwright, Selenium, Puppeteer, headless, screenshots или обходов через worker/renderer.

Работа только локальная. Hosting search, cloud deploy и probes отложены пользователем до выбора сервера. Git только через `C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs` с реальными checks, explicit paths и `--push` в проверенный upstream. Private `.vibemachina/BRIEF.md`, `.vibemachina/TESTING.md`, `.vibemachina/runtime/`, `.local-data/` и env не публикуются.

Общий новый OpenRouter ceiling: USD 10. Последний подтверждённый новый расход `$0.00008652`, новый reserve `0`; старый отдельный ledger confirmed `$0.0400707`, unresolved `$0.480832`, attempted ceilings `$0.81472` сохраняется. Не освобождать uncertain reserve и не делать blind retry. Платные обращения выполняет один назначенный executor после quote/reservation/readiness; secrets остаются server-only.

Ignored `.local-data/agent-scratch/` содержит частичные пакеты старых авторов. Продвигать только review mapped paths после сравнения с active source; полный каталог поверх проекта не копировать. Подробный фактический progress остаётся в stage tasks, а не дублируется здесь или в новых handoff/queue/report файлах.
