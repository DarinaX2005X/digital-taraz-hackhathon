# Tirlik: полная поставка в пяти крупных этапах

Последнее поручение17октября о сдаче меняет текущую очередность: дальнейшие продуктовые/файловые проверки, independent review и clean-copy остановлены после отчётов owners. Завершаются только презентация, видео и README без ожидания этих gates. Исходные требования и незавершённое evidence сохраняются ниже; отменённый прогон не считается passed, новые product/paid/deploy действия не начинаются автоматически.

Пакет 2026-10-16. F013 разрешил полный объём03–05; последующее прямое поручение17октября «наччни все что можно делать параллеьно из 3-4 пожалуйста» отменяет ожидание полного завершения01–02 перед стартом03. Независимая реализация03 и подготовка/проверки04 начинаются сейчас, конечная приёмка сохраняет реальные producer handovers и integrated review/repair. Tirlik и «Всё для вашего бизнеса» неизменны. Прежние15этапов заменены пятью с17крупными заданиями внутри. Это единственный действующий план; прежние номера больше не используются для назначения.

## Результат продукта

Tirlik помогает бизнесу разбирать заказы, считать деньги, планировать работу и готовить материалы в одной AI-сессии. Ценность — в рабочей среде вокруг модели: свести неоднородные входы, выполнить предметные операции, проверить ограничения, создать **новые полезные редактируемые материалы**, сохранить решения человека и продолжить после изменения данных. Наличие AI, чата, калькулятора, просмотра PDF/Excel или отдельного редактора этого не доказывает.

Первый короткий путь: срочный заказ на занятую неделю. Из запроса, прайса/норм, уже принятых работ, доступности и поставок Tirlik строит вариант выполнения, показывает конкретный конфликт/неизвестное и создаёт выбранные план, предложение и смету. Изменение срока пересматривает затронутое и сохраняет закреплённое. Кампании, финансовая работа, закупки, команда и повторные задачи доступны независимо; этот пример не становится обязательным мастером для всех.

Полный продукт: [PROJECT](PROJECT.md). Новая визуальная система: [DESIGN](DESIGN.md). Исходные обязательства: [REQUIREMENTS](REQUIREMENTS.md). Объяснение каждого задания: [PLAN-HUMAN](PLAN-HUMAN.md).

## Пять этапов

| Этап | Завершённый результат | Крупные пакеты |
| --- | --- | --- |
| [01. Новая рабочая среда и первый полезный результат](stages/01-working-environment.md) | Новый вид, понятный сайт/вход, свободная сессия со своими исходниками, новые editable результаты, выполнимый план и живой пример | 01.1 общая система; 01.2 сессия/материалы; 01.3 харнесс/J1/интеграция; 01.4 планировщик; 01.5 сайт/вход/пример; 01.6 документы/таблицы/экспорт |
| [02. Полный набор полезных бизнес-работ](stages/02-business-results.md) | Финансовые модели/прогнозы/закупки и кампании с редактируемыми макетами | 02.1 деньги/прогноз/закупка; 02.2 креативы/кампания |
| [03. Связанные изменения, команда и следующий период](stages/03-continuing-work.md) | Адресное обновление, согласованный комплект, контекст бизнеса, коллеги и повтор по новым данным | 03.1 изменения/выпуск; 03.2 контекст/команда/повтор |
| [04. Проверка, исправления и готовое локальное приложение](stages/04-stable-product.md) | Полный продукт соединён, проверен и исправлен; README и воспроизводимый запуск | 04.1 интеграция/устойчивость; 04.2 independent review; 04.3 исправления; 04.4 README/чистый запуск |
| [05. Демо-видео, презентация и финальный комплект](stages/05-demo-and-delivery.md) | Ролик/исходники/player, editable презентация/PDF и передача приложения | 05.1 презентация; 05.2 видео; 05.3 сдача |

Независимые пакеты01–03 и готовая независимая часть04 идут параллельно по последнему прямому поручению17октября. Stable wire contracts разрешают старт consumers, но до done нужны записанные producer handovers.04.2 final independent review ждёт полного04.1,04.3 следует findings; подготовка README/clean-start04.4 может идти раньше, финализируется после repairs. Десять implementation packages имеют непересекающиеся Paths. Задание не дробится на агента для каждой страницы/локали/теста.

