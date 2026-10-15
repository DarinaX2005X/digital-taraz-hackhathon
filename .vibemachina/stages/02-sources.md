# 02 Свои материалы и защищённое рабочее пространство
Status: active

Бизнес начинает с того, что у него уже есть. Вход и загрузка не требуют переносить клиентов; система показывает, что поняла в файлах и где нужна проверка.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 02.1 Дать владельцу и приглашённому коллеге надёжный вход
Status: done
Requirements: R11, R22, R23, R24, R25, R34, R39, R41, R43, R44, R45, R90
Depends on: 01.1, 01.2
Owner: /root/foundation (server), /root/ui_foundation (UI)
Paths: src/features/identity/, tests/identity/, src/server/db/identity-schema.ts, migrations/0003_identity.sql, migrations/0004_identity_workspaces.sql

**Контракт и результат.** C3-C4, C12. Better Auth signup/email verification/login/reset/expiry/logout, Workspace+Membership owner/editor/reviewer, invites single-use TTL, profile/session revocation. Default-deny scopes include approve/export/readconfidential; actor из сессии. returnTo local allowlist, сохранение goal draft как opaque intent, не содержимое в URL. Реальный SMTP и Mailpit local. Ошибки не перечисляют существующие аккаунты. MAIN owns auth route/schema, worker передаёт integration contract.

**Вход в работу и состояния.** «Войти» из public/demo/goal: dismissible dialog где уместно; emails через dedicated routes. Возврат к намерению без автоматического копирования demo. Profile menu language/profile/settings/sign out. Mobile forms stack; ru/kk/en ошибки сохраняют безопасный ввод, не пароль в storage.

Уточнение почтового adapter: последнее сообщение пользователя предоставляет BREVO_SMTP_KEY и поручает заполнить SMTP-настройки. Public transactional mail использует Brevo SMTP smtp-relay.brevo.com:587 с обязательным STARTTLS и подтверждённым sender; API-key не является SMTP-key. Local/test Mailpit SMTP сохраняется, оба external keys вtests очищаются. Verified sender, authentication иdelivery отдельные факты; никаких настоящихписем отoffline/unit/integrationchecks.

