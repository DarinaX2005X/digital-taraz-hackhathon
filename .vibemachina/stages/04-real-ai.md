# 04 Настоящая агентная работа с управляемым результатом
Status: active

Проверяем полный путь на реальной модели: исходный материал, выбранные инструменты, сохранённый результат, ручная правка и экспорт. Это ранняя проверка механизма, не конец разработки.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 04.1 Выбирать инструменты под свободную деловую задачу
Status: active
Requirements: R03, R04, R05, R14, R15, R16, R83, R84, R96, R100, R106, R107
Depends on: 02.1, 03.1
Owner: /root/business_assistant
Paths: src/features/agent-tools/, tests/agent-tools/, evals/agent-tools/

Фактический аудит2026-10-15: существующий02.2 runtime имеет только test synthetic и private model-proof registrations; они не исполняют цель бизнеса и не создают пользовательские artifacts. Успешный proofMiMo2.6 не закрывает04.1. Следующий feature owner должен поставить настоящую public capability свободной задачи с source retrieval/provenance, typed tools и сохранёнными artifact refs. UI запуск монтирует workspace owner по одному согласованному DTO, не новая форма internal capabilities. Реестр runtime/эффекты/ledger переиспользуются. Подготовка начинается на принятых interfaces02.2/03.1/02.3, пока03.3/02.4 монтируются; окончательное принятие04.1 требует всех указанных зависимостей. Первым рабочим предметным путём является J1 из нового PROJECT, остальные предметные capabilities подключаются по плану. Никакого скрытого canned result или автоматического вызова модели при входе.

**Контракт и результат.** C1, C3-C5, C8. Context builder ACL-scoped retrieval+structured queries with token budget, explicit coverage/sample/unknown labels. Planner creates short editable work plan, dynamic profiles contextreader/analyst/writer/designer/verifier, depth<=2; simple job skips needless roles. Tools typed source read/query/map, artifact create/read/propose patch, exact calculations through services, no arbitrary code/SQL/network. Capability registry includes input/output schema, permissions, procedure, quality checks, evidence. Goal changes supersede active plan safely; ambiguity about material value pauses only affected branch, optional info uses labelled assumption.

**Вход в работу и состояния.** Free-form goal with attached sources and optional constraints is the primary work entry. Assistant surface shows editable plan, concrete question when blocked, actual operation receipts and live result components, not fixed answer buttons or a secondary hidden panel. User may edit goal/plan, answer freely, inspect sources, open and change the result, lock it and accept changes. A conversational answer without a verified operation or usable artifact does not complete the task. Prompt injection in files stays data; schema-valid hallucinated facts still fail source/numeric validation.

### 04.1.1 Контекст и предметные процедуры
Status: done

15октября public business.goal иtyped source/query/calculation/artifact tools перенесены;33focused tests+lint иsynthetic runtime/business DB scenarios PASS. Настоящий workspace запуск использует selected pinned sources иатомарный editable estimate/offer result. Это synthetic proof; первыйliveJ1 требует исправления server calculation authority иобщей интеграционной приёмки. Следующийscratch пакет включает адреснуюAIправку документа с before/after review, stable selection/revision иsame-key recovery.

Prompts per job include source precedence, units, unknowns, locks, selection criteria; tools validate tenant/permissions and cannot claim external action. Tests malicious source/inaccessible fragment/oversized context.

Принято: versioned `business-assistant-v1` procedure содержит source precedence, ordered tools, conditional branches, invariants, permissions, unknowns, recovery и completion contract. Decision `can/can-with-conditions/cannot-confirm`, material context, canonical human selection/condition consent, three-artifact atomic bundle и finite RU/KK/EN reason mapping прошли26/26 unit/eval,4/4 J1 PostgreSQL и3/3 production operations adapter.04.1.2 остаётся active до bounded live tool loop.

### 04.1.2 Адаптивный цикл с реальными результатами
Status: active

Live novel goal, incomplete input and changed constraint: different necessary tool paths, real typed artifact and verifier findings. Eval rubric measures completeness/factuality/editability, not number of agents.

## 04.2 Доказать первый полезный путь от своего файла до результата
Status: todo
Requirements: R08, R10, R15, R56, R76, R83, R90, R99, R106, R107
Depends on: 04.1, 03.4, 03.2, 01.3
Owner: SUBAGENT to assign
Paths: tests/early-journey/, evals/early-journey/

**Контракт и результат.** C1 J1, C13. On actual source service upload request, price table and team availability, free-form goal asks whether the work can be done by the required date without an unprofitable price. A real OpenRouter/tool loop visibly plans the work, identifies only material unknowns, runs exact commercial and capacity checks, compares meaningful options and creates persisted estimate, proposal and plan components. The user selects a trade-off, directly edits terms, closes/reopens the session and exports fixed versions. A new source or constraint reruns only affected checks and produces reviewable changes. MAIN wires served routes to real feature handlers; worker tests via HTTP/API, not an isolated mock success.

**Вход в работу и состояния.** User gets local/preview address and concise trial: own file -> goal -> source check -> direct edit -> download -> return. Time target five minutes only small ready input; actual human timing unknown until user trial. No auto browser and no product-complete claim.

### 04.2.1 Первый настоящий результат
Status: todo

Capture fixture IDs, model/tool/usage receipts, DB versions and parsed output expected requirements/conditions. Missing fact stays named, no invented price/lead time.

### 04.2.2 Правка, возврат и новая исходная версия
Status: todo

API journey preserves manual content through reopen/export and subsequent source update. Read TESTING, repair verified wiring via MAIN loans, hand user exact route; remaining UI check explicit.

