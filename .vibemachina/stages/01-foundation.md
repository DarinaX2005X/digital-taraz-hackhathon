# 01 Общий контракт, воспроизводимый запуск и предметная основа
Status: todo

Закрепляем единые данные и правила, чтобы дальнейшие части действительно соединялись. Это основание продукта, не отдельный демонстрационный сайт.

## 01.1 Закрепить контракты и поднять проверяемую среду
Status: todo
Requirements: R18, R42, R50, R51, R53, R54, R55, R58, R59, R60, R63, R64, R74, R79, R81, R85, R87, R88, R89
Depends on: none
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: package.json, pnpm-lock.yaml, next.config.ts, tsconfig.json, eslint.config.mjs, vitest.config.ts, compose.yaml, .env.example, .gitignore, AGENTS.md, .github/, src/contracts/, src/server/db/, src/server/config/, src/server/http/, src/app/layout.tsx, src/app/api/health/, src/app/api/ready/, scripts/check/, scripts/dev/, scripts/checkpoint-check.mjs, tests/contracts/

Вход: утверждённые PROJECT C2-C8 и весь план; до утверждения не выполнять. Создать один Next/TS проект, pnpm lock, PostgreSQL+Mailpit Compose, env schema и scripts из C2. DTO ResourceDemand, Money, EvidenceRef, Revision, DomainError, Role, ToolResult живут в src/contracts; сериализация не содержит bigint JS. Drizzle schema registry и порядок migrations принадлежат этому контракту, feature workers получают отдельные schema-файлы, MAIN интегрирует snapshot/registry последовательно.

Проверить Vercel CLI connection/account read-only, доступность Workflows/Neon/Blob и почты; секреты только names/presence, не значения. Не активировать платные планы. Неуспешный доступ записать как конкретную внешнюю зависимость, остальная локальная работа продолжается. Реальные provider capabilities проверить в 03.1. В .vibemachina игнорируются runtime, BRIEF и TESTING, локальный checkpoint config находится в runtime; public scripts не зависят от личного skill path.

Общий API wrapper применяет auth context, JSON schema, requestId и C8 errors. Shared contracts включают WorkspaceEvent/cursor/resetRequired и связь membership/person-resource из PROJECT C5-C6, чтобы последующие workers не придумывали разные модели. Ни logs с PII, ни private cache глобально. Tests используют отдельную DB с явным URL safety check, не truncate рабочей базы. MAIN использует штатный skill scripts/checkpoint.mjs, а worker готовит только repository-contained scripts/checkpoint-check.mjs с реальными type/lint/domain/build checks; не писать новый Git wrapper. Локальный ignored checkpoint config MAIN указывает на этот checker. Установить no-browser-automation check в instructions всех workers.

Обязательный результат: одна команда node scripts/dev/start.mjs после prerequisites/env. Node-only bootstrap выполняет проверку инструментов/daemon/env, pinned install, именованный Compose/readiness, advisory-locked pending migrations, идемпотентные demo-only fixtures и запуск app/Workflow. Выбор порта безопасный, вывод содержит URL и readiness, не ключи. Повтор не удаляет data/volumes и не захватывает чужой сервер; известный экземпляр распознаётся по identity. Отсутствие Docker/pnpm объясняется конкретно, системный софт не устанавливается автоматически. Отдельные команды остаются для диагностики. На чистом checkout/volume и повторном запуске проверять именно этот runner, не ручную последовательность вместо него.

Готовность: на свежем volume migrations повторяемы, health/ready различаются при остановленной DB; unit serialization/time/currency, build, secret/ignore checks. UI здесь не критерий: downstream tasks получают работающие интерфейсы и migration protocol, а не заглушки готового сервиса.

### 01.1.1 Запуск и секреты
Status: todo

Зафиксировать версии, единый node scripts/dev/start.mjs, Docker volumes, env validation и readiness; чистый запуск и повтор не дублируют fixtures/миграции, restart сохраняет data. Missing prerequisite/failure без DB объясняются точно. MAIN получает рабочую основную команду и ports.

### 01.1.2 Общие типы и API-границы
Status: todo

Реализовать DTO/error/permission interfaces, decimal/time/revision contracts, test harness; pnpm check и tests/contracts без UI automation.

### 01.1.3 Передача общего владения
Status: todo

Проверить Git ignore/secret scan, single checkpoint flow, connection feasibility и актуальность plan coverage. Зафиксировать migration и route registry loans для следующих задач.