Самый рискованный путь: существующий K1/K3 → новый K2 и J1 параллельно → настоящая работа → тот же механизм в изолированном примере. Остальные пакеты не ждут лендинга. Обязательный join 04.1 ждёт 01–03, затем review/repair/README. По последующему прямому поручению17октября презентация и видео начинаются сейчас параллельно на Astra; видео не ждёт deck. Финальные claims/states/exports сверяются с04.4, integration loans выдаются после handovers. Checkpoints — содержательные передачи внутри задания, не новые этапы и не обязательные остановки.

Срок менее суток — жёсткое ограничение пользователя, не доказательство достижимости. Основное время — параллельной реализации, последние часы нужно сохранить для стабильности/media. Не обещаем точные часы без работающего proof. При разрыве MAIN называет конкретную недостающую часть и продолжает полный объём, не превращает его молча в MVP. Память обновляется при решении, передаче или принятом результате; без журнала мелких действий.


### Передачи, обязательные для закрытия пакетов

Depends on задаёт блокировку **начала** задания. Пакеты01–03 начинают по существующим/утверждённым wire contracts;04.1 начинает независимые проверки существующих путей,04.4 — документацию и переносимый запуск. По последнему поручению ожидание всего01–02 снято. До статуса done обязательны следующие реальные handovers и полный final join04; они входят в checkpoints, не создают дополнительных этапов/задач. Достаточен принятый указанный checkpoint, не весь task; fixtures не считаются handover.

| Потребитель | Обязательные реальные producer handovers до done |
| --- | --- |
| 01.1 | Собственные примитивы + совместимость существующих imports; страницы проверяют их владельцы |
| 01.2 | 01.1.1 общие controls; 01.3.1 runs/projections; 01.6.1 commands/editors; 01.5.1 auth return; plan/design mounts по01.4.2/02.2.1 |
| 01.3 | 01.4.1 solver, 01.6.1 persisted artifact boundary для живого J1; domain descriptors02.1.1/02.2.1; context/recurring descriptors03.2 добавляются по реальному producer handover, параллельный старт03 разрешён17октября |
| 01.4 | 01.1.1 controls; existing artifact command service, обновление при01.6.1 до финального P1/P4 |
| 01.5 | 01.2.1 composer/materials, 01.3.1 demo authority/runtime и01.3.2 live proof, 01.4.1 solver, 01.6.2 реальный export |
| 01.6 | 01.2.1 materials/mapping/query, 01.1.1 controls; migration/export registration01.3.1 |
| 02.1 | 01.2.1 authoritative material query, 01.6.1 workbook/calculations, 01.3.1 execution registration |
| 02.2 | 01.4.1 planning, 02.1.1 budget, brand из выбранных source/asset inputs; versioned context reader03.2 подключается в этапе03, 01.3.1 execution registration |
| 03.1 | 01.2.1 mapping/lineage, 01.6.1 commands +01.6.2 files, 02.2.1 stable design property binding, 01.4.2 plan edits/export |
| 03.2 | 01.5.1 auth, 01.2.1 source selectors, 01.3.1 run bridge, 03.1.1 change review; actual financial/campaign descriptors02.1.1/02.2.1 для повторов |

01.3.1 отдаёт стабильный runtime/schema integration boundary рано и остаётся единственным writer общих registries; feature owners передают маленькие конкретные schema/descriptors changes этому владельцу. Он подключает их по готовности, не читает заново всё приложение. Последний полный join04.1 всё равно ждёт завершённые задачи01–03 и не заменяется этими handovers.

## Проверенная основа и реальные пробелы

Source review 2026-10-16 подтвердил auth/workspaces, загрузку/сопоставление, durable runtime/SSE событий, версии/commands, настоящие document/table/design/plan editors, экспорты и dependency review. J1 создаёт смету/предложение/план одной транзакцией; live acceptance ещё нет. Operations проверяет готовые assignments, но не строит выполнимое расписание. Campaign/creative orchestration, finance/forecast/procurement и context/collaboration/recurring packages отсутствуют. Пример всё ещё про цену/сохранение слов, public CTA не ведёт к полезному demo, composer требует проект до вложений. Видео/deck не готовы.

