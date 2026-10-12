# 10 Публичный Vercel, проверенный README и комплект сдачи
Status: todo

Стабильная версия получает настоящий публичный адрес и независимый воспроизводимый запуск из GitHub. Документация описывает только проверенную поставку.

## 10.1 Развернуть стабильный продукт и проверить его после нового деплоя
Status: todo
Requirements: R17, R18, R21, R22, R25, R42, R43, R59, R63, R64, R74, R77, R78, R79, R81, R85, R86, R87, R88
Depends on: 09.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: scripts/deploy/, scripts/smoke/production.mjs, vercel.json, .env.example, .github/workflows/, docs/deployment.md

Target existing Vercel connection, production Neon PostgreSQL/privateBlob/Workflows/SMTP. Worker prepares config/migration/readiness/smokes/runbook, MAIN owns Gitpush/env injection/deploy. Confirm account scope/permissions/limits and legalplan suitability perC2; no subscriptions or paidcapacity without human permission. Use real deployment returned URL, no invented domain. Environment never print secrets or force-add .env/BRIEF/TESTING/runtime.

Separate preview/prod DB/storage/token/mail allowedorigins, migration before schema-dependent rollout compatible with inflightjobs. Short DB transactions/pooled runtime/direct migrations, region alignment, restorepoint+backup method and rollback to previousdeploy. Objectdata not ephemeral function filesystem. Workflows include version compatibility/oldrun resume; reconcile loop independent browser and documented operator recovery. Fileupload direct/private limits proved.

Production API smoke on labelled acceptanceworkspace: signin, email delivered verify/reset, upload/file download, economical realAI, publish page, reserve once/retry/race, fulfill, outcome, pause/cancel, seconddeploy/reopen/runresume. Publicauth/login endpoints and actual404/cacheheaders/rate/external storage read validated. Clean up only own acceptanceworkspace after proof; no customerdata deletion. Mailaccepted vs delivered distinguishactual inbox check.

Output healthURL/liveURL/serviceversions/commands and rollback instructions; user does visual publiccheck. If SMTP/DBpermission/costlimit missing, release remains blockedcondition, not «готово» with broken publishedaction.

### 10.1.1 Подготовить постоянные production-сервисы
Status: todo

Connection/resource access proof, env names/origins/limits, migrate/backup/restore and safeGit manifest; no automatic spending.

### 10.1.2 Проверить настоящий публичный цикл
Status: todo

MAIN deploy, HTTP/API/liveAI/actualmail/privateblob/resourceconcurrency proofs with clearlylabelled testdata; no UIautomation.

### 10.1.3 Проверить redeploy и восстановление
Status: todo

Saved work/job/reservations/blob survive replacement, rollback/runbook tested where possible; exact remaining access issues and userURL.

## 10.2 Написать проверенный README и воспроизвести чистый запуск
Status: todo
Requirements: R02, R04, R09, R10, R17, R18, R59, R60, R62, R63, R64, R65, R66, R74, R75, R78, R81, R87, R88
Depends on: 10.1
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: README.md, docs/architecture.md, docs/assets/, scripts/smoke/clean-start.mjs, .env.example

Прочитать skill delivery/readme и final repo scripts. Русский README послеstable code, centered actual logo в белом rounded bordered square, Tirlik/name/slogan, компактные accurate stackbadges, реальные app/demo/repolinks. Вступление конкретно раскрывает механизм общих ресурсов и полныйрезультат, no superiority/demand/syntheticprofits claims.

Структура по продукту: owninput->agents/tools->exactconstraints->approval->publicorder->fulfill->reportedoutcome, три роли, changinggoals/locks, commonresource example knownnumbers, implemented features vs material limits. Explain realmodel/routingbudget/modality, schema nottruth, PII/provider rules, provenance/required licenses; textualskillguidance не reusedimplementation claim. .vibemachina planning docs разрешены в Git, кроме BRIEF/TESTING/runtime; продукт запускается без них. No videoasdone until11.4.

Launch tested new temporary checkout/newisolated DB/files/env withoutauthorprivateconfig: после заявленных prerequisites/env выполнить именно node scripts/dev/start.mjs из01.1. Runner сам делает pinned install/Compose/readiness/migrate/demo seed/start; затем API-операция, restart и повторный запуск без дубликатов/потери данных. Ручная последовательность команд не засчитывается вместо обещанного единого входа. Отдельно check/build и диагностические scripts; expectedURLsports, requirements/runtime/OS, exact everyenv optionalbehavior. Scripts fromrepo, notlocalcodexskill; безопасная изоляция без удаления рабочей среды пользователя. Envessential errors actionable, optionalAI missing doesn'tbreakmanualwork; one actualeconomical liveproof wherekeyavailable separate.

Visualmaterials only usersupplied real screenshots approvedforpublic or truthful architecture/data diagram with labels; no fabricated screenshot and no automaticbrowsercapture. Use diagram near explanation, not ornamentalimagewall. Readmeclaims allchecked against code+evidence. Reviewer executes documentedcommands ratherthan trusting draftedtext.

### 10.2.1 Документация по проверенному продукту
Status: todo

Write substantial readable README/architecture with actual assets/links/commands/config/limits and attribution. Current scriptnames verified.

### 10.2.2 Независимый чистый запуск
Status: todo

Newcheckout/testDB path, execute documentedlaunch+checks+smallAPI journey withoutprivateplanningfiles; fix any missed step thenrerun.

### 10.2.3 Проверка утверждений и ссылок
Status: todo

Validate internal/externallinks, implementedclaims/modelguards/visualorigins; MAIN commit scopedpublicdocs, no BRIEF/TESTING/runtime/secrets.

## 10.3 Подготовить название, описание и проверяемые ссылки для сдачи
Status: todo
Requirements: R01, R02, R04, R07, R09, R13, R19, R64, R73, R74, R75, R77, R78, R80, R87, R88
Depends on: 10.2
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: docs/submission.md

Один краткий и развёрнутый русский description, approved Tirlik/slogan, trackfit Taraz/Jambyl и конкретный outcome mechanism, input/roles/privacy, correct synthetic disclaimer. Реальный repo/live/demo link verifiedHTTP; presentation/video fields пока clearlypending stage11, не fakefile links. Организаторские условия толькоuserquote, не invent scoring/deadline/partners.

Проверить написание имён/названий по actual approvedsource, нет брендов Teamble/LangEase/старого Qorap в публичном Tirlik тексте кроме attribution где действительно нужно. Не включать tariffs/monetization. Describe differences with testable jointresource semantics, not "единственный".

Acceptance shortform читается безframeworkknowledge, не заявляет interview/realrevenue/causality, links correspondcurrentdeploy; финальная синхронизация media URLs12.1. User получаетготовый projectname/description/repolive list.

### 10.3.1 Описание и ссылки с проверяемыми утверждениями
Status: todo

Write submission copy, source/claim audit, actual URL availability and marked pending media; handoff presentation task11.1.
