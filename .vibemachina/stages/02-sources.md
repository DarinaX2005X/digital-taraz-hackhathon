# 02 Свои материалы и защищённое рабочее пространство
Status: active

Бизнес начинает с того, что у него уже есть. Вход и загрузка не требуют переносить клиентов; система показывает, что поняла в файлах и где нужна проверка.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 02.1 Дать владельцу и приглашённому коллеге надёжный вход
Status: active
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
Status: active

Invite/role change/revoke increments authzVersion и blocks jobs/downloads. Guessed IDs/CSRF denied, last owner не оставляет workspace без владельца. User проверяет modal/focus/return.

Account deletion по C6: перенос роли владельца или явное удаление его workspace; остальные участники не теряют данные молча. Backend блокирует эффекты и доступ немедленно, cleanup/backup tombstones проверяются11.2, не обещается мгновенное стирание уже существующей резервной копии.

Release после9d98ac9f: foundation продолжает server/domain/contracts/tests и identity-schema, новый exclusive loan migrations/0004_identity_workspaces.sql. Migration0003 immutable. UI worker продолжает свои UI/locales/tests; typed transport согласует с foundation. MAIN app routes, root schema registry и migrations execution. Пакет включает полный workspace/membership/invite/ownership/delete lifecycle с transactional authorization helper для следующих модулей; не имитировать ещё не существующие jobs/downloads, но дать им проверяемый общий guard и authzVersion.

Ранний законченный handover: additive migration0004, Drizzle schema, typed team/delete contracts и отдельные domain/DB constraints tests. Добавлены шесть таблиц и deletion timestamp пользователя; active workspace требует owner, project grants требуют membership, удаление хранит tombstones, приглашения имеют single-use/TTL/delivery fencing поля. TypeScript/scoped ESLint и5 новых contract/DB tests плюс изолированный общий integration PASS. Эти пять файлов переданы MAIN immutable; незавершённые access/operations и UI не входят в промежуточный checkpoint. Полный02.1.2 остаётся active, mounted account handlers пока не используют новые таблицы.

Промежуточный checkpoint3307ae5b5c4a17d03bba5aa84ef9e694d0ded890 pushed origin/main, все7 checks PASS. MAIN применил0004 только локально штатным stop/start, данные/порт сохранены, health200/database ready. Writers release на оставшиеся handlers/UI; весь02.1.2 ещё не принят.

Серверный handover 2026-10-14: foundation STOP, пути переданы MAIN. Workspace create/list/team, email-bound single-use invites с TTL/revoke/resend и delivery lease, membership scopes и transfer/last-owner, authzVersion fencing и ownership-safe account deletion подключены к реальному identity handler. `withWorkspaceAccess` экспортирует транзакционный guard для следующих модулей; project access пока требует явный grant и не подменяет будущую проверку Project storage. TypeScript, scoped ESLint, 16 focused unit tests и полный повторный isolated HTTP/PostgreSQL/Mailpit прогон PASS. Cookies и private intent очищаются после удаления; старые backup не объявляются стёртыми. UI handover и общий checkpoint ещё впереди.

MAIN подключил team/invitation pages, сохраняет workspace query при входе, отвергает malformed/duplicate selection без открытия другого workspace. Неизвестный маршрут возвращает локализованный HTTP404; неправильный фильтр существующей страницы показывает recovery с выбором пространства. Local HTTP и общий integration PASS, typecheck и 37 navigation/locale/control/token tests PASS. Visual/keyboard/mobile поведение не проверялось агентами.

UI handover: worker STOP, все UI/locales/tests paths переданы MAIN. Реализованы workspace create/select, server-owned role/scope inventory и подтверждение изменений, приглашения/delivery states, приватный invitation preview с явным accept, ownership-safe deletion choices/password/consent, refresh при изменённых правах и проверка неопределённого результата удаления. Возврат гостя сохраняет выбранное пространство; смена аккаунта очищает private tree, повторный вход того же человека не отправляет прежнюю команду автоматически. TypeScript/scoped ESLint и107 UI state/transport/locale tests в10 файлах PASS. Общий checkpoint со сборкой ожидается; F001/F002 не закрыты визуально.

## 02.2 Управлять длительными задачами, ценой и отказами моделей
Status: todo
Requirements: R14, R17, R42, R43, R56, R83, R86, R96, R105
Depends on: 02.1
Owner: SUBAGENT to assign
Paths: src/features/runs/, tests/runs/

Локальный допуск: capability gate01.4.1 принят с ограничениями C14; отложенный по указанию пользователя remote01.4.2 не блокирует локальную реализацию. Облачную durability не объявлять доказанной. Старый Mimo истекает2026-10-21, metadata кандидата не заменяет реальный proof; live calls только с действующим явным budget/разрешением, ambiguous ledger не повторять.

**Контракт и результат.** C3-C4, C8, C11-C12. Run/Receipt/Usage используют общие схемы01.1 и identity02.1, не требуют готового редактора03.1. Платный импорт первым подключает этот runtime; artifact adapters включаются позже с тем же idempotent effect protocol. Durable Run/Step/ToolReceipt/Usage ledger with Workflow adapter and DB authority. Claim lease+epoch fencing, idempotent tool receipt by run/step/call/inputhash, cancel/resume terminal rules. Atomic estimated worst-case reservation before provider call, priceTTL/max_tokens and daily workspace/deployment caps C8. Allowlisted economical text/vision/image model endpoints, no forbidden provider fallback. Ambiguous paid timeout retains reservation until reconcile, not blind retry; bounded safe retry. Concurrency fairness limits across tenants, restore pending work after process death/redeploy.