Основа переиспользуется. HEAD44b6dd2 и незакоммиченный UI/onboarding WIP сохранены; новый owner сверяет свои paths. Старые test counts не объявляются свежей приёмкой. Новые todo обозначают оставшуюся полную поставку, не удаление рабочего кода. Внешний вид исходниками не подтверждён.

## Общие технические контракты

C1–C14 PROJECT содержат предметные модели/форматы/версии. K уточняют существующий wire и новые изменения. «Существующий» подтверждён source review; «новый» — целевая реализация. Один canonical schema на понятие, без параллельного runtime/хранилища.

### K0. Авторитетные данные, ошибки и эффекты

Actor получается из серверной сессии, запрошенный workspace/project проверяется ACL. Модель не назначает владельца. SourceVersion/ArtifactVersion immutable, любой результат хранит выбранные revisions. Money = ISO currency + decimal-string minorUnits; Quantity = decimal string + unit; unknown не ноль, валюту нельзя универсально делить на100. UTC instant и local date различаются, timezone Asia/Qyzylorda.

Error envelope C4 и canonical schemas. Create/apply: idempotency, baseRevision, transaction receipt; 409 сохраняет обе версии, 401 — намерение без автоматического side effect после входа, 403/404 не раскрывают чужое. Cancel/revoke блокирует late commit через epoch/authzVersion. Provider I/O вне DB transaction. Сначала commit пригодной части, затем событие ready.

### K1. Существующая свободная задача и состояние исполнения

Производитель01.3, потребители01.2/01.5/02/03.2. Canonical src/contracts/runs.ts, runs/server/{handlers,service,runtime}.ts, /api/runs/[[...path]]. POST /api/runs, Idempotency-Key = operationId. Строгое тело: {workspaceId, projectId: string|null, capabilityId:'business.goal', capabilityVersion:1, goal, locale:'ru'|'kk'|'en', inputRefs:[{kind:'source'|'artifact',id,revision}]}. ID/revision types из фактического schema, не копии из документа.

Пример goal: «Подготовь план этих заказов до пятницы. Согласованные работы не двигай, недостающие материалы включи в закупку»; inputRefs выбирают версии запроса/прайса/принятого плана. Сервер cross-check identity header с session и ACL-check workspace. Ответ202 — полный RunSchema; cursor называется cursor. Constraints/initial selection/input parentRunId/eventCursor в существующем DTO отсутствуют. Условия находятся в goal и подтверждённых source/artifact inputs, structured tool constraints возникают при нормализации. Выбор — ResumeRunSchema.selectedOptionId. Изменённые цель/ревизии создают server-linked child, parentRunId/continuationRunId — response projections.

Public projection: plan/questions/summary/results, optional decision/branches. Events отражают committed run/step/usage/result/branch/projection changes; reconnect snapshot+after cursor не создаёт run заново. Provider сейчас stream:false: SSE означает реальную работу, не token stream. Полезные части публикуются через durable results, без искусственной печати.

Каждая domain procedure задаёт evidence/context/unknowns/tools/checks/repair/completion. Registry owner01.3 принимает ToolDescriptor от доменов; business.goal не превращается в пять обязательных мастеров. Live calls только назначенный executor с reservation.

### K2. Новый построитель выполнимого плана

Производитель01.4, consumers01.3/02.2. PlanModel в PROJECT — предметное название, не существующий TS symbol. Canonical plan branch src/features/artifacts/domain/content-models.ts: {kind:'plan',schemaVersion:1,timezone,entries}. src/features/operations/domain/model.ts экспортирует OperationalPlanContent с OperationalPlanEntry; использовать их, а не новую независимую модель. WorkResource/AvailabilityVersion из operations/contracts.ts; immutable availability содержит weekday intervals/date exceptions/effective range/sourceRefs.

