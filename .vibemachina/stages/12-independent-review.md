# 12 Независимая проверка запроса и исправление дефектов
Status: todo

Отдельный проверяющий сначала сравнит реальный продукт с исходными словами пользователя, а затем с техническими контрактами. Найденные ошибки исправляются до оформления окончательной поставки.

## Ранний аудит по поручению15октября2026

Это отдельный независимый аудит текущего committed+WIP после первичного UX разбора, не завершение будущего финального12.1 по всему продукту. Четыре fresh read-only reviewer получили сначала полный BRIEF и TESTING с запретом чтения планового обоснования; после первых фактических findings получили relevant contracts. MAIN интегрирует выводы, никаких browser checks.

| Finding | Доказанный разрыв и воспроизведение | Исправление и приёмка |
| --- | --- | --- |
| A15-01 P1 | Project creation создаёт blank document, artifact route монтирует только ArtifactContentPreview; прямого editable результата и export нет |03.2/03.3/05.1/03.4: реальный mount, direct command, save/reopen/export. Не закрывать по существованию controller |
| A15-02 P1 | Source mapping CTA ведёт /app/materials, page/API отсутствуют, materials services без production callers |02.4: полный hub/collection/import workflow,0011 после review, real route/HTTP/source lineage |
| A15-03 P1 |02.2 registry содержит только test/private proof capabilities; saved goal невозможно исполнить и получить artifact |04.1: public goal capability и реальные typed services, canonical ledger/receipts, UI action/result/recovery |
| A15-04 P1 | Фото/скан остаётся partial с pending source_pages, обработки/recognize action нет |02.3: OCR через общий runtime, progress/review/cancel/partial/error без подмены готового результата |
| A15-05 P2 | Header Sign in при expired session теряет returnTo/RAMdraft; reset link вmodal также покидает ввод |03.2/shared auth owner: единый guarded auth entry с восстановлением того же пользователя и исходной работы |
| A15-06 P2 | Pending create dialog можно закрыть X/Escape/outside как discard, активный request позже создаёт объект/redirect, attempt key очищен |03.2: запрет ложного discard во время эффекта либо явное reconciliation; regress uncertain outcome/no duplicate |
| A15-07 P2 | intent восстановлен до replace workspace query; key={workspaceId} remount уничтожает восстановленную цель |03.2/auth: стабильный restore/consume после workspace resolution, успешный/отменённый вход с сохранением draft |
| A15-08 P2 | Валидный XLSX с package-absolute worksheet Target=/xl/worksheets/... отвергается office parser |02.3: безопасное разрешение URI от workbook part, unit probe relative/absolute/malicious targets |
| A15-09 P2 | Исправление существующего ключаA на новыйB сохраняет UUIDA и ломает INSERT; следующий resolve забывает прежнийkeyOverride |02.4: отдельная provisional identity, повторная классификация по текущему ключу, сохранение override, реальныеSQL regressions |
| A15-10 P1 | Cyclic sheetA1=B1/B1=A1/SUM зависимого возвращает0 безdiagnostics, focusedtestFAIL |05.1: честные cycle/dependent errors, исправить engine policy, не подменять ошибку числом |
| A15-11 P2 | Design commands всегда expectedSourceRevisions={}, document берёт pinned вместоcurrent; реальныеassertSources отклоняют ручнуюправку |03.3/06.1: полныйcurrent authorized vector + before/afterunion, pinned provenance сохранить; validator не ослаблять |
| A15-12 P2 | Move artifactA->B оставляет historyURLA, послеreload404 |03.1: canonical redirect/title/returnTo послеconfirmedmove иrecovery |
| A15-13 P0 | Public demo состоит из hardcoded artifacts/localStorage и показывает только ручную цену, diff и DOCX; AI, source upload и деловое решение отсутствуют |10.2 после04.1/07.1: тот же реальный assistant procedure в isolated context, consequential decision, no fake streaming/personal writes |
| A15-14 P0 | Client готовит cached formula value, но artifact server apply сохраняет операции без authoritative evaluate/recalculate |05.1/03.1 shared loan: prepared calculation с immutable input/content hash и transactional revision/ACL/source revalidation; forged cached total rejected |
| A15-15 P0 | `business.prepare_offer` сохраняет source bindings, но реальные edges только amount cell -> document field; новый price fact не достигает table price/quantity/formula |08.1/04.1: stable source fact -> table inputs -> server calculation -> reviewed document/plan patches, real new-source integration proof |
| A15-16 P1 | AI backend создаёт offer, но UI ведёт goal -> отдельная technical activity page -> editor; ассистент не является основой работы |03.2/04.1/10.1: единая visible assistant session с editable plan, question, tool actions и live result components |
| A15-17 P1 | Коммерческий tool готовит документы, но не проверяет margin/capacity/deadline и не даёт decision `можно / при условиях / нельзя подтвердить` |07.1/07.4/05.2: typed finance/capacity checks, meaningful options, one blocking question and user decision before materials |