Dispatch02.1: server worker владеет src/features/identity/server/, domain/, contracts.ts, index.ts, tests/identity/server/, tests/identity/domain/ и исключительным loan src/server/db/identity-schema.ts + migrations/0003_identity.sql. UI worker владеет src/features/identity/ui/, locales/, tests/identity/ui/. MAIN владеет app routes/config/package/root schema re-export. Workers согласуют typed transport через contracts.ts; основной auth endpoint Better Auth /api/auth/*, прикладной identity endpoint /api/identity/*. Никаких дублирующих permission models. Параллельное исполнение внутри утверждённой задачи, зависимости следующих задач не снимаются.

### 02.1.1 Аккаунт и возврат в работу
Status: done

HTTP cookie/session lifecycle, verification/reset через Mailpit API, invalid/expired/replayed token rejection; reload same owner. Local flag не даёт полномочий.

Промежуточный handover server/domain: Better Auth и 7 identity tables, verified-email gate, single-use verification receipt, reset/change password, session expiry/revoke/logout, profile locale, origin/body guards, persistent rate limits и opaque 24h browser-bound intent. Optional X-Tirlik-User-Id отклоняет stale-account запрос до эффекта. TypeScript/scoped ESLint, 10 focused unit tests и 18 real HTTP/PostgreSQL/Mailpit integration tests PASS. MAIN применил финальную migration0003 к локальной базе без потери данных, подключил thin API и auth/settings routes, общий provider и server account locale. UI handover и общая проверка ещё ожидаются; поэтому checkpoint active. Brevo delivery и visual QA не подтверждены. Временный /app ведёт в доступные /settings с сохранением opaque intent; настоящий /app/work появится03.2, это не имитация рабочего раздела.

UI handover: 59 focused tests / 6 files, TypeScript и scoped ESLint PASS. Реальные forms/modal/verify/reset/profile/password/sessions/logout, account menu, typed transport, locale persistence и stale/abort guards. Guest entry ссылки доступны сразу в SSR, settings не содержит перехода в несуществующую работу. MAIN подключил все pages, no-referrer metadata email links и дополнительные HTTP проверки границ. Оба workers STOP для интегрированного checkpoint; task02.1 ещё требует приглашения/права/удаление из02.1.2. Внешний вид, focus, touch и фактическое поведение UI проверяет пользователь.

Принято: штатный checkpoint 9d98ac9fc99a12d530311a95ac6625d6c36450f6, все 7 checks PASS, pushed origin/main. Сборка и общие type/lint/unit/domain/locale checks успешны; изолированный HTTP/DB/Mailpit прогон включает mounted pages, отсутствие создания аккаунта при GET, no-referrer token pages и server account locale на другом устройстве. Source/core identity handover завершён; визуальная проверка пользователя остаётся отдельной.

### 02.1.2 Приглашение и отзыв прав
Status: done

Invite/role change/revoke increments authzVersion и blocks jobs/downloads. Guessed IDs/CSRF denied, last owner не оставляет workspace без владельца. User проверяет modal/focus/return.

Account deletion по C6: перенос роли владельца или явное удаление его workspace; остальные участники не теряют данные молча. Backend блокирует эффекты и доступ немедленно, cleanup/backup tombstones проверяются11.2, не обещается мгновенное стирание уже существующей резервной копии.

Release после9d98ac9f: foundation продолжает server/domain/contracts/tests и identity-schema, новый exclusive loan migrations/0004_identity_workspaces.sql. Migration0003 immutable. UI worker продолжает свои UI/locales/tests; typed transport согласует с foundation. MAIN app routes, root schema registry и migrations execution. Пакет включает полный workspace/membership/invite/ownership/delete lifecycle с transactional authorization helper для следующих модулей; не имитировать ещё не существующие jobs/downloads, но дать им проверяемый общий guard и authzVersion.

Ранний законченный handover: additive migration0004, Drizzle schema, typed team/delete contracts и отдельные domain/DB constraints tests. Добавлены шесть таблиц и deletion timestamp пользователя; active workspace требует owner, project grants требуют membership, удаление хранит tombstones, приглашения имеют single-use/TTL/delivery fencing поля. TypeScript/scoped ESLint и5 новых contract/DB tests плюс изолированный общий integration PASS. Эти пять файлов переданы MAIN immutable; незавершённые access/operations и UI не входят в промежуточный checkpoint. Полный02.1.2 остаётся active, mounted account handlers пока не используют новые таблицы.

Промежуточный checkpoint3307ae5b5c4a17d03bba5aa84ef9e694d0ded890 pushed origin/main, все7 checks PASS. MAIN применил0004 только локально штатным stop/start, данные/порт сохранены, health200/database ready. Writers release на оставшиеся handlers/UI; весь02.1.2 ещё не принят.

Серверный handover 2026-10-14: foundation STOP, пути переданы MAIN. Workspace create/list/team, email-bound single-use invites с TTL/revoke/resend и delivery lease, membership scopes и transfer/last-owner, authzVersion fencing и ownership-safe account deletion подключены к реальному identity handler. `withWorkspaceAccess` экспортирует транзакционный guard для следующих модулей; project access пока требует явный grant и не подменяет будущую проверку Project storage. TypeScript, scoped ESLint, 16 focused unit tests и полный повторный isolated HTTP/PostgreSQL/Mailpit прогон PASS. Cookies и private intent очищаются после удаления; старые backup не объявляются стёртыми. UI handover и общий checkpoint ещё впереди.

MAIN подключил team/invitation pages, сохраняет workspace query при входе, отвергает malformed/duplicate selection без открытия другого workspace. Неизвестный маршрут возвращает локализованный HTTP404; неправильный фильтр существующей страницы показывает recovery с выбором пространства. Local HTTP и общий integration PASS, typecheck и 37 navigation/locale/control/token tests PASS. Visual/keyboard/mobile поведение не проверялось агентами.

UI handover: worker STOP, все UI/locales/tests paths переданы MAIN. Реализованы workspace create/select, server-owned role/scope inventory и подтверждение изменений, приглашения/delivery states, приватный invitation preview с явным accept, ownership-safe deletion choices/password/consent, refresh при изменённых правах и проверка неопределённого результата удаления. Возврат гостя сохраняет выбранное пространство; смена аккаунта очищает private tree, повторный вход того же человека не отправляет прежнюю команду автоматически. TypeScript/scoped ESLint и107 UI state/transport/locale tests в10 файлах PASS. Общий checkpoint со сборкой ожидается; F001/F002 не закрыты визуально.

Принято02.1: checkpoint a0f110c1654e2af4d0075770170788e06e70cc88, все7 configured checks PASS, pushed origin/main. Проверены общая сборка, type/lint/unit/domain/locale и настоящий изолированный HTTP/PostgreSQL/Mailpit путь, включая mounted pages. Полная задача02.1 завершена по невизуальным acceptance; user visual review и фактическая Brevo delivery остаются отдельными непроверенными границами. Все writer paths возвращены MAIN.

После нового UI/UX поручения2026-10-14 назначен свежий interface_quality для цельного refinement действующих account/team/recovery pages и общих controls по F002. Полное read-only изучение исходных требований/Design/references завершено; после9051568 выдан write release на цельный пакет, exclusive paths в STATE. Не менять серверные контракты и не выдавать временный вход за landing10.1. Прежняя невизуальная приёмка остаётся фактом, новые изменения потребуют собственной проверки и пользовательской визуальной оценки.

Первый refinement handoverA:23files shared controls/header/auth/recovery/account menu,16files/167focused tests, scoped lint и diff-check PASS; реальные существующие routes потребляют компоненты. При source review integration обнаружил privacy blocker: после подтверждённого401 SettingsPage/TeamSettingsPage могут продолжать отображать прежние private metadata, хотя server effects уже запрещены. Interface_quality возобновил только bounded A+privacy fix: unmount/cancel private tree, scoped401, same-user guarded recovery без replay и discard при другом пользователе, с регрессиями. Это обязательное исправление до ближайшего checkpoint, не косметическаяB/C. До проверки исправления stage не выдаёт прежний167test результат за доказательство устранения дефекта.

После исправлений A+privacy принят integration:34paths,18files/192focused tests, scoped lint и SSR HTTP PASS. Подтверждённый401 удаляет private tree и отменяет запросы; epoch меняется и при новом session.id того же пользователя; non-password RAM draft возвращается только тому же человеку по явному действию, другой аккаунт его не получает. Сохранены неопределённый результат удаления и защита preference preflight. Public entry ссылки присутствуют в SSR. Весь пакет STOP для общего checkpoint; B/C composition ещё впереди. Это source/state/HTTP evidence, не пользовательская visual acceptance F002.

Принятый A+privacy сохранён checkpoint37d4bd53177a0bfa90a1290c10d6a2451dd90c92, все7checks PASS, pushed origin/main. Interface_quality release на весь оставшийсяB/C пакет действующих settings/team/deletion/recovery screens в прежних paths с полными Design/reference требованиями. Новые публичные component contracts согласуются с потребителями; F002 остаётся in-progress, landing10.1 не подменён.

## 02.2 Управлять длительными задачами, ценой и отказами моделей
Status: active
Requirements: R14, R17, R42, R43, R56, R83, R86, R96, R105
Depends on: 02.1
Owner: /root/agent_execution
Paths: src/features/runs/, tests/runs/, src/contracts/runs.ts, src/server/db/run-schema.ts, migrations/0007_runtime_budget.sql, src/app/api/runs/, src/app/app/runs/, scripts/eval-live.mjs

Два P2 из independent runtime_execution_review исправлены и приняты integration: штатный price refresh сохраняет exact endpoint proof и ledger; waiting_input/retryablefailed наблюдаются bounded idle polling и получают remote resume/cancel.33 unit, scoped lint/typecheck и новый focused SQL price-refresh case PASS. Полный mounted HTTP/live runtime acceptance остаётся02.2.2; это не заявление о готовой модели.

После восстановлениялимита ownership передан свежему runtime_delivery сhigh reasoning по прямому пожеланию пользователя, прежний preflight недоступен. Integration_delivery восстановил local dev и принял additive0007 без budgetactivation;0007 теперь применена и immutable. Сохранить текущий WIP и завершить весь runtime вместе с реальными pages/API, не начать ещёодну схему заново. Open review findings ниже актуальны до фактической перепроверки. Исторические statements о неприменённой0007 не являются текущим состоянием.

Локальный допуск: capability gate01.4.1 принят с ограничениями C14; отложенный по указанию пользователя remote01.4.2 не блокирует локальную реализацию. Облачную durability не объявлять доказанной. Старый Mimo истекает2026-10-21, metadata кандидата не заменяет реальный proof; live calls только с действующим явным budget/разрешением, ambiguous ledger не повторять.

Dispatch после a0f110c: preflight владеет целым runtime package02.2, включая feature UI/locales и tests, а также явно выданными runs contract/schema/migration paths. Общие schema/contract index, routes/config/package и memory остаются MAIN. Существующих Run/Step/Usage declarations в src/contracts пока нет: создать единственные typed declarations в runs.ts, переиспользуя общие ID/errors/permissions. 0001-0004 immutable;0005 зарезервирована для03.1, runtime использует0006. Перед mounted handlers нужен ранний целостный schema/contract handover и local migration MAIN. Реальные paid calls, remote hosting/deploy и изменение env сейчас не разрешены; закончить всю локально проверяемую часть, не выдавая fault injection за live proof02.2.2.

Разрешение пользователя 2026-10-14 после dispatch: «Да, разрешаю до $0.30» на полный вопрос о двух synthetic запросах к MiMo2.6 Flash после готовности локального runtime, без повторов и Vercel. Это разрешает только конкретный bounded proof C14, не произвольные paid calls. MAIN отдельно release выполнение после проверки реализации/цены/резервирования; ранний implementation packet пока работает offline. Remote hosting/deploy всё ещё отложены.

Новое разрешение того же дня заменяет предыдущий узкий лимит: общий максимум $10 новых расходов OpenRouter для автономной работы над всем продуктом, экономичные non-top модели допустимы. Runtime должен дать единый точный учёт, current price/capability check, reservations и сохранение ambiguous charges; proof выполнять после готовности этого пути, не обходным скриптом. Каждый запрос в пределах общего выделения не требует нового пользовательского подтверждения. Только локально, hosting search/deploy/probes запрещены по свежему ответу. Feature worker получает собственные реальные runtime routes/pages; общий root integration у integration agent.

**Контракт и результат.** C3-C4, C8, C11-C12. Run/Receipt/Usage используют общие схемы01.1 и identity02.1, не требуют готового редактора03.1. Платный импорт первым подключает этот runtime; artifact adapters включаются позже с тем же idempotent effect protocol. Durable Run/Step/ToolReceipt/Usage ledger with Workflow adapter and DB authority. Claim lease+epoch fencing, idempotent tool receipt by run/step/call/inputhash, cancel/resume terminal rules. Atomic estimated worst-case reservation before provider call, priceTTL/max_tokens and daily workspace/deployment caps C8. Allowlisted economical text/vision/image model endpoints, no forbidden provider fallback. Ambiguous paid timeout retains reservation until reconcile, not blind retry; bounded safe retry. Concurrency fairness limits across tenants, restore pending work after process death/redeploy.

**Вход в работу и состояния.** Task progress names actual stages/tools and produced results, never pretend internal thoughts. Stop, retry failed step, resume from saved partial; cost/limit explanation localized. No key/provider failure leaves manual editors usable and result drafts intact. Run SSE reconnect cursor is progress, not job persistence.

### 02.2.1 Durable state и бюджет
Status: done

Concurrency tests overspend race, duplicate tool, lease expiry/stale worker, cancelled job cannot write, forbidden models denied and unknown price blocked. Usage totals independently reconciled.

Independent acceptance2026-10-14 после8b1b864:32 SQL плюс unit evidence закрывают lease/epoch/checkpoints, queued expiry/recovery, cancellation, durable receipts, exact reserve/settlement/quarantine, single active grant/key binding и запрет blind uncertain retry. Новый price-refresh SQL PASS сохраняет proof/ledger. Durable state/budget boundary02.2.1 done; provider availability и реальный live/HTTP путь остаются02.2.2. Runtime source ещё ждёт собственного coherent Gitcheckpoint, core8b1b864 его не включал.

Ранний frozen handover:0006/run-schema/runs contracts/exactUSD/domain limits, type/lint иfocused contracts PASS. Integration выявил и owner исправил finite numeric guards противPostgreSQL NaN и согласованность cached/input token nullable fields;7SQL cases включаяtenantFK выполняются вместе с0005. Shared exports40tables smokePASS,19core contractsPASS. Это foundation, не полный durable runtime/budget acceptance; общий$10authorization ledger запланирован следующей additive0007 после checkpoint, реальные calls до него запрещены.

Общий runner9files/45tests PASS, включая7runtime SQL cases; primary local journal0001-0006/health ready подтверждены после штатного stop/start. Все writers STOP для общего foundation commit.02.2.1 остаётся active: executable runtime/ledger/queue/workflow/API/UI и live proof ещё впереди.

Foundation checkpoint9051568e4fb1eb802e9963ec1d15ef2bba488519 принят и pushed origin/main, все7configured checks PASS. Preflight release на весь оставшийся02.2, включая реальные API/run pages и единый$10authorization ledger новой0007;0006 immutable. Integration получает source review/adapter boundaries/local lifecycle и самостоятельно проверяет readiness перед synthetic live proof. После подтверждения цены, бюджетного reserve и offline failure tests preflight исполняет bounded proof через runtime; MAIN не читает и не реализует feature code. Финальный02.2 acceptance требует фактических результатов, не early schemas.

Следующий runtime-core handover передан в STOP: additive0007, typed registry и tool checkpoints, service/queue/cancel fencing, точный grant/day/run accounting и text/vision gateway. Typecheck, scoped lint и12 unit tests PASS. Integration читает код и запускает настоящую изолированную SQL concurrency/recovery suite; SQL ещё не принят и к основной локальной БД не применён. Бюджет не активирован, платных обращений нет. Workflow/API/pages и полноценный02.2 acceptance остаются впереди.

Paid-readiness boundary: legacy scripts/preflight/live.mjs --execute использует прежний file ledger, поэтому integration получил отдельный loan для fail-closed retirement этого executable пути и focused regression test. Metadata-only сведения и прежние receipt/ambiguous evidence сохраняются. Новые платные запросы разрешаются только через общий runtime DB ledger; наличие старого working proof script не является обходным разрешением тратить бюджет.

Legacy retirement принят integration:2paths/6focused tests/lint PASS; runLive отклоняется до credentials/metadata/files, CLI --execute запрещён и вместе с --metadata-only. Старые receipts/correction lock/provider metadata не изменены, реальных provider calls не было. Это включается в текущий checkpoint отдельно от незавершённого runtime core.

Runtime core после нескольких bounded safety repairs снова STOP:15unit/type/lint PASS, новая logical model-operation identity отделена от attempt/epoch и replay предшествует свежему pricing. Последний29case SQL набор ещё должен пройти на этом snapshot. Source review оставил три обязательных follow-up: независимый approved-model/endpoint и persistent registry gate, authoritative over-quote settlement до ошибки без model output, bounded recovery sweep для resumed queued runs с истёкшим lifetime. Исправления только после общего checkpoint release.0007 не применяется к primary DB, grant inactive, paid calls отсутствуют; Workflow/API/pages и полная02.2 остаются впереди.

Общий checkpoint остановлен на integration check:66passed/1failed в10files. В runtime suite21/22 PASS; тест uncooperative prepare/timed-out effect завис на30s. Первые6configured checks PASS, commit/push не attempted. MAIN разрешил preflight/integration только bounded diagnosis/repair и focused SQL regression; остальные review fixes ждут release. Увеличение timeout или исключение случая не считается исправлением. После STOP повторяется штатный helper; runtime всё ещё не принят и не входит в выбранный51path commit.

Узкая repair принята integration: изменён только tests/runs/runtime.integration.test.ts.25ms deadline мог истечь до execute, оставляя ожидаемый test callback неустановленным; deterministic entry barriers/clock подтверждают оба сценария без увеличения25ms deadline/30s timeout. Падавший случай3/3 PASS, затем full runtime SQL2files/29tests PASS с fresh isolated migration/seed и cleanup. Отдельный pg warning локализован в pagination Promise.all(snapshot) на одном PoolClient и не является причиной hang; исправление отложено к полному runtime пакету. Все writers снова STOP для повторного helper с прежним51path scope.

Повтор helper завершён PASS по всем7checks;37d4bd53177a0bfa90a1290c10d6a2451dd90c92 pushed origin/main. В02.2 из него принят только legacy paid-path retirement, runtime WIP не закоммичен и не признан готовым. Preflight/integration RELEASE на все перечисленные review fixes и полный Workflow/API/run-page пакет. Integration может самостоятельно принять исправления, применить0007 после её окончательного handover, затем проверить readiness перед bounded synthetic live proof в общем$10ledger. MAIN не читает feature code; новые hosting операции не разрешены.

### 02.2.2 Реальные сбои и восстановление
Status: active

Live bounded call then simulated network/process interruption, replay receipts without duplicate persisted effects. HTTP events reconnect and permissions revoke; missing key honestly unavailable. На этой foundation-задаче effect fixture использует Run/Receipt; артефактный adapter подключается04.1 и проверяется04.2, когда уже готов03.1.

Fresh official inspect2026-10-14 обнаружил status=-2 у прежнего exact deepinfra/fp8 endpoint MiMo2.6 Flash. Gate отказал до candidate/grant/provider call, новых расходов0; старый confirmed0.0400707/unresolved0.480832 сохранён. Integration/runtime отдельно проверяют другой экономичный exact endpoint по новому общему разрешению$10; это explicit allowlist review и новый bounded proof, не automatic fallback/перенос старого proof. Пока live acceptance не заявлена, offline/mounted HTTP работа продолжается.


## 02.3 Сохранить оригиналы файлов и извлечь проверяемые источники
Status: active
Requirements: R10, R14, R16, R25, R39, R42, R43, R76, R105
Depends on: 02.1
Owner: /root/sources_finish
Paths: src/features/sources/, tests/sources/, src/contracts/sources.ts, src/server/db/source-schema.ts, src/server/db/source-ingestion-schema.ts, src/server/db/source-asset-schema.ts, migrations/0008_sources.sql, migrations/0010_source_assets.sql, migrations/0012_source_visual_assets.sql, migrations/0012_source_visual_assets.sql.draft, src/app/api/sources/, src/app/app/materials/add/

Canonical fonts/image metadata для06.1 остаются у source owner, не в отдельном design store. Зарезервирована additive0012_source_visual_assets.sql: до stable handover только.sql.draft,0001..0010 immutable. Утверждён bounded TTF/OTF/WOFF subset без WOFF2/collections,5MB input/20MB decompressed, parsed metadata и OS/2 flags отдельно от explicit license permission; unknown не exportable. fontkit2.0.4 direct/types устанавливает integration после proof window. Source visible checkpoint не ждёт всех fonts/OCR; server asset ACL согласуется с artifact/design owners.

0008 применена и immutable. Следующая source migration0010_source_assets.sql и source-asset-schema принадлежат source_delivery для canonical SourceVersion embedded images, необходимых полноценному DOCX import.0009_workspace_views.sql отдельно workspace owner, reviewed/STOP и проверяется в isolated suite; primary application0009 затем0010 только после stable handover, не менять номера задним числом.

Дополнительный точный route loan: `src/app/app/materials/sources/[sourceId]/` исключительно source_delivery. Next dynamic routes перечислены здесь буквально, поскольку check-plan трактует квадратные скобки как glob; MAIN отдельно сверяет их со всеми active loans. По новому приоритету пользователя local upload/paste/parsing начинается на принятой SourceHeads/Project boundary параллельно02.2. Финальная приёмка02.3, OCR/vision и любые платные действия требуют интегрированного runtime02.2 и общего budget ledger; ослабления этих условий нет.

Новое поручение ускорить основные функции2026-10-14: весь intake пакет начинается сейчас с готовых canonical SourceHeads/Project и неплатных originals/upload/paste/parsers. Artifact_delivery подтвердил STOP и передачу source-heads.ts/source-schema.ts. Full02.3 acceptance остаётся после runtime02.2 integration; OCR/vision не обходят ledger/readiness и не имитируются. Fresh source_delivery сhigh reasoning получает реальные API/pages и0008 sidecars, не только parser components. Старый read-only prep ниже используется как packet, не причина ожидать независимую UI работу соседнего пакета.

Локальная реализация использует принятые format/capability limits01.4.1; remote storage/hosting acceptance01.4.2 остаётся обязательной перед cloud release, но отложена по указанию пользователя. OCR не обходит runtime budget или live-proof ограничения02.2.

Подготовительное чтение02.3: новый /root/source_ingestion, Paths:none. Предыдущий foundation prep остановился без результата. Новый самостоятельный feature owner читает полный исходный BRIEF/TESTING/Design и контракты, existing fixtures/parsers/storage proof и новые source-head declarations; согласует с runtime owner необходимые интерфейсы. Возвращает цельный implementation packet без реализации, SQL/keys/paid calls. После принятия02.2 получает целиком upload/extraction/UI/API/pages, не только отдельные parser components. Это не снятие зависимости и не перенос задачи MAIN.

Read-only prep source_ingestion завершён: полный packet прочитан, код/env/deps/память не менялись, расходы$0. Предложен целый02.3 с immutable local storage/init/PUT/finalize/download, extraction manifests/chunks/provenance, bounded previews, DOCX/PDF/image runtime page ledger и source add/detail pages. Candidate whole-path loans после readiness: src/contracts/sources.ts, src/server/db/source-ingestion-schema.ts, migrations/0008_sources.sql, src/app/api/sources/, src/app/app/materials/add/, src/app/app/materials/sources/[sourceId]/. Source-heads передаются только после server owner handover. Дополнительные прямые parser dependencies ставит integration по проверенной необходимости; подготовка не снимает02.2 и не запускает платные обращения.

Точный runtime adapter handoff от preflight, ещё ожидающий текущую core приёмку: `ToolContext.checkpoint({key,inputHash,effect(tx,currentContext)->{context,resultRefs?}})` доступен только в prepare, максимум40 milestones/step. Каждый checkpoint заново проверяет authz/epoch/lease/deadline; effect/context/receipt атомарны, replay пропускает effect. SourceRunInputRef.id означает sourceId с revision, не sourceVersionId. Для pending extraction используются inputRefs:[] и private reservedSourceVersionId в context после авторизации источника. /app/runs list принимает optional projectId и возвращает {runs,nextCursor} со стабильной tuple pagination. При release02.3 передать эти детали целиком и сверить принятый API; source не записывает run tables напрямую и не создаёт второй executor.

**Контракт и результат.** C3-C5, C8, C12. Private uploads init/finalize, immutable final key после bytes/magic/size/hash; staging PUT не меняет finalized content. CSV/TSV/XLSX/DOCX/text PDF/PNG/JPEG/WebP/paste по C5; scan PDF page vision с review flags. Любой платный vision/OCR использует Run/Usage reservation02.2, отдельного неограниченного parser key path нет. Пустой text PDF не вызывает все100 страниц модели без расчёта бюджета. Fragments file/page/row/cell, версии/diagnostics. Bounded stream/zip/images, safe HTML/XML, macros/external formulas disabled; download rechecks ACL. Interrupted upload retry без двойного ready source; удаление учитывает dependencies/retention.

**Вход в работу и состояния.** Материалы -> «Добавить»: drop/picker/paste, per-file progress/cancel и точные diagnostics. Unsupported/encrypted/oversized сохраняют текст задачи, не объявляют partial import complete. Raw fragment рядом с извлечённым значением; phone sequential pane.

### 02.3.1 Защищённые оригиналы
Status: done

Storage prove finalize/reused token attack denied, ACL/hash mismatch/interruption/oversize/cleanup. sourceId/versionId и job progress, не base64 в БД.

Independent acceptance2026-10-14:7SQL+1полныйHTTP PASS для настоящегоCSV upload→preview→byte-identical original, init/finalize idempotency, staging token/reuse, parsefailure сохраняет прежнийhead, cancellation, ACL/archive/revoke/CSRF/session expiry и corrupt storedoriginal hash mismatch. Owner8storage/parser tests включают oversize/undersize/pathtraversal иdifferentbytes samekey denial; отдельный frozen regression interrupted stream cleanup/retry также PASS. Все точные protectedoriginals acceptance закрыты,02.3.1done;0001..0010 primary applied/immutable. ВесьOCR/fullformats/02.3 остаётсяactive, source feature ещё ждёт своего coherent Gitcheckpoint.

### 02.3.2 Разбор с источниками и потерями
Status: active

Golden все форматы, русский/казахский, multiple sheets, scan/malicious archive. Факты цитируют fragments, спорные числа needs-review. Download original hash equal.

## 02.4 Согласовать колонки, справочники и качество данных
Status: active
Requirements: R14, R16, R32, R34, R35, R36, R37, R39, R44, R45, R76, R92, R99, R103
Depends on: 02.1, 01.2, 01.3
Owner: /root/materials_finish
Paths: src/features/materials/, tests/materials/, src/contracts/materials.ts, src/server/db/material-schema.ts, migrations/0011_material_collections.sql, migrations/0011_material_collections.sql.draft, src/app/api/materials/

По приоритету основного функционала2026-10-14 вход разрешён на независимо принятом02.3.1 immutable originals/SourceVersion/CSVpreview boundary. Source owner подтвердил stable contracts CSV/TSV/paste; все chunks, raw values, координаты и pinned version обязательны. Полная02.4 acceptance по-прежнему требует всей02.3, включая остальные форматы/OCR; это условие начала независимой mapping/library реализации, не сокращение финального результата. Fresh materials_delivery сначала читает весь BRIEF/TESTING/Design/reference packet во время текущего GLOBALSTOP, пишет только после release MAIN.

Точные route loans: `src/app/app/materials/page.tsx` и `src/app/app/materials/collections/[collectionId]/` принадлежат materials_delivery. `add/` и `sources/[sourceId]/` остаются source_delivery; никаких параллельных writer в parent subtree.0011_material_collections.sql зарезервирована, применение/общие exports у integration после stable handover. Canonical pinned-source adapter запрашивать source owner, не заводить второе source storage/registry.

После8b1b864/all9checks PASS owner RELEASE на весь02.4. Полный обязательный packet прочитан, source-owned readPinnedSource/readPinnedSourceChunk и librarySQLpagination/facets согласованы; document bound facts и workspace→filtered library используют тот же exact source reference. Промежуточная model/mapping/SQL boundary передаётся coherent package соSTOP, затем полная library/reimport UI, не остановка на pure functions.

**Контракт и результат.** C3-C5, C9. Mapping к stable column IDs: date/decimal/unit/currency, duplicate candidates/conflicts. Versioned MappingRule подтверждает человек; schema drift queues unmatched columns; unknown != zero, returns != sales. Paginated validated search/query, debounce отменяет stale request; totals с coverage/exclusions. Тип catalog/prices/history/brand/general optional, не ограничение отрасли. Корректировка Fact отдельно от immutable original.

**Вход в работу и состояния.** Материалы: dataset table, photos thumbnails, search/type/date. Import sample rows с mapping/exceptions; «Применить сопоставление» показывает affected counts. Явно выбрать SourceCollection, режим replace-snapshot/append/upsert и recordKeySpec по C5. Preview показывает added/changed/unchanged/missing/ambiguous до записи. Selected bulk resolution с preview/undo; phone сохраняет row/column names. Можно использовать валидную часть без разметки всех колонок; неразрешённые записи не обновляют связанные материалы.

### 02.4.1 Сопоставление и неизвестное
Status: active

Partial2026-10-14: typed materials/mapping/import/dataset/facts DTO, mapping domain и collection prepare/preview/apply/partial/stable identities, dataset pages/aggregate server написаны;8 focused tests и typecheck PASS.0011 пока draft, SQL/API/facts corrections/undo и UI ещё не проверены, checkpoint остаётся active. Canonical pinned/library adapters согласованы с source owner, не используются latest100 fallback или вторая модель источников.

Golden decimal comma, KZT, units, plausible duplicates/conflicting prices без silent merge. Mapping reapplies только при совместимой схеме. RecordIdentity/ResolutionVersion сохраняют stable recordId и fieldId между файлами независимо от порядка строк. Проверить перестановку без изменений, тот же файл, пересекающиеся периоды, одну новую цену, переименование без ключа и удалённую позицию. Replace missing только для полного подтверждённого snapshot; append overlap не удваивает продажи; upsert absence ничего не удаляет. Старые raw fragments и версии доступны.

### 02.4.2 Библиотека и повторный импорт
Status: todo

Actual paging/search API/ACL и 100k CSV не целиком в память; retry retains selections. Reimport new version/diff, прошлые outputs неизменны. User checks mobile/scanning.