Новый публичный export operations/domain/propose-work-plan.ts: proposeWorkPlan(input, context). Domain input = {plan:OperationalPlanContent, resourceRefs:[{id,revision,availabilityVersionId}], window:{start:UTCInstant,end:UTCInstant}, lockedEntryIds:string[], materialConstraints:[{entryId,sourceRef,availableAt:UTCInstant|null}], objective:'earliest-finish'|'least-change'|'lowest-known-cost'}. Existing entries несут duration/effort/quantity/dependencies/sourceRefs, исходные assignments и known deadline/ranges; нормализация единиц использует existing types. Missing deadline/duration/capability/cost остаётся unknown. Context содержит server authorization, authoritative resource reader и bounded search limit; модель не поставляет авторитетную доступность.

Output = {status:'feasible'|'partial'|'unknown'|'infeasible',candidate:OperationalPlanContent,changedEntryIds:string[],unresolved:[{entryId,code,sourceRefs}],conflicts:[{entryIds,resourceId?,code,sourceRefs}],checkReceipt:{algorithmVersion,visitedNodes,searchLimit,capacityAssessments,inputRevisionVector}}. SourceRef/revision-vector types canonical; constraint codes finite declared in this export, consumers не парсят explanation text. Candidate никогда сам не меняет принятый план, apply K3/C6.

Сначала bounded interval/dependency search находит placements, затем validateOperationalPlan(candidate) и existing assessPlanCapacity({plan:candidate,resources,availabilityVersions}) проверяют их. CapacityAssessment[] имеет resourceId, optional availability ID, status conflict/within-known-capacity/availability-unknown, scope/window/timezone, demanded/available minutes, affected entry IDs и reasons. **Текущий validator пропускает entry без assignments: каждая неназначенная active job обязана быть unresolved, пустое расписание не feasible.** Проверяются также dependencies/material constraints/locks, не только capacity. Infeasible только при доказанном противоречии; exhaustion даёт unknown. Minimum cost objective требует известных сопоставимых ставок, иначе честная partial/unknown оценка.

Пример: две работы конкурируют за сотрудника, одна закреплена, вторая имеет допустимое окно. Найти свободное окно для второй и сохранить первую. Неизвестная поставка не становится выдуманной датой; пригодная независимая часть остаётся. Новая недоступность даёт адресный пересмотр. Для самостоятельного ручного планирования никаких AI calls не требуется.

### K3. Существующий материал, редактор и новый комплект

Artifact engine01.6, mounts01.2, creators01.3/01.4/02/03. Canonical src/features/artifacts/contracts.ts и src/contracts/commands.ts. CreateArtifactSchema: workspace/project/authz/title, typed content, access class, source refs/bindings. Mutation response ArtifactMutationResult={viewer,artifact,version,cursor} не содержит content. Editor read ArtifactSnapshot={viewer,artifact,content,version,permissions,sourceFreshness,history,cursor,locks?,missingTargets?}.

/app/projects/:projectId/artifacts/:artifactId монтирует editor по snapshot.content.kind: document/table/design/plan. Ручное «Создать материал» использует тот же engine без AI; source preview не является editor. Commands содержат artifact/base revisions, stable targetId, operations, source revision vector; ответ CommandReceipt с committed vector/history. Save/undo/reopen/export используют эту ревизию, не второй client JSON.

J1 три creates+dependency links уже выполняются в одной tool transaction. Это существующий transactional pattern, не generic public bundle endpoint. Остальные домены применяют тот же принцип атомарного комплекта. Schema validity недостаточно: содержание должно решить задачу и пройти domain checker.



Project-create boundary существует: POST /api/projects, session + совпадающий X-Tirlik-User-Id + same-origin + UUID Idempotency-Key. Strict CreateProjectSchema в src/features/workspace/contracts.ts: {workspaceId:UUID,title:string(1..240),goal:string|null(max12000,default null),expectedAuthzVersion:positive integer}. name/locale отсутствуют. Response201 ProjectResultSchema = {project:{id,workspaceId,title,goal,status,revision,createdBy,createdAt,updatedAt},authzVersion,cursor,canEdit?}. One identityTransaction: workspace writer lock/authz, insert/grant, authz increment, event. projects.creation_key/body_hash повторно возвращает тот же project для actor+workspace+key+body, другой body с тем же key даёт409. Это atomic создание project; загрузки затем отдельные recoverable операции, не одна выдуманная транзакция с bytes. Composer хранит creation key/result до завершения/retry и не создаёт второй project при ошибке файла.