## Quiescent integration evidence after A15-13..A15-17

Последний стабильный snapshot принял следующие невизуальные boundaries: production build `JyoS3nRRmugwTtGiaq78Z` PASS; full `scripts/check.mjs` PASS (typecheck/lint/unit/domain/locale/contract). Runtime/decision projection PostgreSQL46/46, operations3/3, sources21/21, materials10/10, exports11/11, workspace8/8 и focused assistant/public suites PASS. HTTP `http-identity`, `http-artifacts`, `http-workspace`, `http-demo`, `http-sources`, `http-runtime`, `http-sheets`4/4, `http-materials` и combined `http-product` PASS на production builds. Root unknown routes получили bounded Next16 proxy/global-not-found repair и теперь возвращают semantic404 без redirect/error shell; `/ru/missing` и `/kk` сохраняют локализованную recovery.

A15-13 закрыта только в части текущей публичной boundary: editor-only demo link убран с landing до реального10.2; старый demo engine не объявлен заменённым. A15-14/15/16/17 закрыты code/domain/server boundaries описанных tasks, но полноценный live J1 с provider call не выполнялся и demo10.2 остаётся незавершённым. Визуальные F002/F004/F005/F006/F007/F008/F009/F010/F011 остаются пользовательской проверкой.

Contract pass завершён всеми четырьмяreviewers; находки сохраняются. Runtime готов для04.1 без новогоledger: нужны transaction-aware artifact effect в тойжеruntime tx и реальное continuation payload для вопроса/изменённойцели. Existing modelproof connectivity2calls/$0.00008652 проверен inventory, не повторять. Экспорт/редакторы текущиеtodo подзадачи не были объявлены done; фактический разрыв не выдаётся за регрессию целогоstage. Общий03.1done получает boundedmove fix. Snapshot audits readonly, кроме focusedNode153/155tests, безDB writes/provider/browser. Ссылки/anchors конкретных findings переданы новымwholepathowners.

Нулевые paid calls у всех новых reviewers. Повторный audit неизменённого базового budget ядра не нужен без нового дефекта; новый source/readiness evidence ниже после handover. Визуальная приёмка F002-F007 остаётся пользователю.

Проверенный baseline15октября: checkpoint999e1e25951569e7ceff6fecb69b9b3438dce89f отправлен origin/main. A15-05/06/07 исправлены в auth/dialog/intent state с238 focused tests и workspaceHTTP; A15-08 — package-absolute XLSX regression и9parser tests; A15-10 — cycle/dependent diagnostics,7engine tests; A15-11 — общий current authorized before/after source vector, document19/design18 focused tests и DB freshness boundary; A15-12 — canonical move location, history routing и real DB/HTTP old404→newvalid. Общие type/lint/unit/build/DB/identity/artifacts/workspace/sources/runtime checks завершены. Это подтверждение кода и серверных сценариев; визуальная проверка остаётся пользователю. A15-01/02/03/04 и SQL acceptance A15-09 ещё в работе следующего пакета.