## 01.2 Выпустить айдентику и рабочие UI-примитивы
Status: todo
Requirements: R09, R31, R34, R39, R40, R44, R45, R46, R47, R48, R49, R61, R65, R87, R88
Depends on: 01.1
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: src/styles/, src/components/ui/, src/components/shell/, src/i18n/, public/brand/, public/fonts/, tests/ui-contracts/

Маршрутные адаптеры интегрирует MAIN последовательно: src/app/[locale]/layout.tsx. Worker реализует handlers/pages в своих feature-путях и передаёт exports/params/auth contract; прямой записи в shared route tree без выданного loan нет.

Прочитать DESIGN полностью и skill foundation/anti-slop/ux/system. Вход: T-mark proposal и точные tokens; выпуск color/mono/favicon, локальный Noto Sans с лицензией и cmap test ӘҒҚҢӨҰҮҺІ. Не выдавать XML/font validation за визуальный просмотр.

Собрать shell и доступные primitives на Radix: кнопка/icon tooltip, typed input+error+unit, searchable reference select, dialog, menu, tabs, checkbox, date/time wrapper, status, empty/error/skeleton, table toolbar и contextual evidence drawer. Stable dimensions и responsive shell по DESIGN, slots для feature content, не вставлять выдуманные показатели. Sidebar role-aware на основе authority DTO, server всё равно проверяет права.

Locale registry ru/kk/en загружает feature-owned каталоги без общей конфликтной простыни. Shell обеспечивает profile/help/language slots, same-object locale navigation и logout cache hook. Все интерактивные состояния/aria/labels, reduced motion, long text и 200% zoom constraints предусмотрены в CSS. Foundation demo test harness только unit DOM, не browser runner.

Приёмка: token contrast computed, font glyph coverage, translation parity, keyboard semantic component tests на DOM emulator, typecheck/build. Дать пользователю локальный путь для собственного просмотра после подключения auth/первого экрана; реальный rendering/keyboard остаётся непроверенным до его отзыва.

### 01.2.1 Фирменные материалы и токены
Status: todo

Выпустить оригинальный знак, favicon, шрифты/лицензию; тесты contrast/cmap/letter-spacing и responsive dimensions.

### 01.2.2 Контролы и оболочка
Status: todo

Реализовать states/accessibility contracts без бизнес-заглушек; unit tests для dialog focus contract, select IDs, form error associations.

### 01.2.3 Языки и передача feature workers
Status: todo

Проверить key parity и shell routes; каталог общих компонентов, точные props и user visual checklist передать MAIN.

## 01.3 Создать честные учебные материалы и контрольные результаты
Status: todo
Requirements: R01, R02, R04, R05, R07, R12, R13, R15, R75, R76, R82, R84, R87, R88
Depends on: 01.1
Owner: SUBAGENT назначается MAIN после утверждения плана
Paths: fixtures/, scripts/data/, tests/oracles/

Данных бизнеса нет и не будет до загрузок конечных пользователей. Создать собственные CSV/XLSX/PDF/text/image samples с явным synthetic происхождением и manifest: товары (10 lamps/6 kits C4), сервис (общие специалист+помещение), мастерская (материалы+время). Не выдавать их за рыночные данные Тараза и не ограничивать продукт этими отраслями.

Каждый набор содержит ground-truth нормализованные факты, expected errors, выполнимые/невыполнимые резервы, известные/неизвестные затраты, исправленную версию. Добавить дубликаты, неполный лист, decimal comma, kk glyphs, фото читаемого собственного документа, prompt-injection строку, неверный unit, zero capacity. PDF/изображение создаются документной библиотекой как тестовый вход, не рендером приложения.

Goal corpus включает свободные формулировки вне типового набора: фиксированная цена, неполные данные, 12 участников с общим оборудованием, разные цели на одних источниках. Oracle проверяет точные числа/constraints, rubric оценивает grounding/actions, не совпадение текста. Fixtures не создают personal records при старте или открытии landing.

Приёмка: manifest schema, source provenance, арифметика C4, детерминированные resource scenarios; seed command повторяем в demo/test namespace, отказывает production personal DB без явного режима. Начальные данные каждого теста изолированы.

### 01.3.1 Материалы и происхождение
Status: todo

Подготовить разнообразные файлы/manifest/expected extraction; проверить корректность стандартными parsers, не моделью, и synthetic маркировку.

### 01.3.2 Контроль механизма и свободных целей
Status: todo

Посчитать oracle outcomes и ограничения, negative/novel cases; unit tests запрещают невозможные комбинации и ложную прибыль.
