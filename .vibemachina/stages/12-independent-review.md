# 12 Независимая проверка запроса и исправление дефектов
Status: todo

Отдельный проверяющий сначала сравнит реальный продукт с исходными словами пользователя, а затем с техническими контрактами. Найденные ошибки исправляются до оформления окончательной поставки.

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
Paths: src/, tests/, scripts/

**Контракт и результат.** C13; flow/05-review.md. Exact repair scopes derive only from confirmed findings, not guessed bugs. All earlier writers finished; MAIN splits fixes into bounded exclusive feature paths and loans shared contracts/routes/schema only where required, never dispatch allsrc as unrestricted refactor. Preserve unaffected code and user edits. Each F has minimal repro/regression or explicit reason test not applicable, ownership and closure evidence. Security/data-loss/coreworkflow/launch bugs block completion. User visual fixes stay pending after code checks.

**Вход в работу и состояния.** Fix in place within original route/editor, no new feature or general redesign to dodge finding. Preserve drafts and saved project compatibility; any data repair migration preview and backup required. MAIN rereads original TESTING before each coherent checkpoint.

### 12.2.1 Подтверждённые исправления
Status: todo

Small verified feature batches, failed test becomes passing, cross-boundary side effects retested. Hand paths back before MAIN checkpoint; no empty commits if review found no defect.

### 12.2.2 Стабильная интегрированная поставка
Status: todo

Run full required checks after final fix, reconcile everyfinding/requirement and actual user feedback. Reviewer targeted follow-up on changed evidence only when needed, not whole repeated ceremony.