Вложения на старте01.2: существующий InitSourceUploadSchema требует workspaceId/projectId. Поэтому composer выбирает файлы локально, явное «Начать» создаёт project без отдельного экрана, затем POST /api/sources/uploads/init + Idempotency-Key →201 {upload,token}; PUT /api/sources/uploads/:uploadId?workspaceId=… + X-Upload-Token + bytes; POST /api/sources/uploads/:uploadId/finalize body {workspaceId} →{upload}. После ready source/version формирует inputRefs для run. Никаких фиктивно существующих temporary-upload API. Ошибка файла сохраняет project/другие ready files и позволяет повторить затронутую загрузку без второго проекта.

### K4. Независимые предметные работы

| Работа | Производитель/действие | Полезный результат |
| --- | --- | --- |
| J1 коммерческая | 01.3 commercial/agent-tools + K2/exact calculations | Выполнимые условия и связанные смета/предложение/план; изменение ограничения меняет решение |
| J2 кампания | 02.2 campaigns/creative-ai/designs, источники/бренд/условия | Новые послойные макеты, тексты, календарь/budget; прямые правки, разные размеры и языки |
| J3 деньги/закупка | 02.1 finance/forecast/procurement, нормализация/условия/история | Editable модель, закупка, прогноз/report; полная известная стоимость, cash timing, unknowns/backtest |
| J4 работа | 01.4 operations, задачи/ресурсы/зависимости | Найденные assignments, reusable plan, locks, ручное управление и пересмотр |
| J5 возвращение | 03.2 context/collaboration/recurring, rule/selectors/occurrence | Новый draft/review, правильная версия у коллеги, сохранённый предыдущий период/override |

Feature schemas/descriptors принадлежат domain owner, registration01.3. APIs используют C4/C9/C10; существующие service exports предпочтительнее добавочных endpoint. Любая область запускается самостоятельно или комбинируется по свободной цели.

### K5. Новый живой пример, вход и обучение

Производитель01.5, runtime scope01.3, consumer01.2. Существующий /api/demo/export не является session API. Новые exact routes:

- GET /demo: read synthetic example, без персональной записи.
- POST /api/demo/sessions: explicit start, body {locale}; response201 {sessionId,expiresAt,revision,inputRefs}, signed httpOnly capability; изолированное временное состояние TTL24h.
- POST /api/demo/sessions/:id/runs: body {goal,inputRefs,expectedRevision}, Idempotency-Key; response202 {runId,cursor}. Facts меняются typed temporary artifact commands K3, не произвольным constraints blob.
- GET /api/demo/sessions/:id: {sessionId,expiresAt,revision,inputs,results,runIds}. GET /api/demo/sessions/:id/runs/:runId: public RunSchema/projection; /events?after=<cursor>: canonical events. Чужой/expired scope не читается.
- POST /api/demo/sessions/:id/copy: auth+capability, body {expectedRevision,artifactIds,destinationWorkspaceId}, Idempotency-Key; response201 {projectId,artifacts:[{id,revision}]}. Destination ACL, remap IDs/refs/assets, одна копия. Signin сам copy не вызывает.

Server-authorized DemoExecutionScope разрешает только synthetic snapshot/temporary results. Domain engines/validators/typed editors те же; private retrieval/invitations/external effects запрещены. Не подделывает персональную сессию: runtime принимает explicit demo authority. Origin/rate/actual cost bounds, paid execution только после явного запуска. Export использует typed revision. TTL expiry даёт reset без ложного сохранения; auth cancel оставляет работу.

Уточнение F013: demo — обычная рабочая сессия/редакторы с заранее сохранёнными файлами, заказами и задачами, не отдельный декоративный интерфейс. Scenario реалистичный, не абстрактная кофейня; synthetic входы честно обозначены, результаты получают реальные domain endpoints/provider. AssistantSession получает injectable run/events/result transport с неизменёнными authenticated defaults; scoped demo adapter использует capability endpoints. Scoped artifact read/command/history/export проверяют принадлежность synthetic workspace/project/actor и вызывают existing services. Local drafts изолированы по demo session и очищаются при expiry. Коммерческие decision и workDecision оба имеют реальный choose/resume путь. Source01.2, runtime01.3 и first-use01.5 владеют своими частями, fake Better Auth session не создаётся.

