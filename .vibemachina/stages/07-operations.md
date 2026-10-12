# 07 Сопровождение изменений, прозрачность и выход из системы
Status: todo

Предложение продолжает жить после запуска: изменения становятся безопасными действиями и уведомлениями, работа AI проверяема, данные можно выгрузить и удалить.

## 07.1 Реагировать на изменения и исполнять разрешённые действия
Status: todo
Requirements: R01, R10, R11, R14, R15, R16, R25, R38, R39, R42, R43, R83, R84, R86, R87, R88
Depends on: 05.4, 03.2, 04.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/automation/, src/server/db/schema/automation.ts, tests/automation/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/policies/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Subscribe outbox resource.updated/order.cancelled/order.fulfilled/offer.expired/cost.changed с sourceRevision и causeRun. Сначала deterministic invalidation availability/stale snapshot, затем AI реакция, когда есть meaningful action. Event dedup/coalescing by workspace+aggregate revision, no endless agent-self-event loop; outbox delivery leased/fenced+DLQ visible, not lost on provider error. Workflows runtime code changes MAIN loan or bounded integration via03.1 API.

Owner settings/automation extension defines explicit policy scope offers/resources/actions/bounds/expiry. По умолчанию draft/read only + manual publish. Можно разрешить pause exhaustedoffer и republish unchanged price/recipe после resource revalidation в указанном диапазоне; изменение цены/audience/существенных terms всё равно explicit approval если не разрешено. Permission grant stored version, each step rechecks revocation; agent cannot mint/change own policy. No automatic external messages/payments.

При событии освободилось время агент изучает текущую цель/связанные offers, предлагает новый вариант или исполняет доступное действие; без события demand не выдумывает. Resource exhausted stops new reservations immediately in domain, не ждёт агент. Conflict newoffer with oldproposal requires fresh validate. Action log useful input/event/result and status, skip duplicate/coalesced explains why.

Приёмка cancel->releasedslot->new validated proposal, stockdrop->pause, revokedpolicy betweenplan/write, duplicate storms, broker restart and costbudget. Eval variedgoals/industry not hardcoded event->template. Settings labels/error/preview/confirmation ru/kk/en, responsive keyboard structure.

### 07.1.1 События и отсутствие повторных эффектов
Status: todo

Outbox subscription/coalesce/retry/DLQ, self-loop guards, failure/restart/concurrency tests with real DB.

### 07.1.2 Права на ограниченную автоматизацию
Status: todo

Policy schema/editor/preview/expiry/revoke, server enforced bounds and stale grants, tool integration not UI-only controls.

### 07.1.3 Адаптивная реакция на реальное изменение
Status: todo

Live cancel/resourcechange->analysis->newdraft/allowed operation, record actual trace and no fabricated demand.

## 07.2 Показывать действия, ошибки и нужные уведомления
Status: todo
Requirements: R11, R14, R16, R25, R31, R32, R36, R38, R39, R40, R42, R43, R44, R87, R88
Depends on: 07.1, 05.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/activity/, src/features/notifications/, src/server/db/schema/notifications.ts, tests/activity/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/activity/, src/app/api/v1/workspaces/[workspaceId]/activity/, src/app/api/v1/workspaces/[workspaceId]/notifications/, src/app/api/v1/workspaces/[workspaceId]/events/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Unified activity event projection actor human/tool, object link, business reason summary, timestamp/timezone, result/error and revision; read views paginated+filter byobject/type/actor. Run detail source/evidence/computed fields and actual tool calls, no raw hidden reasoning or secrets. Staff projection only own tasks permitted, private source contents/costs redacted server-side. Delayed provider usage explicitly unknown/pending.

