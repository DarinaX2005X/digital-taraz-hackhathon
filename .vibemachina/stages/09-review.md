# 09 Независимое ревью кода и сверка с исходным брифом
Status: todo

Свежий reviewer сначала видит исходный запрос и реализацию, затем план. Подтверждённые дефекты исправляются и перепроверяются до README и финальной поставки.

## 09.1 Независимо проверить исходное обещание и реализацию
Status: todo
Requirements: R02, R03, R04, R05, R06, R10, R14, R15, R17, R21, R44, R50, R57, R60, R82, R83, R84, R85, R86, R87
Depends on: 08.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: none

READ-ONLY независимый SUBAGENT с fresh context/fork none. First pass packet: полное исходное BRIEF (включая последующие user additions), repo files, actual start/checkcommands, запрет UIautomation. Не давать PROJECT/PLAN/REQUIREMENTS/DESIGN/STATE/MAIN rationale до первого отчёта. Не назначать reviewer canonicalfiles, Git или product edits. Просьба: конкретные missingoutcomes/bugs/security/regressions, file:line+repro/impact, не общая похвала.

Проверить wholeuserjourney, фактическую агентность/instrumentation/grounding, novelobjective vs canned templates, rights/atomicity/cost/modelallowlist/privacy, states/locales/account/demo/restore. Допустимы static/unit/API/domain; не screenshot/browser. Firstpass result MAIN сохраняет в существующем stage/TESTING.

Second pass тому же reviewer после первого: PROJECT contracts, DESIGN+foundation+ux+anti-slop, PLAN stages, REQUIREMENTS/evidence. Сверить заявленные контракты с кодом и tests, missing edge cases, migrations/runtime/deploy constraints. Не требовать отдельного review report artifact ради учёта. Критичность основана на пользовательском вреде/обещании, не вкусе reviewer.

### 09.1.1 Слепое чтение брифа и кода
Status: todo

Получить findings до выдачи плановых интерпретаций; MAIN фиксирует точный scope, severity и evidence в существующих файлах.

### 09.1.2 Контрактное ревью и тестовые пробелы
Status: todo

Передать план/дизайн послеfirstpass, собрать конкретные расхождения и regression cases; отделить user-only visual неизвестное от доказанного дефекта.

## 09.2 Устранить подтверждённые дефекты ревью
Status: todo
Requirements: R06, R14, R15, R25, R39, R42, R43, R44, R50, R57, R59, R60, R87, R88
Depends on: 09.1
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/, tests/, scripts/, public/, package.json, pnpm-lock.yaml, compose.yaml, next.config.ts, vercel.json

MAIN triages findings из09.1 по evidence и назначает narrow subscopes одному worker последовательно либо отдельные bounded repairs с обновлёнными ownership contracts. Все writers передcheckpoint handedover. Нельзя менять концепцию/снимать требование или force-revert чужие правки ради cleanreview.

Для каждогоconfirmed defect сначала reproducible failing test там где возможно, затем минимальное исправление причины с migrations/backcompat если нужно. Missingcapability возвращается implementation task, не hidden knownlimitation. Security/tenant/reservation/AI permissions regressions проходят dedicated suite, UX issue пользователь подтверждает. Если изменение пересекает thirdparty runtime или hosting новаяactualcheck обязательна.

Evidence: finding->codechange->test->repeatoriginalrepro->regression, model guard/cost proof from currentruntime not previous green. Main updates existingaccepted checkpoints only after verification, frequent scopedcodecommits no BRIEF/TESTING/runtime/secrets.

### 09.2.1 Исправить причины и закрепить тестами
Status: todo

Confirmed findings repair in explicit owned paths, preserve all original/userfiles; migrations and regression coverage по blast radius.

### 09.2.2 Проверить изменённый полный цикл
Status: todo

Повторить affected APIs и wholejourney, pass security/concurrency/cost checks, visual fixes return to user; no unfixed critical omissions.

## 09.3 Подтвердить стабильную версию для документации и демо
Status: todo
Requirements: R06, R50, R57, R60, R62, R67, R87
Depends on: 09.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: none

Read-only verification worker повторяет reproduction repairedfindings и commands, checks complete integration path. MAIN читает TESTING и REQUIREMENTS, сопоставляет actual evidence, unresolved scope/security/blockers vs uservisual pending. Ни100%dashboard ни всеworkerfinished не доказательствоcomplete.

Выход: stable commit/revision, tested commands/results, applicable visualnotes, actualfeatureboundary, вход для10README и11media. No external publication yet if servicesmissing. При failed gate не переходить к утверждению «готовый продукт», создать нужный repaircheckpoint в existingstage. UI/browser запрет сохраняется.

### 09.3.1 Повторная проверка стабильного состояния
Status: todo

Targeted repairedrepros + full checks, artifact/DB persistence and no falseclaims; MAIN фиксирует stable revision и оставшиеся реальные условия.