Onboarding: anchors текущего экрана, skip/resume/replay, никакого неожиданного перехода в материалы/нового тура при refresh. Auth отменяем, draft intent сохраняется; профиль/выход/возврат полноценны. По прямому уточнению после F013 email verification полностью удаляется: UI/API/code/mail/callback/guard/locales, включая optional вариант. Signup сразу создаёт сессию, login использует email/password. Password/session/ACL и отдельный recovery flow сохраняются; обязательное внутреннее поле auth-библиотеки не становится публичным статусом и не подделывает проверку. Понятность и время проверяет человек, server latency отдельно.

### K6. Продолжение, права и согласованный выпуск

03.1 dependency graph: stable fact/record/element property IDs и causal groups C6. После принятого mapping source обновляет reachable fields; geometry-only edit не value override. Manual/locked поля сохраняются, conflicts привязаны к объекту. Apply/undo group атомарны, stale revision требует review.

Export C7 фиксирует revision vector/policy: DOCX/PDF, XLSX/CSV, PNG/JPEG/PDF, переносимый editable проект, ICS по календарному смыслу. Retry сохраняет выбранную версию и пригодную часть. 03.2 comments/approval относятся к версии, revoke действует на source/results/files/run. Повтор сохраняет versioned rule/selectors/occurrence, готовит новый draft без публикации/перезаписи утверждённого. C10 содержит единые authoritative entities/permissions для контекста, команды и повторов.

### K7. Новые общие операции между предметными пакетами

Canonical новый модуль src/contracts/business-work.ts принадлежит01.3; domain implementations — владельцам02.1/02.2/03.2, signatures ниже заморожены до dispatch. Money/Quantity/LocalDate/SourceRef/ArtifactSnapshotRef/DatasetQuerySpec/CalculationSpec/ChangeSet берутся из соответствующих существующих canonical schemas, не объявляются повторно. Type aliases разрешают эти названия в конкретные текущие symbols. Все exports server-only; дополнительных публичных API для связи доменов не требуется.

Общий context WorkExecutionContext = server execution authority (user или K5 demo), operationId, workspaceId/projectId, expectedAuthzVersion, allowedInputRefs, inputRevisionVector, cancelEpoch, locale. Модель не создаёт этот context. Общий BusinessWorkResult = {artifacts:ArtifactMutationResult[],inputRevisionVector,checks:[{code,status:'passed'|'failed'|'unknown',targetIds,sourceRefs}],unresolved:[{code,targetIds,sourceRefs}],decision?:{id,options:[{id,label,artifactIds}],requiresConsent:boolean},summary}. ToolDescriptor возвращает этот result в runtime canonical tool envelope. Editor content читается отдельно K3. Returns partial если пригодные artifacts уже есть; статус ready только для прошедших relevant checks. Применение выбранного варианта требует decision/consent из K1, без автоматической отправки заказов/публикации.

