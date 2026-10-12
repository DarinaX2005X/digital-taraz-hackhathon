# 03 Первое реальное агентное действие на своих данных
Status: todo

Ранний интеграционный рубеж: файл или ручной ресурс -> свободная цель -> настоящий AI tool loop -> проверяемый сохранённый черновик. Это не конец продукта, а доказательство наиболее рискованного пути.

## 03.1 Сохранять и возобновлять настоящий AI-run
Status: todo
Requirements: R14, R15, R17, R25, R39, R42, R43, R56, R79, R83, R85, R86, R87, R88
Depends on: 02.1, 02.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/agent-runtime/, src/server/ai/, src/workflows/, src/server/db/schema/agent.ts, src/app/api/internal/jobs/, tests/agent-runtime/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/runs/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Реализовать C6 через Workflow SDK и PostgreSQL run/step/outbox receipts. Внешняя модель только OpenRouter server adapter, supported tool+structured output+vision capabilities проверяются настоящим минимальным вызовом до обещаний. Пользователь вводит ключ в env, не чат; отсутствие ключа возвращает setup_required, ручной путь жив. Модель и бюджет конфигурируемы, никакого hardcoded ответного сценария.

RunCreate {objective,contextRefs,locale,limits,clientRequestId} -> persisted runId/status. Side effects внутри durable step через domain service, unique execution receipt; provider output сохраняется и повторно используется, когда он получен. Outbox commit/start gap, duplicate workflow starts, cancellation epoch/fence, resume, waiting_input/approval и stop budget по C5-C6. Перед write повторно проверить actor membership, state/hash и current policy. Step errors разделяют retryable/rate/invalid/permission; необратимое действие не «отменяется» кнопкой cancel.

Event API seq/cursor с bounded SSE/polling, auth на подписку, reconnect возвращает недоставленные события; log redaction, provider cost unknown честно null. Workflow payload только ID, минимальные чувствительные данные в защищённом DB, не giant prompt в observability. Reconciliation periodic durable task плюс API retry, без вкладки. Закрепить SDK version/deploy contract, нельзя полагаться на неограниченную serverless request.

Приёмка: live provider schema/tool/vision smoke, DB assertions; restart local, duplicate dispatch, killed-after-write-before-receipt, cancelled-awaiting-provider, revoked role,429 и missingkey. В Vercel preview 03.3 проверить resume без открытого клиента. Платные лимиты не повышать без разрешения.

### 03.1.1 Настоящий провайдер и типизированная ошибка
Status: todo

Adapter, capability probe, token/usage accounting, no-key/429/invalid schema. Реальный trace отличается от fixture mock и не содержит secrets.

### 03.1.2 Durable loop и защитные условия
Status: todo

Workflow steps/outbox/receipts/fences/limits, cancel/resume/retry; crash fault-injection и PostgreSQL checks, отсутствие повторного side effect.

### 03.1.3 Поток событий и фоновое восстановление
Status: todo

Cursor transport, reconnect, auth, reconciliation без клиента; restart smoke и production feasibility перед handoff.

## 03.2 Решать свободную бизнес-задачу предметными инструментами
Status: todo
Requirements: R03, R04, R05, R10, R14, R15, R16, R20, R82, R83, R84, R86, R87, R88
Depends on: 03.1, 02.4
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/agent-planning/, src/features/proposals/domain/, src/server/db/schema/proposals.ts, tests/agent-planning/, tests/ai-evals/

Контекст строится по выбранным источникам/подтверждённым facts/resources/revisions, а не всему workspace dump. Оркестратор под цель выбирает действия/профиль разбора, планирования и проверки, не фиксированную цепочку или число вариантов. Реестр tools из C6 включает exact simulation/resource reads и versioned draft artifact; publish_approved пока registered unavailable до 05.1, никогда success stub.

Result ProposalVersion имеет title, audience as assumption/evidence, recipe, price, terms, constraints, locks, expected operations, evidence refs, unknowns, validation report и next action. Числа из simulate tool, ссылки разрешаются в существующий source locator; model generated invalid ids отклоняются. Запрос критического missing input хранится объектом с причиной, допускает свободный ответ/файл и продолжение. Optional suggestions не закрытое меню. Unneeded вопрос не блокирует draft.

