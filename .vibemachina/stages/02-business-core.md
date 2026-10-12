# 02 Собственные данные, права и проверяемая доступность
Status: todo

Изолированное пространство принимает реальные материалы и превращает их в корректируемые факты. Общий ресурсный движок становится единственным источником обещаний и расчётов.

## 02.1 Открыть личное пространство и полный жизненный цикл аккаунта
Status: todo
Requirements: R11, R21, R22, R23, R24, R25, R34, R39, R40, R43, R44, R45, R87, R88
Depends on: 01.1, 01.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/identity/, src/server/auth/, src/server/mail/, src/server/db/schema/identity.ts, src/app/api/auth/, tests/identity/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/(auth)/, src/app/[locale]/app/layout.tsx. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Использовать Better Auth email/password+DB session, не собственную криптографию. C7 roles owner/manager/staff, workspace membership и server context доступны другим features через contract. Signup создаёт один личный workspace по завершении явной регистрации, session refresh восстанавливает намерение same-origin; demo view этого не делает. Last owner guard, session invalidation после password reset, rate limiting в DB.

Реализовать /sign-up, /sign-in, /reset-password, /verify-email: labels, password reveal icon, busy/result/error, сохранение email/return intent, no enumeration при reset. Password policy minimum 12 characters, paste/password managers разрешены, maximum128; validation до server. Первый черновик доступен до подтверждения почты, публикация только после него. SMTP delivery awaited/retry idempotent, Mailpit local, production actual mailbox smoke позже; «отправлено» только после provider acceptance.

Private layout выполняет server redirect/permission; public страницы остаются доступны вошедшему. Profile menu использует общий shell, logout очищает private Query cache и сессию, auth errors не ломают страницу. Формы и emails ru/kk/en, mobile keyboard autocomplete и focus.

Приёмка HTTP: register/login/reload/logout/relogin/reset/verify; два workspace, revoked membership, forbidden resource и malicious return URL. Ни password hash, ни session token не возвращаются в JSON/logs. Unit/real DB/API checks плюс пользовательская проверка форм.

### 02.1.1 Аккаунт, роли и сессия
Status: todo

DB schema/auth handler/permissions, тесты cross-tenant и last-owner. Зарегистрировать через API, перезапустить сервер, подтвердить session persistence.

### 02.1.2 Письма и восстановление
Status: todo

SMTP/Mailpit, verify/reset token expiry/reuse/revoke и rate limits. Проверить реальное письмо через Mailpit API, не по console log.

### 02.1.3 Вход и возвращение
Status: todo

Полные три языка auth routes/menu states и safe intent; API проверки, передать пользователю URL и ожидаемый цикл без открытия вкладки.

## 02.2 Принять документы и сохранить исправляемые факты с источниками
Status: todo
Requirements: R10, R14, R16, R17, R25, R34, R35, R39, R42, R43, R44, R75, R76, R87, R88
Depends on: 02.1, 01.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/sources/, src/server/storage/, src/server/db/schema/sources.ts, tests/sources/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/sources/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

PROJECT C3 file formats/limits. Сначала private upload session (auth+workspace+objectKey+limit), finalize проверяет ownership/hash/MIME/magic/actual bytes. Client direct private Blob и explicit local-files adapter; хранить objectKey, не transient signed URL. Owner/manager может открыть источник через authorized read; staff и public нет. Удаление/cleanup не удаляет shared blob чужого workspace.

Extraction pipeline chunked parse text/table/PDF; rasterize только страницы исходного документа при необходимости OCR, не приложение. Vision provider interface реализует 03.1. Office formulas/macros не выполняются, zip/image bombs и encrypted/corrupt documents дают actionable error. Результат ImportBatch row/cell/page locators + proposed facts + uncertainties, не автоматический overwrite. 15MiB/20pages/5000rows limit сообщение сообщает найденный объём.

Commit выбранных строк выполняется атомарными batches с version/dedup strategy: обновить по подтверждённому identity или создать новый, ambiguous match требует выбора. Противоречивые единицы, unknown costs, несколько price columns не додумывать. Исходный файл/исправления/извлечённая версия сохраняются; partial batch виден и повтор не дублирует applied rows. AI не получает secret/meta инструкции файла.

Приёмка parser fixtures+real DB/private storage adapter: upload->extract->correct->commit->reopen->reimport; чужие objectKey, overwritten file, interrupted transfer, invalid XLSX/PDF, duplicate requests. UI preview будет в 04.1, но ранний API/минимальный source panel используется 03.3.

### 02.2.1 Приватная загрузка и жизненный цикл файла
Status: todo

Storage adapter/direct upload token/finalize, limits и read authorization; HTTP byte checks, persistence и cleanup reconciliation.

### 02.2.2 Извлечение с точными ссылками
Status: todo

Parsers/vision interface, normalized schema и partial errors; fixture-based proof по каждому формату с сохранением raw value.

### 02.2.3 Подтверждение и повторный импорт
Status: todo

Versioned commit/mapping/correction/dedup, tests неоднозначного обновления и failed chunk resume; схема handoff 04.1.

