# 08 Полный цикл, сбои и пользовательская проверка
Status: todo

Проверяем связанное поведение целиком, нагрузку и восстановление. UI проверяет пользователь; агенты отвечают за код, домен, HTTP/API и исправления полученных замечаний.

## 08.1 Проверить весь путь владельца, сотрудника и клиента
Status: todo
Requirements: R01, R06, R10, R11, R12, R13, R21, R22, R23, R24, R25, R26, R27, R29, R41, R44, R45, R57, R60, R82, R83, R84, R87, R88
Depends on: 06.3, 07.2, 07.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: tests/journeys-api/, scripts/smoke/full-cycle.mjs

Только API/server/domain tests, no browser/equivalent. На clean seeded test DB провести три разных модели01.3 через register/upload/correct/freegoal/live tool checked separately/proposal/editlock/compare/publish/customer reserve/assign/fulfill/payment/refund/results/export/reopen/repeat. Fixtures modelstub для deterministic suite явно mock; отдельный economical live run использует actual provider.

Проверить публичный вход и signedin return, demo no-personal-writes/explicit copy, skiptour, custom404 actual status, signout/sessionexpiry, allrole permissions. Source edits invalidate ready version, oldorders hold snapshot, sharedstock/room prevents oversell, simulation not reservation, reportedpayment not causal profit. Full locale key and persistedlocale/currentobject cases, Unicode exports.

Acceptance assertions outcome-ledger balances, exact order/reserve counts, persistent saved artifact, tenant boundaries and route error status. Не закрывать suite по200: каждый test имеет meaningful expected state и recovery. Findings MAIN пишет в существующие задачи/TESTING, не отдельную параллельную PRD.

### 08.1.1 Три связанных предметных цикла
Status: todo

API test suites normal paths с actual DB, value assertions и fixtures isolation; no fake UI proof.

### 08.1.2 Роли, повторение и ошибки пользователя
Status: todo

Stale versions, session/demos/copy/cancel/refunds/locales/404 variants, actual provider economical smoke distinguished from mocks.

## 08.2 Проверить восстановление, изоляцию и стоимость под нагрузкой
Status: todo
Requirements: R14, R15, R17, R18, R25, R39, R42, R43, R57, R60, R79, R85, R86, R87, R88
Depends on: 06.3, 07.2, 07.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: tests/resilience/, tests/security/, scripts/smoke/resilience.mjs

Fault injection на real test PostgreSQL/Workflow: crash betweencommit/start, afterwrite/beforereceipt, duplicate deliveries, staleworker/cancel, expiredquota, source concurrentupdate, logout/revokedrole midrun. 20 concurrent lastitem/timeslot with multiresource locking and API idempotency; database constraints hold. Restore/redeploy tests preserve runningjobs and source blobs, health/ready accurately degraded.

Security: tenant scoped auth everyendpoint, public projection, tokenexpiry/referrer/logredaction, CSRF/openredirect/rate, promptinjection from file, oversized/zipbomb/XSS/SVG upload rejection, filedownload traversal, CSV injection. HTTP/integration tests only. Costs: fallback allowlist deny GPT/Claude/expensive/unknownprice; parallel budget reservation, retries billbound, model unsupported capability. Secrets checktracked/git history beforepush, never echo values.

Performance representative config fixtures: 5000rows,20pages,500orders, largecatalog pagination; p95 targets record under named hardware, not fake guarantee. Slow queries/indexes/timeout/chunks flagged with evidence, no masking as empty data. Validate reasonable API bytes and rate/cost cap during demo/reconnect. Worker returns specific defects with repro, owns tests not speculative code rewrite.

### 08.2.1 Сбои и конкурентная целостность
Status: todo

DB races/delivery replay/fencing/restart/redeploy tests with exact counters and rejected stale writes.

### 08.2.2 Защита данных и ограничение расходов
Status: todo

Threat cases, actual rate/budget/capability and no-key guards, secret scan; verified absence of forbidden model fallback.

### 08.2.3 Рабочий объём и диагностика
Status: todo

Measured largefile/catalog/order API checks, query timings/limits/actionable errors; document reproducible bottlenecks for repair.

## 08.3 Исправить интеграционные и пользовательские замечания
Status: todo
Requirements: R08, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R44, R45, R46, R47, R49, R57, R58, R60, R61, R87, R88
Depends on: 08.1, 08.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/, tests/regression/, public/

Перед назначением MAIN читает TESTING целиком и фиксирует конкретные confirmed findings, repro, acceptance и narrow write loans внутри указанных зон. Один worker владеет этой задачей; широкая зона не разрешение рефакторить unrelated modules. Задача не подменяет недоделанную feature словом polish. Новые feature omissions возвращаются своим задачам.

Пользователь получает exact routes и цели для 360/390/768/1280/1440/1920, keyboard/touch/200%zoom, три locale, длинные названия, empty/pending/partial/error/stale/recovery и firstsession. Агенты не открывают страницы/скриншоты, не инициируют browserautomation; можно анализировать присланные screenshot и traceback. User findings retain original wording в TESTING.

Исправления по причинам: overflow/occlusion/fontfallback, incorrectnavigation/nextaction, lostdraft/filterrace, stalequery, inaccessiblecontrols, route404 и wrongrole visibility. Regression unit/domain/API test согласно найденному риску. Визуальный finding послеfix = needs-user-check до подтверждения; build не переводит его в done.

Готовность: integration suites pass, all critical/missingcapability findings repaired, remaining user checks перечислены без притворства. Невыполненный обещанный сценарий не оставлять в известные ограничения только ради завершения.

### 08.3.1 Разбор и локальные регрессии
Status: todo

MAIN scoped findings, worker reproduces permitted checks and adds failing tests; user text preserved.

### 08.3.2 Исправления и повторный проход
Status: todo

Repair scopedpaths, focused+full regression checks, freshURLs и expected result пользователю; no visual claim without user confirmation.
