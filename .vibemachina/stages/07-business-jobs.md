# 07 Законченные деловые задачи вместо набора AI-кнопок
Status: active

Связываем инструменты в самостоятельные полезные работы. Предложение, рекламная кампания, закупка и план команды используют свои исходники и могут быть нужны бизнесу по отдельности.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 07.1 Подготовить предложение, смету и согласованные условия
Status: active
Requirements: R01, R04, R10, R12, R15, R16, R82, R90, R91, R96, R99, R106, R107
Depends on: 03.1, 01.3
Owner: /root/business_assistant
Paths: src/features/commercial/, tests/commercial/, evals/commercial/

Раннее начало J1 после аудита15октября использует принятый artifact/source boundary иfixtures, чтобы04.1/04.2 проверяли настоящий предметный результат. Полная07.1приёмка сохраняет04.2/05.1, точные authoritative calculations, живую модель, варианты ивсе форматы. Текущий estimate/offer builder иsynthetic DB proof — промежуточный результат, не полная коммерческая процедура.

**Контракт и результат.** C1 J1, C8. Request-to-decision procedure extracts requirements, quantities, deliverables, exclusions and deadlines from free text/doc; maps catalog/prices, rules and available capacity with provenance and questions for unresolved terms. Build commercially distinct feasible variants using actual services/items, exact estimate formulas and schedule constraints, not predefined three template answers. Compare margin, completion risk, scope and customer-facing conditions so the owner makes a consequential choice before the assistant creates the editable offer/estimate/plan. Track each request requirement answered/question/excluded-with-reason; amounts include valid discounts/tax only supplied rule. Client names are optional protected imported facts, no customer portal. Quote, estimate and plan share bindings, approval tied to versions.

**Вход в работу и состояния.** Project goal or «Подготовить предложение» in selected materials; result tabs document/estimate/requirements/variants. User edits line quantities/prices/text and explicitly chooses conditions; margin visibility restricted. Missing price prevents fabricated total, still allows working draft/questions. Export to own channel with no external sending automation.

### 07.1.1 Предметная процедура и контроль полноты
Status: active

Live service request with custom constraints creates useful deliverables and meaningful alternatives; golden estimate deterministic. Every requirement traces to source or explicit unanswered item.

### 07.1.2 Ручная доработка и передача
Status: todo

Edit terms and quantity, compare chosen variant, export DOCX/PDF/XLSX with same assumptions; no leaking confidential costs into commercial file. API reopen and another project access denied.

## 07.2 Подготовить связанную кампанию для своих каналов
Status: todo
Requirements: R01, R07, R15, R16, R30, R82, R90, R91, R96, R99
Depends on: 06.3, 04.1, 05.2, 07.4
Owner: SUBAGENT to assign
Paths: src/features/campaigns/, tests/campaigns/, evals/campaigns/

**Контракт и результат.** C1 J2, C8. Campaign procedure goal/audience/product facts/brand/channel constraints optionalbudget -> distinct positioning hypotheses, editable copy, design variants and content calendar. Value claim linked verified fact, audience/response assumption labelled, no defaultdiscount or fabricated testimonials. Approved price/terms referenced from source/finance without leaking costs. Generate language variants as linked separate artifacts; changing ru does not silently overwrite human kk. Campaign quality rubric factual completeness/channel limits/CTA/readability and coherent terms.

**Вход в работу и состояния.** Goal free-form, optional business/context attachment, brief review only for material unknowns. Result overview highlights copy/design/calendar, not agent names. Direct editor opens on selected item; compare directions without mandatory templates, select variants and export complete package. External publication done in business's existing accounts.

### 07.2.1 Содержательные направления и факты
Status: todo

Live different products/service goals produce different necessary materials; invalid claim/discount/source gap rejected by verifier. No fabricated reach/sales guarantees.

### 07.2.2 Пакет к использованию
Status: todo

Text editable, layers editable, calendar entries reusable by08/09; source price change identifies affected items. Multilingual files with channel dimensions/length checks and user creative review.

## 07.3 Сравнить закупку по полной стоимости и срокам
Status: todo
Requirements: R01, R12, R13, R14, R16, R35, R82, R91, R99
Depends on: 05.2, 02.4, 04.1
Owner: SUBAGENT to assign
Paths: src/features/procurement/, tests/procurement/, evals/procurement/

**Контракт и результат.** C1 J3, C9. Procurement request desired quantities/date + supplier sources/stock snapshot optional forecast -> needs bill and comparable offers. Normalize compatible units/pack size/MOQ/waste, delivery/tax/currency explicit source, quantity rounding to packs, leadtime availability as dated evidence not guarantee. Missing delivery/price prevents cheapest ranking; partial offers still show knownsubtotal/gaps. Compare whole-basket vs split supplier with complete costs and constraints, overrides preserved per saved comparison. Output workbook/order draft/checklist, no real supplier purchase.