- Finance producer02.1 export buildFinanceWork({sourceRefs,query:DatasetQuerySpec,currency,accounting:'cash'|'accrual',openingBalance:Money|null,period:{start:LocalDate,end:LocalDate},assumptionSets:[{id,title,variables:[{id,value:Money|Quantity|LocalDate|null,sourceRef?,confirmed:boolean}],calculation:CalculationSpec}]},ctx): Promise<BusinessWorkResult>. C9 задаёт formulas/units, cash timing и forecast eligibility. Строит новые сценарные workbooks/report; unknown amount не ноль. Campaign передаёт budget как ArtifactSnapshotRef выбранного finance result, не свою несовместимую формулу.
- Forecast producer02.1 export buildForecastWork(input:ForecastInput из C9,ctx): Promise<BusinessWorkResult & {forecast:ForecastRun}>. Возвращает сохранённые series refs/train/backtest/point/range/baseline/source revisions и editable таблицу/отчёт; insufficient eligibility возвращает unresolved с причиной и пригодный сценарный путь, не fake forecast.
- Procurement producer02.1 export buildProcurementWork({needLines:[{id,itemKey,quantity:Quantity,requiredBy:LocalDate|null,sourceRefs}],offerSourceRefs,stockSourceRefs,currency,deliveryDestination:string|null},ctx): Promise<BusinessWorkResult>. Из mapped records читает pack/MOQ/delivery/payment/FX по C9, создаёт comparison workbook и черновик заказа после выбора, никаких внешних writes. Неполные offer facts отражаются в unresolved и не выигрывают по отсутствующей стоимости.
- Context producer03.2 export readBusinessContext({workspaceId,contextId,revision,itemIds:string[]},ctx): Promise<{ref:{kind:'business-context',id,revision},items:[{id,value,sourceRefs,confirmed:boolean}],brandKit:{assetRefs,colors,fontFamilies,voiceRules},permissions}>. Values валидируются discriminated context schema (text/Money/Quantity/date/assetRef), не arbitrary executable JSON. Выбранные itemIds и права ограничивают retrieval, business.goal inputRefs не расширяются тайком новым kind: explicit context ref передаёт tool с authority пользователя/правила. Bindings используют context reader и version, не fake upload SourceRef.
- Campaign producer02.2 export buildCampaignWork({brief:string,sourceRefs,assetRefs,brandRef:{contextId,revision,itemIds}|null,conditions:[{id,kind:'price'|'date'|'quantity'|'text',value:Money|Quantity|LocalDate|string,sourceRef}],formats:[{id,width:number,height:number,unit:'px'|'mm',locale}],budgetRef:ArtifactSnapshotRef|null,planInput:K2Input|null},ctx): Promise<BusinessWorkResult>. Читает brand через reader, budget snapshot через artifact ACL, календарь через K2; создаёт DesignContent/DocumentContent/plan с semantic bindings на conditions. Unknown cost/date не выдумывается; частичный kit имеет явные unresolved. Начинается без обязательного brand kit.
- Change review producer03.1 export prepareWorkChanges({projectId,artifactIds,sourceRevisionVector},ctx): Promise<{changeSet:ChangeSet,inputRevisionVector}>. Использует existing dependency/review engine, не применяет изменения; apply/undo остаётся C6/K3. Recurring и context используют этот же export.
- Recurring producer03.2 export startWorkOccurrence({ruleId,ruleVersion,occurrenceId,trigger:{kind:'manual'|'schedule'|'source-update',at:UTCInstant,sourceRefs}},ctx): Promise<{occurrenceId,runId:string|null,branchId:string|null,state:'queued'|'waiting_input'|'paused',reused:boolean,reasonCode?:string}>. Сервер читает immutable enabled WorkRule и актуальные права owner, замороженные selectors/context/procedure/budget; unique ruleVersion+occurrenceId запрещает дубликат. Run создаётся через canonical service K1 с server child/branch links, source schema drift даёт waiting_input, disabled/отозванное право — paused. Новые результаты идут в новую ветку + prepareWorkChanges, старое не перезаписывается.

Финансовый/закупочный/campaign bundle commit создаёт artifact versions+dependency links+operation receipt атомарно по существующему pattern J1; bytes/provider I/O до транзакции и с ограниченным staging lease. Сверка ACL/cancel/revisions непосредственно перед commit; тот же operationId+body возвращает receipt, другой body409. Stale inputs409, invalid units/shape422, quota429, недоступная обязательная внешняя операция503 с retryable/operationId по C4. Повтор unknown charge запрещён. Missing business facts дают typed unresolved/decision, а не transport failure. Новые schemas integration owner отдаёт domain owners как importable contracts в01.3.1; реализация helpers остаётся их решением.

## Проверяемые общие случаи

| ID | Старт и действие | Пригодный результат и отрицательная ветка |
| --- | --- | --- |
| P1 | Срочный запрос + текущие работы + доступность/прайс, затем изменить deadline | Новый выполнимый план и согласованное предложение/смета; закреплённая работа не сдвинута, неизвестный срок поставки не выдуман |
| P2 | Собственные фото/бренд/условия, подготовить кампанию RU/KK и два размера | Новые послойные макеты, тексты, календарь; новая дата сохраняет ручной язык/композицию, нет выдуманного рекламного эффекта |
| P3 | Грязные продажи/возвраты и прайсы поставщиков с разной упаковкой | Рабочая финансовая модель и закупка по полной известной стоимости; incomplete offer не объявлен лучшим, прогноз проверен на истории |
| P4 | Свободная задача с зависимостями, сотрудником без аккаунта и исключением доступности | Система строит план, пользователь правит/экспортирует; unknown capacity и чужой private resource не принимаются как доступные |
| P5 | Принятый проект, ручная правка, новый источник/период, повтор и конкурирующее изменение | Адресный новый черновик, версии/reopen/export совпадают; duplicate/cancel/409/revoke не портят работу |
| P6 | Новый посетитель, пример и своя задача, вход/отмена/переключение языка/возврат | Полезная часть примерно за 2 минуты как цель, явное сохранение, нет unwanted records; missing provider/обрыв сохраняют введённое |

