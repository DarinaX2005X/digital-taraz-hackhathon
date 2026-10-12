# 04 Рабочие панели, сравнение и совместная работа
Status: todo

Ранний путь расширяется до ежедневной работы: материалы и ресурсы можно поддерживать, варианты сравнивать и редактировать, участникам выдавать подходящие права.

## 04.1 Поддерживать бизнес: файлы, каталог и календарь
Status: todo
Requirements: R10, R25, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R44, R45, R76, R82, R87, R88
Depends on: 02.2, 02.3, 03.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/business-ui/, tests/business-ui/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/business/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

DESIGN+foundation+ux+anti-slop обязательны. /business/{sources,items,resources}: связанная библиотека с search/filter/sort/pagination, массовым выбором и контекстными commands. Источник -> preview sheet/page -> mapping -> diff before apply; отдельные row errors, изменённое поле показывает откуда и кем исправлено. Источник можно скачать/удалить с consequence confirm, загрузить новую версию, повторить failed extraction, не теряя успешные строки.

Каталог показывает товары/услуги, единицы, цену, completeness, связанные ресурсы; ресурс детализация с ledger/affected offers. Для staff/room capacity показывать calendar+agenda, recurring availability/date exceptions/duration/buffers, timezone labels; невозможные изменения объясняют затронутые брони. Resource references searchable typed select, inline create отдельный command, labels не подменяют ID.

Редактирование сохраняет revisions, 409 предлагает сравнить own draft с fresh record. Search debounce/cancel, cache invalidation across views, autosave честное. Archive used resource не удаляет истории. Mobile переключает плотную table в readable rows и календарь в agenda, primary/secondary/bulk actions остаются. Empty/partial/stale/invalid/no-permission/retry все локализованы.

Приёмка API через действующие services + unit render semantics (не browser): upload->correct->commit->find->edit->schedule exception->reopen; concurrency чужой правки и invalid units. Пользователь проверяет большие списки, date controls, keyboard/narrow и source readability.

### 04.1.1 Материалы и контролируемый импорт
Status: todo

Многофайловая queue, preview/mapping/diff/correction/partial retry, источник открывается по точной ссылке; API integration tests сохранения.

### 04.1.2 Каталог и расписание
Status: todo

Плотные предметные таблицы/agenda, формы единиц/ресурсов/исключений, conflict recovery и accessible controls.

### 04.1.3 Повторная работа и мобильный контур
Status: todo

Saved filters, immediate search, returns/source deletion/archives и affected-record feedback; locale parity и user checklist.

## 04.2 Сохранять, изменять и сравнивать варианты перед запуском
Status: todo
Requirements: R04, R10, R12, R13, R16, R25, R32, R33, R37, R38, R39, R40, R44, R45, R83, R84, R87, R88
Depends on: 03.3, 02.4
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/proposals/ui/, src/features/proposals/services/, tests/proposals/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/api/v1/workspaces/[workspaceId]/proposals/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

ProposalVersion domain 03.2 не переписывать без loan. UI mounted через workbench extension contract, own src/features/proposals/ui. Список версий и сравнение выбранных, состав/ресурсы/цена/известные затраты/terms, read-only evidence и редактируемые user fields. Пользователь закрепляет price/schedule/recipe constraints, просит новую формулировку свободно, может сохранить draft и продолжить позже.

«Проверить» вызывает общий exact simulation, сохраняет report+dependencyRevisionHash. Совместное сравнение вводит желаемые объёмы и показывает общую ёмкость/bottleneck, не суммирует альтернативы. Устаревшие source/resource hashes помечают report stale; сохранённый вариант остаётся читаемым, запуск блокирован до revalidation. Rename/duplicate/archive не теряют source links; duplicate получает новый ID, но не резерв/публикацию.

«Подготовить запуск» создаёт immutable ready package для05.1, включая editable customer text и fulfillment requirements; неизвестная essential price/capacity запрещает готовность, неизвестная себестоимость disclosure не выдаёт profit claim. Conflict 409 сохраняет draft; reject+retry AI не затирает user locks. Three locales; narrow comparison preserves all metrics по DESIGN.

Приёмка version lineage/locks/refresh/reopen/dedup, сценарий ламп+наборов и услуга room+staff, источник изменился во время approval preview. Unit API и domain assertions; user comparison readability.

### 04.2.1 Версии и точечное изменение
Status: todo

Services immutable lineage/draft state, editor/locks, recover stale revision; tests user edits survive regenerate.

### 04.2.2 Сопоставимое сравнение
Status: todo

Совместная simulation and aligned metrics/cost completeness, mobile альтернативное представление, exact expected totals.

### 04.2.3 Готовый пакет и передача публикации
Status: todo

Prepare/validate package, source hashes/terms/fulfillment rules, no hidden real reservation; handoff DTO и stale tests в05.1.

## 04.3 Настроить пространство, профиль и доступ сотрудника
Status: todo
Requirements: R11, R22, R23, R24, R25, R29, R34, R35, R39, R40, R44, R45, R87, R88
Depends on: 02.1, 03.3
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/features/settings/, tests/settings/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/app/settings/, src/app/api/v1/workspaces/[workspaceId]/members/, src/app/api/v1/workspaces/[workspaceId]/settings/. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Routes settings/profile/workspace/team; automation tab slot реализуется07.1. Profile name/email/password/locale, workspace name/currency/timezone/contact+fulfillment address. Смена business currency при существующих transactions не перекодирует суммы: либо новый workspace currency для новых contracts с явным warning, либо блок до compatible migration; текущие orders сохраняют currency/timezone snapshot. Calendar reconfiguration сообщает affected future slots.

Owner приглашает manager/staff по email одноразовым expiring token, resend/revoke, role change; last owner guard. Manager не повышает себя до owner, staff не читает financial/source данные. При принятии приглашения signin безопасно сохраняет intent, не открывает чужой workspace через client flags. No team step обязательного onboarding.

Формы имеют validation/unsaved/error/confirm/delivery states, все языки. Совместные вкладки/два managers edit 409, refresh membership сразу закрывает revoked access/cache. Опасное удаление workspace UI инициирует deletion service07.3 после явного name confirmation; до интеграции не имитировать завершение. Profile menu link wiring через MAIN shell loan.

Приёмка actual email via Mailpit API, invite expiry/reuse/revoke, role access matrix на каждом API и agent step, persisted locale/signout cleanup. Пользователь проверяет entry points и отсутствие лишних owner панелей у staff.

### 04.3.1 Профиль и контекст бизнеса
Status: todo

Server forms/revisions/locales/timezone/currency safeguards и возврат на текущий объект.

### 04.3.2 Приглашение и действующие права
Status: todo

Invite/delivery/accept/revoke roles, cross-tenant/last-owner/API tests, no mandatory team setup.

### 04.3.3 Ролевой интерфейс и последствия изменений
Status: todo

Profile menu/settings states, cache invalidation on role change, explicit destructive actions contract; human visual handoff.
