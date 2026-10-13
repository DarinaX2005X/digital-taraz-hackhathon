# 13 Проверенный запуск, README и публичный проект
Status: todo

Документация описывает то, что действительно работает. Проверяем запуск без локальной памяти агента и выпускаем проект на согласованном управляемом размещении.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 13.1 Описать продукт и воспроизвести запуск с чистого состояния
Status: todo
Requirements: R18, R62, R63, R64, R65, R66, R74, R78, R81, R101
Depends on: 12.2
Owner: SUBAGENT to assign
Paths: README.md, docs/product/, docs/assets/, scripts/verify-clean-start.mjs, tests/docs/

**Контракт и результат.** C2, C13; delivery/INDEX и README guidance читаются теперь. Detailed Russian README from implemented facts: centered Tirlik/slogan/logo in rounded contrast square, realstackbadges, live/demo links, useful jobs, screenshots supplied by user or truthful diagrams labelled as diagrams, architecture/tools/humancontrol/dataflow, inputs/limits/export/privacy and exact env names. No privatebrief/agent chatter/hash wall/fake marketclaims. Primary launch afterenv one command C2; prerequisites Docker/Node/SMTP and stop/restart included. Clean isolated copy excludes caches/node_modules/privatefiles and uses independent DBnamespace/ports.

**Вход в работу и состояния.** Reader sees concrete result/purpose first, then clear sections and illustrations next to explanation. Setup errors map to actual troubleshooting. Cannot rely on installed skill/agents/runtime secret config; user opens Markdown view manually.

### 13.1.1 README по проверенному продукту
Status: todo

Link/content/schema/env audit against actual code, licenses/credits, no secrets, correct assets and all mandatory deliveredfeatures/limitations. Docs not replace missing function.

### 13.1.2 Чистый запуск и возврат
Status: todo

Isolated checkout npm/compose/migration/start->HTTP real smallworkflow->stop/start->samework. Record OS/envnames/versions withoutvalues; safely remove only verified own test resources after evidence.

## 13.2 Выпустить проверенную ревизию на Vercel
Status: todo
Requirements: R17, R25, R74, R78, R79, R85, R86
Depends on: 13.1, 11.2, 01.4
Owner: SUBAGENT to assign
Paths: scripts/release/, tests/deployed/

**Контракт и результат.** C2, C11-C13. MAIN owns Vercel project/env/deploy, verified upstream and deployment promotion. Worker returns release checks: region/privacy gate01.4/11.2, pooledPG/migrations/privateBlob/SMTP/Workflow config, secretsscope/pricingcaps, production vs preview isolation, signedassets, scheduledworkflow resumes afterdeploy. Deployment associated exact pushed commit; migration forwardcompatible and tested backup/rollback path without reverting user data. Real requested production, not localhost substitute; insufficient access explicit incomplete gate.

**Вход в работу и состояния.** Actual public URL root/demo/auth/private routes via HTTP; synthetic test accounts/data cleanly isolated. Test email links origins, authcookie/securityheaders/unknownroute404 and no internal stack trace. Product server local stays available on free port with restart/stop instructions; no tabs opened.

### 13.2.1 Production конфигурация и публикация
Status: todo

Verify account/project/permissions and allowedserviceplans, env presence without printing, migrations/health and deployment revision. No paid upgrade by assumption.

### 13.2.2 Публичный полный проход
Status: todo

API auth->upload->run->edit->export->signout/signin same artifact, workspace isolation, workerredeploy and email delivery; compare actual hosted revision to source. User visual pass link separate.