Три бизнес-контекста из fixtures остаются в проверках, не все обязаны повторять P1. Нужен хотя бы один новый ввод/изменённое существенное ограничение, которое заранее не зашито в пример. Схема JSON, 200/health, mocked provider и факт рендера editor не являются полным доказательством.

## Владение, проверки и поставка

MAIN ведёт память, общие решения, Git и координацию. Source review, feature implementation и существенная интеграция делегируются свежим GPT-5.6 Sol medium/high/xhigh; связанное продолжение остаётся владельцу. Только VibeMachina. Каждый читает полный BRIEF/дословные remarks/relevant original TESTING и нужные refs; UI owner — foundation/direction/anti-slop/ux/system/motion/copy. Media owner читает полные video remarks. Никаких вторых лидеров, отдельных отчётов или копирования scratch поверх checkout.

Shared src/ui —01.1; contracts/DB/migration registry/runtime/tools/root integration —01.3. Feature owners отвечают за свои routes/pages/locales/states. Exact loans записываются до записи; старый handle не считается действующим владельцем. Approved wire contract разрешает consumer development до готового producer; закрытие пользовательского пути требует реальную интеграцию. 04.1 соединяет все результаты.

Продуктовые команды без зависимости от skill: node scripts/check.mjs, node scripts/check-integration.mjs, node scripts/check-build.mjs, scoped live eval. Общие checks на стабильном snapshot; повтор по изменению/дефекту. Skill check-plan.mjs проверяет граф/покрытие, не качество продукта. MAIN commits/push только C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs, real checks, scoped --paths и --push в проверенный origin/main после handovers. Нет tiny plan-only commit; private BRIEF/TESTING/runtime/env не staged.

OpenRouter общий новый ceiling USD10, точные totals в STATE/private ledger, прежние unresolved reservations сохраняются. Один paid executor, актуальный exact endpoint quote, atomic reservation, server secrets; без GPT/Claude/дорогого fallback и blind retry uncertain charge. Новые подписки не разрешены.

Визуальная/browser проверка только пользовательская. Запрещены CUA/Playwright/Selenium/Puppeteer/headless/screenshots/navigation/renderer bypass; вкладки не открывать. Агент проверяет source/domain/DB/server/HTTP/API/экспортные файлы. Разрешены предоставленные reference media и media production без UI automation. RU/KK/EN, partial/loading/error/cancel/stale/conflict/reopen и качество взаимодействия входят в каждую UI-функцию, не в необязательную полировку.

Размещение: прямое разрешение17октября требует повторить Vercel; пользователь выбрал private R2 для hosted files. Self-deploy остаётся local filesystem без cloud keys, отсутствие AI key не блокирует ручную работу. Deployment только из стабильного переданного source; другие hosting/покупки подписок не назначены. Приложение, README, editable deck/PDF, MP4/source/player входят в полный текущий комплект. Localhost не называется опубликованным сайтом; actual URL и границы проверок фиксируются по результату.03/04 идут параллельно; новое поручение «отправь агентов на астре начать презу и демо видео» также снимает барьер старта05.1/05.2. Full review/repairs и окончательная factual acceptance media сохраняются.

До реального03.2 handover кампании получают brand/conditions из выбранных существующих sources/assets либо brandRef:null. Не создавать фиктивный BusinessContext reader; новый03.2 owner реализует его параллельно. Registry01.3 принимает только реализованные tools. Все design/UI workers по прямому требованию читают **все десять файлов references/design/** VibeMachina и изучают указанные локальные visual references; могут полностью заменять шаблонные статичные блоки в своих путях.