## 02.3 Учитывать товары, время и общие ресурсы атомарно
Status: todo
Requirements: R01, R04, R10, R11, R12, R18, R25, R35, R38, R39, R42, R82, R83, R87, R88
Depends on: 02.1, 01.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/resources/, src/server/db/schema/resources.ts, tests/resources/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/resources/, src/app/api/v1/workspaces/[workspaceId]/items/, src/app/api/v1/workspaces/[workspaceId]/availability/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

C3-C5 authoritative Item/Resource/Cost/Recipe/Availability/Reservation primitives. Ресурс физический или временной с ёмкостью; услуги описывают связанные ресурсы, duration/buffers/recurrence/exceptions. Unit registry и явно подтверждённые conversions, no negative stock/zero denominator; использованный ресурс archive, не hard-delete. Редактирование versioned, конфликт сохраняет submitted draft.

Реализовать queryAvailability(demands,timeRange), simulateCapacity, reserve(command,txn), release, consume, restock и exchangeReservations; методы принимают авторизованный actor/cause/reference, не публичный model input. Reservation API для общей domain service, не отдельный unauthenticated endpoint. Sorted row locks + transactional overlap/capacity check + event receipt. Temporal booking использует Luxon/rrule, exact [start,end), shared room/staff simultaneously; никакой ручной Date arithmetic для DST. Person-resource имеет optional same-workspace membershipId с unique canonical mapping; coordinator assignment отделён от фактического resource. Exchange старого/нового специалиста и связанных ресурсов атомарен: при конфликте/сбое прежний резерв не теряется, при success заменяется один раз. Тесты двух параллельных exchange и duplicate membership resource обязательны.

Pooled и allocated policies из C4; reserve учитывает quota, release идемпотентен. Проверить отдельно смешанный режим: резервы внутри квоты не вычитаются из общего pool второй раз; consume уменьшает и остаток, и соответствующую квоту. TTL по DB clock, ledger audit; editing onHand below held commitments flags conflict и запрещает новые promises. Удаление/изменение расписания не теряет действующие брони. Results показывают bottleneck/available/constraint IDs для AI и UI.

Приёмка с настоящим PostgreSQL: >=20 конкурентных attempts на последний физический item, пересекающийся staff/room, capacity>1, разные resource ordering; exactly one successful последняя единица, no deadlock/retry loss. Cancel/expire/retry/consume/restock сохраняют accounting identity. Test near timezone date boundary/DST даже если default KZ.

### 02.3.1 Модель ёмкости и календаря
Status: todo

Schema, units/recipes, recurrence/exceptions и finite availability query. Oracle cases товаров, услуг и mixed case.

### 02.3.2 Конкурентное резервирование
Status: todo

Atomic reserve/release/consume/restock + receipts, реальные connections race tests и duplicate payload checks.

### 02.3.3 Изменения при живых обязательствах
Status: todo

Version conflicts, below-reserved inventory, edited calendar, allocation mode; API returns actionable conflicts и затронутые offers, не silent loss.

## 02.4 Рассчитать выполнимость и сравнить экономику без выдуманных доходов
Status: todo
Requirements: R01, R04, R12, R13, R14, R16, R38, R43, R82, R84, R87, R88
Depends on: 02.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/simulation/, tests/simulation/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/simulations/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

C4 расчёт принимает recipe IDs/revisions, prices/quantities, selected scenario volumes, cost rules и field locks. Общий exact engine вызывают UI и агент; результат computed values/evidence dependency hash/bottlenecks/unknown components. Money uses integer minor units, decimal.js intermediate with documented rounding per line then total. Unsupported unit/currency produces blocking validation, not guessed conversion.

Дать single proposal и joint scenario check. Поиск агентом не равен доказанной оптимизации: не писать «максимальная прибыль», если точный движок лишь проверил выбранное решение. Known variable contribution не net profit. При unknown cost outcome null и disclosure completeness, число0 допустимо только как явно введённая нулевая стоимость. Discounts fixed/percent и capacity changes переоценивают затронутые цели.

У пользовательского «не снижать цену» lock enforcement на server: LLM request violating lock возвращает typed conflict. Approved locked fields и resource hashes входят в result. Проверка не резервирует реальные ресурсы, не создаёт заказ, не меняет остаток. Результат сохраняем через proposal версию в 04.2; сейчас сервис pure/read-only плюс audit of simulation requests.

Приёмка exact oracle 95000/36000 KZT и impossible 16ламп при10, mixed time demand, tax unknown, decimal units, rounding, negative/overflow, fresh/stale hashes. Property tests monotonic capacity and no double-count scenario totals; returned field explanations совпадают с formulas.

### 02.4.1 Проверяемая арифметика
Status: todo

Стоимость/цена/contribution/completeness/rounding и currencies; unit+property tests включая missing cost !=0.

### 02.4.2 Совместная выполнимость
Status: todo

Проверить несколько вариантов одновременно, bottlenecks, locks и hash freshness. Oracle cases+HTTP schema tests, передать stable tool result в 03.2.
