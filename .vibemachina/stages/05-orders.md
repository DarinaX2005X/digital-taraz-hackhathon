# 05 Из предложения в клиентский заказ и исполнение
Status: todo

Замыкаем механизм продукта: утверждённая версия становится клиентской страницей, заказ получает общий резерв, сотрудник выполняет его, результат остаётся в учёте.

## 05.1 Опубликовать проверенную версию предложения
Status: todo
Requirements: R01, R04, R10, R11, R14, R16, R25, R32, R37, R38, R39, R40, R44, R82, R83, R87, R88
Depends on: 04.2, 04.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/offers/, src/server/db/schema/offers.ts, tests/offers/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/offers/, src/app/api/v1/workspaces/[workspaceId]/offers/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

C5 publication принимает proposalVersionId, expectedHash, approvalToken, Idempotency-Key и actor. В одной transaction проверяет права/email verification, свежесть resources/locks, обязательные terms, сохраняет public OfferVersion, approval receipt и event/outbox. Agent publish tool использует тот же service. Raw model cannot invent consent; approval tied to displayed hash, already-approved routine bounds later07.1.

Owner editor: title, media, состав/длительность, цена, способы получения, место/район по вводу бизнеса, контакты, сроки, refund/cancellation/request-vs-instant rules и hold TTL. Customer preview только whitelist поля. Recipe/resources/cost/source docs не попадают в public DTO. Pooled/allocated ресурсная политика показывает совместные ограничения. Publish не означает резерв всего pooled stock.

Offer detail состояния draft/ready/published/paused/ended/archived, schedule start/end with deterministic server gating. Publish/price change new snapshot, existing orders unchanged. Pause instantly prevents reserve, unpause revalidates; delete used offers archive. Copy link/text, share-ready message and optional QR через библиотеку, no automated WhatsApp/Instagram sending. Feature-owned ru/kk/en, unsaved form retention/narrow preview.

Приёмка replay samepublish, stale hash, revoked role/verifyemail, private data leak, quotaovercommit, paused/ended reserve guards. UI action -> service -> stored version -> GET public; confirmation не автоматический по фразе модели.

### 05.1.1 Публикация и доказанное разрешение
Status: todo

Immutable snapshots, approval/hash receipt, service registration for AI; API replay/stale/privacy tests.

### 05.1.2 Редактор и жизненный цикл
Status: todo

Owner list/detail/editor/preview, publish/pause/expiry/version changes, correct context actions всех locales.

### 05.1.3 Реальная ссылка и передача checkout
Status: todo

Public projection, share text/QR, host-relative links; подтверждённая доступность query и no private fields.

## 05.2 Принять клиентский заказ или запись без двойного обещания
Status: todo
Requirements: R04, R10, R11, R16, R25, R34, R35, R38, R39, R40, R41, R43, R44, R82, R83, R87, R88
Depends on: 05.1, 02.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/checkout/, src/server/db/schema/orders.ts, src/app/api/public/, tests/checkout/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/o/, src/app/[locale]/order/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

/o/[slug] показывает настоящий business/offer name, media, price/units, included items, доступность и условия. Товар: quantity+fulfillment. Услуга: date/resource-compatible slots; mixed offer требует обе части. Customer не регистрируется в owner app. Минимальный контакт name+chosen phone/email, consent на передачу бизнесу, no paymentcard/ИИН. Правила cancellation и ожидания подтверждения видны до submit.

Неподтверждённый контакт не блокирует ресурс: awaiting_contact без резерва. Для email OTP/proof из PROJECT C5, затем idempotent POST reserve с повторной проверкой offer version/price/availability. Для телефона без SMS-провайдера обращение без резерва на 24 часа, только управляющий после настоящего внешнего контакта отмечает manual_contact_verified и делает atomic confirm. Instant допускает только verified email, письмо не изображается отправленным при недоступном SMTP. Default quantity limit 1 с настройкой владельца до publish, не больше одной активной заявки на contact+offer и rate limits на весь публичный вход. Тексты до submit ясно объясняют, когда ресурс закрепляется.

Stale slot/lastitem 409 сохраняет контакт и предлагает fresh availability; no success пока DB commit не прошёл. Disabled button UI не concurrency protection. Random customer access token hashed at rest, выдаётся только в response/email, URL referrer policy/noindex/redacted logs. Token access не даёт списка или чужих данных. Recovery по повторно verified email даёт новый доступ, для телефона требуется ручная проверка управляющего; public lookup по контакту запрещён. OTP hash/TTL/attempt/cooldown/reuse/checkout binding, провайдерный outage, фиктивный email/телефон и массовые неподтверждённые обращения проверяются: resource availability не меняется до проверки. Повтор кода/submit не дублирует заказ и не продлевает hold.

После подтверждения контакта instant confirmed или requested hold по terms, TTL виден timezone. До него статус awaiting_contact прямо сообщает отсутствие резерва. Public status page shows timeline/snapshot, allowed cancellation by server rule, cancellation release exactlyonce. Invalid/expired token безопасное error; soldout/paused/ended distinct content, unknown slug real404. Все тексты/email/validation locales, touch slots and full keyboard structure; provider outage не теряет committed order и отдельный email pending.

Приёмка concurrent HTTP finalitem/slot tests реальной DB, retry after lostresponse, different payload samekey, multi-resource failure allrollback, ttl expired without cleanup, abusive submits/rate limit, token leakage/private fields. User проверяет mobile purchase/booking, agents только API.