**Вход в работу и состояния.** Task progress names actual stages/tools and produced results, never pretend internal thoughts. Stop, retry failed step, resume from saved partial; cost/limit explanation localized. No key/provider failure leaves manual editors usable and result drafts intact. Run SSE reconnect cursor is progress, not job persistence.

### 02.2.1 Durable state и бюджет
Status: todo

Concurrency tests overspend race, duplicate tool, lease expiry/stale worker, cancelled job cannot write, forbidden models denied and unknown price blocked. Usage totals independently reconciled.

### 02.2.2 Реальные сбои и восстановление
Status: todo

Live bounded call then simulated network/process interruption, replay receipts without duplicate persisted effects. HTTP events reconnect and permissions revoke; missing key honestly unavailable. На этой foundation-задаче effect fixture использует Run/Receipt; артефактный adapter подключается04.1 и проверяется04.2, когда уже готов03.1.


## 02.3 Сохранить оригиналы файлов и извлечь проверяемые источники
Status: todo
Requirements: R10, R14, R16, R25, R39, R42, R43, R76, R105
Depends on: 02.1, 02.2
Owner: SUBAGENT to assign
Paths: src/features/sources/, tests/sources/

Локальная реализация использует принятые format/capability limits01.4.1; remote storage/hosting acceptance01.4.2 остаётся обязательной перед cloud release, но отложена по указанию пользователя. OCR не обходит runtime budget или live-proof ограничения02.2.

**Контракт и результат.** C3-C5, C8, C12. Private uploads init/finalize, immutable final key после bytes/magic/size/hash; staging PUT не меняет finalized content. CSV/TSV/XLSX/DOCX/text PDF/PNG/JPEG/WebP/paste по C5; scan PDF page vision с review flags. Любой платный vision/OCR использует Run/Usage reservation02.2, отдельного неограниченного parser key path нет. Пустой text PDF не вызывает все100 страниц модели без расчёта бюджета. Fragments file/page/row/cell, версии/diagnostics. Bounded stream/zip/images, safe HTML/XML, macros/external formulas disabled; download rechecks ACL. Interrupted upload retry без двойного ready source; удаление учитывает dependencies/retention.

**Вход в работу и состояния.** Материалы -> «Добавить»: drop/picker/paste, per-file progress/cancel и точные diagnostics. Unsupported/encrypted/oversized сохраняют текст задачи, не объявляют partial import complete. Raw fragment рядом с извлечённым значением; phone sequential pane.

### 02.3.1 Защищённые оригиналы
Status: todo

Storage prove finalize/reused token attack denied, ACL/hash mismatch/interruption/oversize/cleanup. sourceId/versionId и job progress, не base64 в БД.

### 02.3.2 Разбор с источниками и потерями
Status: todo

Golden все форматы, русский/казахский, multiple sheets, scan/malicious archive. Факты цитируют fragments, спорные числа needs-review. Download original hash equal.

## 02.4 Согласовать колонки, справочники и качество данных
Status: todo
Requirements: R14, R16, R32, R34, R35, R36, R37, R39, R44, R45, R76, R92, R99, R103
Depends on: 02.3, 01.2, 01.3
Owner: SUBAGENT to assign
Paths: src/features/materials/, tests/materials/

**Контракт и результат.** C3-C5, C9. Mapping к stable column IDs: date/decimal/unit/currency, duplicate candidates/conflicts. Versioned MappingRule подтверждает человек; schema drift queues unmatched columns; unknown != zero, returns != sales. Paginated validated search/query, debounce отменяет stale request; totals с coverage/exclusions. Тип catalog/prices/history/brand/general optional, не ограничение отрасли. Корректировка Fact отдельно от immutable original.

**Вход в работу и состояния.** Материалы: dataset table, photos thumbnails, search/type/date. Import sample rows с mapping/exceptions; «Применить сопоставление» показывает affected counts. Явно выбрать SourceCollection, режим replace-snapshot/append/upsert и recordKeySpec по C5. Preview показывает added/changed/unchanged/missing/ambiguous до записи. Selected bulk resolution с preview/undo; phone сохраняет row/column names. Можно использовать валидную часть без разметки всех колонок; неразрешённые записи не обновляют связанные материалы.

### 02.4.1 Сопоставление и неизвестное
Status: todo

Golden decimal comma, KZT, units, plausible duplicates/conflicting prices без silent merge. Mapping reapplies только при совместимой схеме. RecordIdentity/ResolutionVersion сохраняют stable recordId и fieldId между файлами независимо от порядка строк. Проверить перестановку без изменений, тот же файл, пересекающиеся периоды, одну новую цену, переименование без ключа и удалённую позицию. Replace missing только для полного подтверждённого snapshot; append overlap не удваивает продажи; upsert absence ничего не удаляет. Старые raw fragments и версии доступны.

### 02.4.2 Библиотека и повторный импорт
Status: todo

Actual paging/search API/ACL и 100k CSV не целиком в память; retry retains selections. Reimport new version/diff, прошлые outputs неизменны. User checks mobile/scanning.