Реализовать общий workspace events API и client hook по PROJECT C6, отдельно от AgentRun stream: cursor/permission-filtered affected IDs+revisions/resetRequired. Poll 5 секунд active, 30 секунд idle, pause hidden/offline, catch-up на focus/reconnect; поддержка пропущенного/просроченного cursor без потери обновлений. При hints перечитываются order list/detail, staff assignments, resource availability и outcomes. Shared shell hook подключает MAIN через loan, listeners не плодятся на каждой панели. Customer availability refetch после submit conflict/focus, а окончательное решение всегда в transaction. HTTP/API тест с независимыми cookie sessions клиента/владельца/сотрудника проверяет появление заказа, назначения и отмены без локальной mutation той же вкладки; повтор/пропуск event не меняет доменные counts. Проверить revoke доступа между polls и отсутствие чужих IDs в staff projection.

Notification inbox: action required approval/question/conflict/order issue/assigned task. Markread/seen idempotent, unread counts stable, no poll duplication. In-app notifications durable; optional email only transactional consent-relevant events and throttled digest, SMTP failure pending/retry, no fake sent. Rate/debounce prevent eventstorms, role revocation invalidates links and payload access.

Real workflow followup opens current object and next allowed action, cancelled run not clickable resume if domain forbid; errors humanexplanation and safe retry, user draft retained. Locale updates stored types translated at display, emails at recipientlocale. List/search immediate, narrow timeline readable and dates nonoverlap. Toast supplementary not only evidence.

Acceptance eventseq gap/reconnect/render projection, permission matrix, duplicate delivery/double markread, deleted object, error vs empty; report no generated fake activity. User evaluates whether event explanation and nextaction understandable.

### 07.2.1 Прозрачная история
Status: todo

Read models/API/timeline filtering, role redaction, cursor/backfill correctness; real tool vs modeled reasoning distinction.

### 07.2.2 Уведомление и восстановление
Status: todo

Inbox/counts/preferences/retry SMTP receipts, actionable links и all states/locales; API sequence/replay/revokedrole tests.

## 07.3 Выгрузить полезный результат и управлять своими данными
Status: todo
Requirements: R10, R16, R25, R38, R39, R40, R43, R44, R63, R64, R87, R88
Depends on: 05.4, 04.1, 04.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/exports/, src/features/privacy/, tests/exports-privacy/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/exports/, src/app/api/v1/workspaces/[workspaceId]/deletion/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Owner exports selected proposal/offer/outcomes/resource ledger/source facts CSV/JSON, readable PDF quote/result через pdf-lib+embedded Unicode font (не HTML/browser renderer). Export snapshot has scope/filter/asof/timezone/currency/costcompleteness/source labels and synthetic markers where relevant. CSV formula escaping, filenames safe, massive rows async bounded chunks with status, no silent truncation. Public share exports whitelist only, never privatecost/source/contact.

Data privacy service: download workspace archive owner only, references to private source files with authorized expiry no stable public path. Delete source checks dependentfacts/offers, retains tombstone+derived confirmed facts policy with visible consequence; deleteworkspace confirmation+recent auth starts durable job freeze writes/cancel runs/revoke publicslug/remove own blobs/delete or anonymize retained audit per statedpolicy. Verify deletion cannot cross tenant, retry safe, no claims instantaneous deletion backups/provider copies. Active customer commitments show consequence and export before destructive confirm, not accidental menu click.

UI settings/export buttons integrated via slots/MAIN loan; primary success actual artifact download, accessible progress/error/cancelbeforecommit. All locales printed glyphs/decimal/timezone correctly; no «печать браузером» as only PDF. PDFs/images of data docs are artifacts, not app screenshots.

Acceptance parse produced CSV/JSON/PDF to confirm values/Unicode/filters, injection fields, tenant snapshot isolation under concurrent edits; deletion interrupted/retried exactlyonce, blob auth revoked; user opens artifacts for visual review.

### 07.3.1 Экспорт по текущему объекту
Status: todo

Service/snapshot/download, CSV/JSON/PDF correctness, no hidden data and formula injection tests.

### 07.3.2 Приватность и удаление с последствиями
Status: todo

Owner confirmation/export/freeze/revoke/delete workflow, cross-tenant/restart tests, honest retention explanation.

### 07.3.3 Использование готовых файлов
Status: todo

Context buttons/profile integration, largejob recovery and localefonts; artifact links to user without automated app rendering.
