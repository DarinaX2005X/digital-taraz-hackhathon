# 04 Настоящая агентная работа с управляемым результатом
Status: todo

Проверяем полный путь на реальной модели: исходный материал, выбранные инструменты, сохранённый результат, ручная правка и экспорт. Это ранняя проверка механизма, не конец разработки.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 04.1 Выбирать инструменты под свободную деловую задачу
Status: todo
Requirements: R03, R04, R05, R14, R15, R16, R83, R84, R96, R100
Depends on: 02.2, 02.4, 03.3
Owner: SUBAGENT to assign
Paths: src/features/agent-tools/, tests/agent-tools/, evals/agent-tools/

**Контракт и результат.** C1, C3-C5, C8. Context builder ACL-scoped retrieval+structured queries with token budget, explicit coverage/sample/unknown labels. Planner creates short editable work plan, dynamic profiles contextreader/analyst/writer/designer/verifier, depth<=2; simple job skips needless roles. Tools typed source read/query/map, artifact create/read/propose patch, exact calculations through services, no arbitrary code/SQL/network. Capability registry includes input/output schema, permissions, procedure, quality checks, evidence. Goal changes supersede active plan safely; ambiguity about material value pauses only affected branch, optional info uses labelled assumption.

**Вход в работу и состояния.** Free-form goal with attached sources and optional constraints; AI panel shows plan and concrete question when blocked, not fixed answer buttons. User may edit goal/plan, answer freely, inspect sources, lock result and accept changes. Prompt injection in files stays data; schema-valid hallucinated facts still fail source/numeric validation.

### 04.1.1 Контекст и предметные процедуры
Status: todo

Prompts per job include source precedence, units, unknowns, locks, selection criteria; tools validate tenant/permissions and cannot claim external action. Tests malicious source/inaccessible fragment/oversized context.

### 04.1.2 Адаптивный цикл с реальными результатами
Status: todo

Live novel goal, incomplete input and changed constraint: different necessary tool paths, real typed artifact and verifier findings. Eval rubric measures completeness/factuality/editability, not number of agents.

## 04.2 Доказать первый полезный путь от своего файла до результата
Status: todo
Requirements: R08, R10, R15, R56, R76, R83, R90, R99
Depends on: 04.1, 03.4, 03.2, 01.3
Owner: SUBAGENT to assign
Paths: tests/early-journey/, evals/early-journey/

**Контракт и результат.** C1 J1, C13. On actual source service upload service company's request+price table, free-form goal prepare substantive response with unknown lead time, actual OpenRouter/tool loop creates persisted document and requirement/evidence list. Direct human Command changes paragraph, undo/redo, close/reopen new session, DOCX/PDF export, new source version marks stale fields not silently rewrite. MAIN wires served routes to real feature handlers; worker tests via HTTP/API, not an isolated mock success.

**Вход в работу и состояния.** User gets local/preview address and concise trial: own file -> goal -> source check -> direct edit -> download -> return. Time target five minutes only small ready input; actual human timing unknown until user trial. No auto browser and no product-complete claim.

### 04.2.1 Первый настоящий результат
Status: todo

Capture fixture IDs, model/tool/usage receipts, DB versions and parsed output expected requirements/conditions. Missing fact stays named, no invented price/lead time.

### 04.2.2 Правка, возврат и новая исходная версия
Status: todo

API journey preserves manual content through reopen/export and subsequent source update. Read TESTING, repair verified wiring via MAIN loans, hand user exact route; remaining UI check explicit.