### 05.2.1 Клиентское представление и выбор
Status: todo

Public page/DTO, quantity/slots/terms/validation, valid и invalid slugs с proper HTTP statuses.

### 05.2.2 Атомарная заявка и восстановление ответа
Status: todo

Order+reserve transaction, idempotency access result protected, lostresponse/concurrent lastitem tests, persisted status access.

### 05.2.3 Возврат клиента и отмена
Status: todo

Own order page/notifications/TTL/cancellation rules, token and privacy guards, все locales и narrow user checklist.

## 05.3 Передать заказ исполнителю и довести до результата
Status: todo
Requirements: R10, R11, R12, R25, R31, R32, R34, R35, R36, R37, R38, R39, R40, R44, R83, R87, R88
Depends on: 05.2, 04.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/fulfillment/, src/server/db/schema/fulfillment.ts, tests/fulfillment/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/orders/, src/app/api/v1/workspaces/[workspaceId]/orders/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Owner orders table filter/search/status/date/assignee, detail immutable promise/contact/resource reservations, assign/change person and checklist. Staff home /orders?assigned=me sees only assigned necessary items/time/contact and next action; no cost/source/other customer list. Tool-created fulfillment task links real order, cannot fabricate completed delivery. Date/time displays workspace timezone, filters immediate/dedup/cancel.

C5 transitions with expectedRevision/idempotency: verify-contact вручную после реальной связи для phone inquiry, accept/reject requested, start confirmed, fulfill in_progress, cancel rules; report issue keeps history and notifies owner. ResponsibleMembershipId назначает координатора без изменения resource booking. Фактический исполнитель услуги показан отдельно и связан с canonical person-resource/membership; его изменение вызывает exchangeReservations с locks всех затронутых ресурсов. Нельзя освобождать прежнее время до успешной проверки нового, создавать второй person-calendar для обхода занятости или незаметно менять обещанного клиенту специалиста. Согласование существенного изменения условий хранится отдельным event. Completion checklist constraints explicit, attachment evidence optional private, accidental close recover via controlled correction event not silent rewrite.

Fulfill consumes physical resources exactlyonce and records actual completion time, cancel releases held resources; postfulfillment return/restock requires owner choice quantity/condition, not auto restock all. Refund/payment separately05.4. Concurrent staff+manager transition409 preserves note. Expired requested cannot confirm without new atomic availability check and revised promise.

Приёмка whole role handoff API two accounts, revoked staff during job, completion replay, cancel-vs-fulfill race, partial issue and reassignment, negative restock, failed notification no status loss. UI empty/pending/conflict/actionerror, three locales and narrow list/detail. User checks clarity of next action and staff surface.

### 05.3.1 Список работы и назначение
Status: todo

Owner/staff projections, search/filter/detail, membership enforcement and assignment notifications; API permission tests.

### 05.3.2 Исполнение и учёт ресурса
Status: todo

State machine/checklist/issues/consume/cancel/restock транзакции, races/replay/expired hold tests.

### 05.3.3 Рабочие экраны ролей
Status: todo

Useful next action, issue feedback, persisted notes and recovery, locales/mobile; пользовательский проход владелец -> сотрудник.

## 05.4 Показать фактический результат и подготовить повторный запуск
Status: todo
Requirements: R01, R04, R10, R12, R13, R16, R25, R36, R38, R39, R40, R44, R83, R87, R88
Depends on: 05.3, 02.4
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/outcomes/, src/server/db/schema/outcomes.ts, tests/outcomes/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/results/, src/app/api/v1/workspaces/[workspaceId]/outcomes/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Outcome ledger stores owner-recorded payment/refund with money/currency/date/source and correction events, не подключённый acquiring. Sales stages count requested/confirmed/fulfilled/paid separately, no automatic revenue from lead. Cost snapshots per fulfilled order, unknown components disclosure; contribution uses associated recorded amounts and supplied variable costs, not net profit or causal growth.

Results per offer/period/resource: открытия публичной ссылки, заявки, подтверждения, orders fulfilled/cancelled, utilisation against configured capacity window, recorded receipts/refunds, resource bottlenecks. Открытия учитывает минимальное first-party событие без контактов/полного IP, с ограниченным session dedup и фильтром очевидных служебных запросов; это приблизительные открытия, не доказанное число людей или спрос. Метрика не рисуется при отсутствии событий, сбой beacon не блокирует заказ. Filters date/timezone, currency separated, refunds correctly attributed/timebasis explained, drilldown into underlying records. Chart accessible table and CSV export hook07.3. No fabricated percentlift or benchmarking local business.

«Повторить с актуальными данными» starts new goal referencing chosen history and refreshed resource facts, does not copy paid records/publication or create actual bookings. Agent reads read_outcomes tool with evidence and can revise constraints; causal claims checked by prompt/eval.

Приёмка reconciles order/payment/refund ledger sum, partial payments, cancellation after payment, crossperiod refund, missingcost, manual correction audit, repeat Idempotency-Key. UI empty vs no-data-error separate, locales and mobile. Реальная бизнес-эффективность не заявляется из synthetic demo.

### 05.4.1 Факт и корректировка
Status: todo

Outcome/payment/refund entries, permission/immutability/receipts, exact totals и unknown cost tests.

### 05.4.2 Результат и новый цикл
Status: todo

Dashboard без vanity metrics, underlying drilldown, compare planned vs reported, repeat goal with fresh context; API+user checks.
