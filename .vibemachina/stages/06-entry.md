# 06 Понятный публичный вход, изолированный пример и помощь
Status: todo

Полный сайт объясняет работу Tirlik, даёт попробовать механизм и переводит к своим данным без навязанного переноса примеров. Выполнение 06.1 допускается параллельно 04/05 после раннего live-пути.

## 06.1 Показать продукт и его механизм на публичном сайте
Status: todo
Requirements: R01, R02, R03, R04, R07, R08, R09, R19, R21, R28, R30, R32, R40, R41, R44, R46, R47, R48, R49, R64, R87, R88
Depends on: 03.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/marketing/, src/app/not-found.tsx, public/art/, tests/marketing/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/page.tsx, src/app/[locale]/about/, src/app/[locale]/privacy/, src/app/[locale]/not-found.tsx. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

DESIGN и foundation/ux/anti-slop/art. Landing first viewport Tirlik + audience/literal purpose, prominent «Начать со своих данных», «Открыть пример», actual subject bitmap, no split-card/gradienthero. Не выводить приложение внутри hero. Создать оригинальный bitmap через imagegen skill при необходимости или лицензированный реальный asset с manifest, не фабриковать компанию/клиента/скриншот. Next band виден на desktop/narrow, стабильные размеры images.

Bands: проблема входа -> связь ресурсов/предложения/заказа на синтетическом примере -> что загрузить -> реальные ограничения/данные/privacy -> CTA. Useful footer public docs/about/help/repo/contact only actual. Нет pricing, fake testimonials, “аналогов нет”, invented effect. Встроенный playable video позже11.4, до него не пустой broken player.

About содержит региональную задачу и происхождение решения без присвоения организаторам дополнительных правил; privacy честно объясняет передачу выбранных материалов OpenRouter, hosted storage и контактов бизнесу, не обещает legal compliance certification. Public metadata/og/favicon/lang, readable ru/kk/en. Product/name first viewport, no docs-like wall instead of interface.

HTTP проверки route status, canonical/hreflang, unknown nested routes actual404, auth-aware CTA safeintent. Static a11y/locale/assetlicense checks. Проверку изображения, композиции, folding и mobile пользователь выполняет сам.

### 06.1.1 Смысл, фирменный визуал и страницы
Status: todo

Точные public copy и оригинальные assets, source/licence/alt, all locales; без неподтверждённых обещаний.

### 06.1.2 Публичная навигация и доступный вход
Status: todo

Hero/bands/CTA/footer/about/privacy/404, server statuses и sameintent; user visual checklist с реальными URL.

## 06.2 Дать изолированное демо и явный перенос учебных данных
Status: todo
Requirements: R08, R21, R25, R26, R27, R29, R30, R39, R40, R43, R44, R75, R87, R88
Depends on: 05.4, 01.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/demo/, src/server/db/schema/demo.ts, src/app/api/demo/, tests/demo/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/demo/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Демо использует fixtures01.3 и те же domain services в sandbox scope, не отдельную фальшивую арифметику. Старт просмотра не создаёт Membership/workspace/realorder посетителю. Demo session random id+TTL, tenant isolation, deterministic initial snapshot, reset creates clean sandbox; no public publish/real mail/payment or contact PII. Данные явно учебные на каждом relevant result/export.

Три исходные модели демонстрируют общий механизм, но не отраслевое меню реального продукта. Recorded walkthrough labelled recorded; interactive changes действительно пересчитываются domain engine. Live AI запускается отдельным явным действием с маленьким rate/budget по C6, no key/outage сообщает unavailable, не подставляет canned text как live. Demo SSR never exposes secrets/budget controls.

«Перенести пример в мой бизнес» -> auth safe intent -> выбор сущностей/preview -> confirm copy idempotent; копируются разрешённые synthetic items/resources/facts, не active published offers/orders/historypayments/customercontacts. Можно отменить до записи, личные существующие данные не затираются. Source lineage помечена copied synthetic. Demo UI model с теми же feature components и локализацией, write wrapper enforce sandbox.

Приёмка count personal tables before/after view/replay/tour/login=false, cross-session API isolation, replay copy once, cancel copy zero, sandbox TTL cleanup, rate limit abusive AI. User проверяет ясную границу sample/own и переход после регистрации.

### 06.2.1 Sandbox и честное интерактивное прохождение
Status: todo

Fixtures scope, no external effects, UI и real recalculation, recorded/live distinction, tests no personal records.

### 06.2.2 Управляемый перенос и сброс
Status: todo

Preview selected copy/auth intent/idempotency, no active orders/publications, reset/TTL/isolation tests и user flow.

## 06.3 Провести первый сеанс и оставить понятную помощь
Status: todo
Requirements: R08, R20, R22, R24, R29, R30, R31, R32, R33, R34, R39, R40, R44, R45, R87, R88
Depends on: 04.1, 04.2, 05.3, 06.1, 06.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/guidance/, tests/guidance/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/help/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Contextual skippable tour под текущую роль и объект: add source/resource -> inspect/correct -> goal -> validate -> publish -> orders. Прогресс user preference server profile, viewing step не создаёт бизнес-данные, replay from help. Не заставлять пройти все шаги или настроить команду/расписание, когда задача только о товарах. Highlight/anchor tooltips прикреплены к реально видимым controls, no invisible step traps; narrow overlay не прячет primary action.

Help explains business consequences и recovery: incomplete cost, unavailable slot, old source, AI failed/cancelled, resendemail, restore session, difference demo/private/customer. Не visible text о CSS/keyboardshortcuts/design features. Natural questions can lead specific help subsection or existing work context; не имитировать бесконечно компетентного support bot.

First-session continuity: public CTA->signin->intended object/upload draft, expired session returns without silent discard, locale change preserves incomplete goal and selected files supported by stored upload refs. Unsaved prompt for true navigation losses. No overlapping onboarding/approval modals; one focus-owning layer.

Acceptance API preference persistence/no-unwanted-records, unit anchor/routing/locale tests. User timed session own smallfile/newmanualresource, step skip/replay, three roles and touch. Record actual friction and refine owning components via MAIN loans, not accept five-minute target from stopwatch-free assumption.

### 06.3.1 Контекстный ввод в работу
Status: todo

Role/object-aware steps, skip/replay/progress and zero-business-write tests, no all-at-once panels.

### 06.3.2 Помощь и непрерывность сеанса
Status: todo

Recovery articles/link routing, safe return and unsaved behavior, all locales; collect user first-session findings and repair boundaries.
