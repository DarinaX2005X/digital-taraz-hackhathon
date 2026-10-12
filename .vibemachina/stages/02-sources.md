# 02 Свои материалы и защищённое рабочее пространство
Status: todo

Бизнес начинает с того, что у него уже есть. Вход и загрузка не требуют переносить клиентов; система показывает, что поняла в файлах и где нужна проверка.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 02.1 Дать владельцу и приглашённому коллеге надёжный вход
Status: todo
Requirements: R11, R22, R23, R24, R25, R34, R39, R41, R43, R44, R45, R90
Depends on: 01.1, 01.2
Owner: SUBAGENT to assign
Paths: src/features/identity/, tests/identity/

**Контракт и результат.** C3-C4, C12. Better Auth signup/email verification/login/reset/expiry/logout, Workspace+Membership owner/editor/reviewer, invites single-use TTL, profile/session revocation. Default-deny scopes include approve/export/readconfidential; actor из сессии. returnTo local allowlist, сохранение goal draft как opaque intent, не содержимое в URL. Реальный SMTP и Mailpit local. Ошибки не перечисляют существующие аккаунты. MAIN owns auth route/schema, worker передаёт integration contract.

**Вход в работу и состояния.** «Войти» из public/demo/goal: dismissible dialog где уместно; emails через dedicated routes. Возврат к намерению без автоматического копирования demo. Profile menu language/profile/settings/sign out. Mobile forms stack; ru/kk/en ошибки сохраняют безопасный ввод, не пароль в storage.

### 02.1.1 Аккаунт и возврат в работу
Status: todo

HTTP cookie/session lifecycle, verification/reset через Mailpit API, invalid/expired/replayed token rejection; reload same owner. Local flag не даёт полномочий.

### 02.1.2 Приглашение и отзыв прав
Status: todo

Invite/role change/revoke increments authzVersion и blocks jobs/downloads. Guessed IDs/CSRF denied, last owner не оставляет workspace без владельца. User проверяет modal/focus/return.

## 02.2 Сохранить оригиналы файлов и извлечь проверяемые источники
Status: todo
Requirements: R10, R14, R16, R25, R39, R42, R43, R76, R105
Depends on: 02.1, 01.4
Owner: SUBAGENT to assign
Paths: src/features/sources/, tests/sources/

**Контракт и результат.** C3-C5, C12. Private uploads init/finalize, immutable final key после bytes/magic/size/hash; staging PUT не меняет finalized content. CSV/TSV/XLSX/DOCX/text PDF/PNG/JPEG/WebP/paste по C5; scan PDF page vision с review flags. Fragments file/page/row/cell, версии/diagnostics. Bounded stream/zip/images, safe HTML/XML, macros/external formulas disabled; download rechecks ACL. Interrupted upload retry без двойного ready source; удаление учитывает dependencies/retention.

**Вход в работу и состояния.** Материалы -> «Добавить»: drop/picker/paste, per-file progress/cancel и точные diagnostics. Unsupported/encrypted/oversized сохраняют текст задачи, не объявляют partial import complete. Raw fragment рядом с извлечённым значением; phone sequential pane.

### 02.2.1 Защищённые оригиналы
Status: todo

Storage prove finalize/reused token attack denied, ACL/hash mismatch/interruption/oversize/cleanup. sourceId/versionId и job progress, не base64 в БД.

### 02.2.2 Разбор с источниками и потерями
Status: todo

Golden все форматы, русский/казахский, multiple sheets, scan/malicious archive. Факты цитируют fragments, спорные числа needs-review. Download original hash equal.

## 02.3 Согласовать колонки, справочники и качество данных
Status: todo
Requirements: R14, R16, R32, R34, R35, R36, R37, R39, R44, R45, R76, R92, R99, R103
Depends on: 02.2, 01.2, 01.3
Owner: SUBAGENT to assign
Paths: src/features/materials/, tests/materials/

**Контракт и результат.** C3-C5, C9. Mapping к stable column IDs: date/decimal/unit/currency, duplicate candidates/conflicts. Versioned MappingRule подтверждает человек; schema drift queues unmatched columns; unknown != zero, returns != sales. Paginated validated search/query, debounce отменяет stale request; totals с coverage/exclusions. Тип catalog/prices/history/brand/general optional, не ограничение отрасли. Корректировка Fact отдельно от immutable original.

**Вход в работу и состояния.** Материалы: dataset table, photos thumbnails, search/type/date. Import sample rows с mapping/exceptions; «Применить сопоставление» показывает affected counts. Selected bulk resolution с preview/undo; phone сохраняет row/column names. Можно использовать валидную часть без разметки всех колонок.

### 02.3.1 Сопоставление и неизвестное
Status: todo

Golden decimal comma, KZT, units, plausible duplicates/conflicting prices без silent merge. Mapping reapplies только при совместимой схеме.

### 02.3.2 Библиотека и повторный импорт
Status: todo

Actual paging/search API/ACL и 100k CSV не целиком в память; retry retains selections. Reimport new version/diff, прошлые outputs неизменны. User checks mobile/scanning.