Изменение цели/факта/lock создаёт новую версию и replan на актуальных данных. Передача ролей только при пользе, журнал actual tools/деловой summary без chain-of-thought. Безопасность prompt injection, HTML sanitation, no shell/network/tools вне registry. Не совершать unsupported actions, но сохранять полезный подготовленный материал.

Приёмка benchmark corpus 01.3: разные цели при одинаковом источнике, новая отрасль без enum, неполные затраты, locked price, malformed evidence, unavailable capacity, multilingual free text. Автоматические checks ловят invalid artifacts/evidence/unsafe effects; живые evals записывают usage/модель и оцениваются rubric. Свободная форма результата проверяется по пользе, а не exact golden wording.

### 03.2.1 Предметные инструменты и артефакт
Status: todo

Реестр scopes/schema/receipt и proposal storage, facts retrieval, exact calculation handoff; mocked unit tests contracts, не объявлять их live AI.

### 03.2.2 Адаптивное планирование и уточнение
Status: todo

Orchestrator policies/context budget, locks, alternatives/comparison, respond-and-resume на новой версии; goals не сводятся к комплектам/скидкам.

### 03.2.3 Живая оценка на непривычных целях
Status: todo

Live evals из разных resource models, injection/unknown/locked constraints. Любая invented source или unsafe write блокирует checkpoint.

## 03.3 Дать ранний рабочий экран и проверить живой путь
Status: todo
Requirements: R08, R10, R16, R25, R29, R30, R31, R32, R33, R34, R38, R39, R40, R44, R45, R56, R60, R79, R84, R85, R87, R88
Depends on: 03.2, 01.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/workbench/, tests/workbench/, scripts/smoke/first-value.mjs, vercel.json

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/opportunities/, src/app/[locale]/app/work/, src/app/api/v1/workspaces/[workspaceId]/goals/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Прочитать DESIGN+foundation+ux+anti-slop. /app/opportunities empty показывает свободную цель, «Добавить файл» и ручной ресурс; /app/work/[goalId] primary object proposal, next action и selected source panel. Первая форма не требует весь каталог/отрасль/команду. Minimal source correction использует 02.2 APIs; полноценная библиотека далее04.1. Server saves goal/input/artifact и reopen.

Показывать actual run state/events, clarification field, сохраняемый composer с attachments, cancel/retry/resume, источники и вычисленные показатели. Conversation дополняет объект, не скрывает результат за chat wall. При incomplete facts черновик остаётся, publish ещё не доступен честно до05.1; без ключа setup error, не учебный ответ вместо реального. Every state и все ru/kk/en; mobile single primary pane, source overlay, translations preserve text/attachments.

HTTP smoke на отдельном workspace: own sample file -> extraction -> correction -> goal -> live tool call -> persisted proposal with resource/price/evidence -> server restart/reopen and edit. MAIN запускает local dev и передаёт user URL/first-session checklist. По доступам выполнить ранний Vercel preview с DB/Blob/Workflow, reconnect/cancel/resume без клиента; это preview, не final delivery. Зафиксировать deployment limits early.

Приёмка: API/domain assertion первого результата + реальные live traces, permission leakage tests, no unwanted demo records. Пользователь проверяет first five minutes, понятность и mobile/visual; feedback в TESTING, не автоматизировать.

### 03.3.1 Своя задача, материалы и сохранённый результат
Status: todo

Связать auth/upload/goal/run/artifact в UI, все load/partial/error/waiting states, source correction и возврат по URL.

### 03.3.2 Сквозной live smoke и preview
Status: todo

Запустить настоящий путь и Vercel durable/persistence smoke при доступах, записать latency/usage без обещанного SLA; отсутствие сервисов явно blocker, не mock completion.

### 03.3.3 Ранняя пользовательская проверка
Status: todo

Выдать ссылки и короткие цели проверки, принять/исправить сообщения TESTING в owned paths; visual acceptance только от пользователя, остальные части продолжаются по графу.