Следующий CP1: A15-09 исправлен и подтверждён6passing materialsDBcases. Проверены A→B с новымrecordId и сохранением исходной записи/старойpinnedhistory; явныйkeyOverride переживает отдельнуюправку цены; только explicitnull снимаетoverride ивозвращаетambiguity. HTTPmaterials4cases такжеPASS дляhub/import/query/correction/undo/ACL, что подтверждает подключение A15-02. Общая Gitboundary новогопакета ещё проверяется; A15-01/03/04 требуют оставшихся mounted/runtime/liveproofs. Пользовательская visualacceptance отдельно.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 12.1 Проверить исходный запрос, контракты и устойчивость
Status: todo
Requirements: R02, R03, R04, R05, R06, R20, R50, R51, R52, R53, R54, R55, R57, R58, R60, R87, R100
Depends on: 11.1
Owner: SUBAGENT to assign
Paths: none

**Контракт и результат.** C13; flow/05-review.md. One fresh SUBAGENT fork without inherited plan history. First packet complete original BRIEF/all later verbatim remarks, original TESTING, repo and commands ONLY; explicitly do not read PROJECT/DESIGN/REQUIREMENTS/PLAN/stages. Derive acceptance from user words and trace actual handlers/domain/persistence; return concrete findings first. Then MAIN supplies approved contracts and shared design foundation/ux/anti-slop for second/third lenses. Read-only code/API checks, no UI automation; reviewer writes no canonical files and makes no Git.

**Вход в работу и состояния.** No new screen. Return severity/promise/file:line/reproduction/expected vsactual and whether user visual confirmation needed. MAIN records bounded findings in this stage, preserving TESTING. Distinguish unsupported market claims from verified mechanism.

Допуск local-only2026-10-14: дополнительно к11.1 должен быть принят локальный checkpoint11.2.1 (нагрузка, изоляция, восстановление); отложенный по пользователю cloud/region gate11.2.2 не останавливает review локального продукта. Рецензент явно отделяет непроверенную будущую публикацию от реализованных свойств; локальный review не доказывает cloud readiness.

### 12.1.1 Независимое чтение исходного запроса
Status: todo

First-pass findings delivered before plan packet, read boundaries and actual evidence recorded by MAIN. Lost core promise cannot be waived by existing taskstatus.

### 12.1.2 Контракты, код и реальные сбои
Status: todo

Same reviewer traces source->action->storedresult->export->return, auth/roles/cost/versions/locales. Confirmed findings assigned repair in12.2, no speculative report inflation or swarm.

## 12.2 Исправить подтверждённые дефекты и повторить сломанные пути
Status: todo
Requirements: R06, R57, R59, R60, R88, R89
Depends on: 12.1
Owner: SUBAGENT to assign
Paths: tests/review-regressions/, scripts/review/

**Контракт и результат.** C13; flow/05-review.md. Exact repair scopes derive only from confirmed findings, not guessed bugs. Metadata above owns only review-specific regressions and orchestration helpers. Before dispatch, MAIN records each bounded exclusive feature repair loan in this task and removes any overlap with unfinished owners; nobody receives all `src/` as an unrestricted refactor. Preserve unaffected code and user edits. Each F has minimal repro/regression or explicit reason test not applicable, ownership and closure evidence. Security/data-loss/coreworkflow/launch bugs block completion. User visual fixes stay pending after code checks.

**Вход в работу и состояния.** Fix in place within original route/editor, no new feature or general redesign to dodge finding. Preserve drafts and saved project compatibility; any data repair migration preview and backup required. MAIN rereads original TESTING before each coherent checkpoint.

### 12.2.1 Подтверждённые исправления
Status: todo

Small verified feature batches, failed test becomes passing, cross-boundary side effects retested. Hand paths back before MAIN checkpoint; no empty commits if review found no defect.

### 12.2.2 Стабильная интегрированная поставка
Status: todo

Run full required checks after final fix, reconcile everyfinding/requirement and actual user feedback. Reviewer targeted follow-up on changed evidence only when needed, not whole repeated ceremony.

