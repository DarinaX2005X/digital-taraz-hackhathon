# 09 Возврат к работе, коллеги и повторение рутины
Status: active

Разовая генерация не оправдывает отдельный продукт. Сохраняем принятые правила, помогаем коллеге принять результат и повторяем работу на новых данных без стирания прошлой версии.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 09.1 Сохранить контекст бизнеса и проверенные рабочие блоки
Status: active
Requirements: R10, R25, R32, R35, R36, R44, R45, R91, R103
Depends on: 03.1, 02.1
Owner: SUBAGENT to assign (передача; прежний автор: business_context)
Paths: src/features/business-context/, tests/business-context/, src/app/api/business-context/, src/app/app/business/, src/contracts/business-context.ts, src/server/db/business-context-schema.ts

15октября fresh GPT-5.6 Sol owner начинает подтверждённые сведения/бренд/условия/повторные блоки на принятых artifact/identity/source contracts. До RELEASE текущегоCP1 пишет только ignoredscratch. Полная09.1приёмка сохраняет08.2/06.1: linked/detached reuse, review изменений иединыйBrandKit должны быть подключены креальнымредакторам. Canonical material facts/privateassets переиспользуются, не создаётся вторая библиотека. При необходимой новой metadata persistence зарезервирована0018_business_context.sql.draft/final после reviewintegration; sourceheads/общиесхемы/routeshell исключительноихowners.

**Контракт и результат.** C3, C10. Versioned BusinessContext facts/terms/brand kit/reusable approved docblocks and procedures. Explicit confirm vs extracted suggestion; effective dates/source evidence/owner/access. Free-form business notes not forced sector form, no model memory of secrets without stored permission. Scoped search and selectors reused by tool context; superseded prices/terms not silently strongest. Add/remove reuse block copies with provenance, choose linked vs detached; business setting change shows affected projects rather than rewriting all.

**Вход в работу и состояния.** Бизнес: компактные sections «Сведения», «Бренд», «Условия», «Сохранённое»; create from existing selected block via «Сохранить для повторного использования». Empty profile optional. Conflict dates/duplicates and permission error retain edit; all locales/user text preserved.

### 09.1.1 Подтверждённый контекст
Status: active

Storage effective date precedence, permission filtering, suggestions not facts, version revert safe; tool context receives only selected allowed items.

### 09.1.2 Повторное использование без сюрпризов
Status: todo

Same brand/terms in new unrelated project, detached block stays local, linked update offers diff. User checks discoverability without ERP-style setup burden.

## 09.2 Передать результат коллеге на правку или утверждение
Status: todo
Requirements: R11, R16, R22, R25, R39, R90, R94, R96
Depends on: 08.2, 07.4, 02.1
Owner: SUBAGENT to assign
Paths: src/features/collaboration/, tests/collaboration/

**Контракт и результат.** C3-C4, C10. Version-anchored comments on block/cell/layer/plan item, mentions permitted members only, assignment and approval scoped by project. Owner requests review currentrevisionhash, reviewer comments/approve/reject with reason; changing material invalidates approval. Deleted target comment remains in history with tombstone; role revoke blocks old link/comment/export and background jobs. Notifications only actionable input/review/finished scheduled work, eventcursor dedup, markread not businessapproval.

**Вход в работу и состояния.** Context comments drawer and reviewer inbox, direct deep link opens specific object/version with current-vs-reviewed marker. No customer role or client chat. Manager sees pending approval, staff sees assigned work; mobile contextual single pane, server errors preserve typed comment.

### 09.2.1 Права и привязанные обсуждения
Status: todo

Two-user API flow requestreview/comment/approve/edit invalidation, third-user denied, role revoked midjob, no comment contents leaked through event stream.

### 09.2.2 Возврат исполнителю и понятный статус
Status: todo

Deep link and inbox actual route handlers, comment survives moved row and deletedtarget history, notification retries dedup. User verifies handoff without knowledge of architecture.

## 09.3 Повторять работу по новым данным и видеть подтверждённый эффект
Status: todo
Requirements: R01, R05, R10, R12, R13, R25, R42, R91, R99, R103, R105
Depends on: 09.1, 09.2, 08.3, 05.3
Owner: SUBAGENT to assign
Paths: src/features/recurring-work/, tests/recurring-work/, evals/recurring-work/

**Контракт и результат.** C1 J5, C8, C10-C11. WorkRule versioned free instructions/goal/inputselectors/resultspec/eventorschedule/timezone/budget/owner/enabled/nextOccurrence. Create from accepted project; run creates branch on new source snapshots, never overwrite approved work. Workflow durable sleep/webhook with unique rule+occurrence, missed occurrences coalesce1, disable/cancel checked at execution, source schema drift waiting_input. No arbitrary external integrations promised. Outcome logs actual export/preptime/discrepancies/manual corrections and voluntary evidence of application; baseline human-entered separate from measured runtime, revenue causal attribution not invented.

**Вход в работу и состояния.** Project «Повторять работу»: choose trigger/manual/new source/schedule and edit instructions, preview next occurrence/cost cap/outputs. Бизнес shows enabled rules with pause/run now/history; completed branch goes review inbox with changes. Effect view optional and modest, no fake KPI dashboard; missing data explicitly unknown.

### 09.3.1 Надёжный повтор с новыми источниками
Status: todo

New monthly file applies mapping/rules, creates diff branch preserving old outputs; schedule timezone/redeploy/doublewebhook/disableinflight/costcap and drift recovery tested.

### 09.3.2 Честный результат повторной работы
Status: todo

Actual outcome events dedup, no business success from just generated file; live repeated task reduces repeated setup yet detects new unknown. User checks rules can be understood/paused and compares before/after.