**Вход в работу и состояния.** Select own supplier documents via search, comparison table with same line order; quantity/date editable, «Сохранить вариант»/export. Conflict/new supplier revision marks old comparison, offers refresh with diff. Phone comparison fixes reference column and permits row detail, not hidden carousel.

### 07.3.1 Полная стоимость и неопределённость
Status: todo

Golden MOQ/pack conversion/mixedcurrency/missingdelivery/ties/partialbasket; update delivery changes rank exactly, unknown never becomes0. AI cannot override domain totals.

### 07.3.2 Сохранённое решение и заказ-черновик
Status: todo

Real import -> query -> comparison -> manual override -> reopen -> XLSX/DOCX export. Supplier update preserves historical decision; no network send/purchase side effect.

## 07.4 Организовать работу команды в редактируемом плане
Status: active
Requirements: R01, R11, R14, R16, R34, R35, R40, R91, R92, R93, R94, R95
Depends on: 03.1, 01.2
Owner: /root/operations_delivery
Paths: src/features/operations/, tests/operations/, evals/operations/, src/app/api/operations/, src/server/db/operations-schema.ts, migrations/0017_operations.sql.draft

Уточнение исполнения15октября: ручной planner/resource/availability путь начинается на принятом03.1 иобщемUI;04.1 остаётся обязательным для финальнойAIпроцедуры иполной07.4приёмки. Это тот же approved сценарий, без изменения объёма. Fresh GPT-5.6 Sol owner получает весь07.4, включая list/calendar/checklist, ресурсы безаккаунта, реальные save/reopen/history иICS/XLSX/PDF adapters. Exact loans: src/app/api/operations/,src/server/db/operations-schema.ts,migrations/0017_operations.sql.draft/final. Shared PlanModel/commands/events/package/rootexports только recovery_inventory; mainartifactroute только journey_delivery; exporterregistry только exports_delivery. Пока текущий интеграционный checkpoint проверяется, новый код готовится в ignored scratch, без изменения общих inputs.

**Контракт и результат.** C1 J4, C7, C9. Plan entries stable IDs/title/description/localdate or UTCrange/resource assignment/dependencies/status/sourceRefs. List/calendar/checklist views, edit/move/duplicate/bulk changes. WorkResource имеет необязательный membershipId: сотрудник без аккаунта тоже включается в рабочий план, доступ к Tirlik при этом не создаётся. AvailabilityVersion хранит интервалы/исключения/effective dates/source; effort отдельно от duration. Проверить доступные часы, отсутствие, суммарную трудоёмкость и пересечения; неизвестная доступность явно unknown, не40 часов по умолчанию. AI derives steps from own instructions and desired outcome; missing duration/assignee remains unassigned assumption, not fake optimization. Plans internal, not authoritative external booking/inventory. ICS stableUID/timezone/sequence, XLSX/PDF via export registration.

**Вход в работу и состояния.** Project -> plan, «Добавить задачу», direct date/owner/status controls and dependencies detail. Выбор ресурса поиском по разрешённым WorkResource; «Доступность» открывает обычные поля рабочих интервалов/исключений с единицами. Invite отдельное действие, не требование назначения. Calendar drag has keyboard/date input equivalent; phone list primary. Show conflicts at affected entry, proposed alternatives not silent movement. Return to linked document/creative; unauthorized resource rejected server-side, scope проверки явно ограничен доступными данными.

### 07.4.1 Модель плана и выполнимость
Status: done

Domain dependencycycle/overlap/weekday/timezone/missingduration, undo and stableID reorder; calendar dates not shifted by UTC conversion. Fixtures: недоступный день, превышение доступных часов, неизвестная доступность, сотрудник без аккаунта,1 час duration с2 человеко-часами effort. Изменение availability version показывает последствия, не переносит задания молча. No false optimality claim.

Принято integration review:31/31 operations unit/export/static,3/3 fresh PostgreSQL+HTTP и6/6 migration history PASS; final0017/schema export review завершён. Account-optional resources, immutable availability, duration/effort/quantity, DST/effective ranges, manual/source/missing provenance, conflicts/unknown, save/reopen/undo и assistant DTO подтверждены.07.4.2 остаётся active до пользовательской date/mobile/file проверки.

### 07.4.2 Рабочий план и календарные файлы
Status: todo

Real save/reopen/assign/revise, ICS parse UID TZ sequence and repeated import semantics documented; exports match revision. User checks mobile/date interaction and handoff.

