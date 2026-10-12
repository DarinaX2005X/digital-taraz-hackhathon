# 01 Проверяемая основа и ранние ограничения
Status: todo

Сначала проверяем, что выбранные редакторы, модели и размещение действительно подходят. Готовим повторяемый запуск, общие правила данных и реалистичные учебные материалы.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 01.1 Зафиксировать контракты и воспроизводимый запуск
Status: todo
Requirements: R18, R50, R51, R52, R53, R54, R55, R58, R59, R74, R77, R81, R87, R88, R89, R105
Depends on: none
Owner: SUBAGENT to assign
Paths: scripts/dev/, scripts/check.mjs, scripts/check-integration.mjs, scripts/check-build.mjs, tests/foundation/

**Контракт и результат.** C2-C4, C11. После явного approval MAIN фиксирует версию пакета, создаёт минимальный Next/TS каркас, shared contracts/schema/route registry и передаёт работнику только указанные пути. Одна команда start: проверка Node/Docker/env без печати значений, npm ci при смене lock hash, PostgreSQL/Mailpit health, advisory-lock migration, идемпотентный demo seed, свободный localhost-порт. stop останавливает только собственный процесс. Повторный запуск не стирает базу. Shared Money/Quantity, ArtifactEnvelope, Command, ошибки и capability registration из PROJECT интегрирует MAIN.

**Вход в работу и состояния.** Пока нет продуктового экрана: оператор получает адрес, причину недоступного Docker/порта и точную команду восстановления. Локальный запуск и проверки не зависят от VibeMachina; приватный checkpoint вызывает их снаружи.

### 01.1.1 Контракты, миграции и независимые проверки
Status: todo

MAIN принимает schemas и минимальный scaffold; worker проверяет CLI/env, отдельные test namespaces и типизированный error envelope. node scripts/check.mjs действительно исполняет type/lint/unit/locales/contracts, а не заглушку.

### 01.1.2 Повторяемый запуск без потери работы
Status: todo

start -> запись -> stop/start -> тот же UUID/значение; второй start не дублирует seed, занятый порт не захватывается. MAIN отдельно проверяет ignored secrets и штатный scoped checkpoint.

## 01.2 Собрать общие элементы понятного интерфейса
Status: todo
Requirements: R09, R31, R32, R33, R34, R38, R39, R40, R44, R45, R46, R47, R48, R49, R60, R101
Depends on: 01.1
Owner: SUBAGENT to assign
Paths: src/ui/, src/i18n/, public/brand/, public/fonts/, tests/ui-contracts/

**Контракт и результат.** C2, C4, DESIGN целиком. Токены, локальный Noto Sans с казахскими глифами, логотип/favicon, кнопки Lucide с tooltip/accessible name, поля label/unit/error, combobox, dialog, tabs, table frame, save-status, toast, skeleton, empty/error states. Каталоги ru/kk/en разделены по namespaces; feature worker владеет своим namespace внутри feature, shared dictionary здесь. Смена локали не перемонтирует несохранённый editor store; server cookie и explicit preference согласованы. Focus return, Escape без потери черновика, reduced motion, 44px touch targets, fixed toolbar dimensions.

**Вход в работу и состояния.** Элементы внутри будущих Работа/Материалы/Бизнес; не публичный каталог компонентов вместо сервиса. Компактные панели, белый лист, бирюзовое действие и коралловые акценты по DESIGN. На узком экране вторичная панель становится drawer.

### 01.2.1 Токены, шрифты и локали
Status: todo

Contrast calculation, наличие glyphs, parity ключей, fallback policy и отсутствие secret/client imports. Иконки и focus semantics проверяются по исходникам, внешний вид ещё не принят.

### 01.2.2 Рабочие состояния контролов
Status: todo

Unit reducer tests dialog/combobox/debounce/cancel и сохранение значения при locale switch. Типы и CSS constraints проходят check.mjs; пользователю список состояний для визуальной проверки.

## 01.3 Подготовить неоднородные материалы трёх бизнес-моделей
Status: todo
Requirements: R01, R02, R07, R15, R75, R76, R82, R99
Depends on: 01.1
Owner: SUBAGENT to assign
Paths: fixtures/business/, scripts/fixtures/, tests/fixtures/

**Контракт и результат.** C1, C5, C9, C13. Synthetic розница товаров для дома, сервисная компания и малое производство: истории операций, возвраты, прайсы с разными единицами/упаковками, запрос на предложение, собственные условия, бренд-набор и фото с проверенной лицензией. Manifest происхождения, ожидаемых сумм, противоречий, недостающих полей и контрольных изменений. Для прогноза достаточно длинный ряд с train/holdout, сезонностью и выбросами, не подмена фактической истории. Никаких реальных PII, фальшивых местных партнёров и обещаний прибыли.

**Вход в работу и состояния.** Позднее доступны явно как «Учебный пример». Файлы скачиваемы и загружаются тем же импортом, что материалы пользователя. Малый quick-start и большой stress набор разделены; пример не ограничивает свободную задачу.

### 01.3.1 Рабочие материалы и контрольные ответы
Status: todo

Генератор с seed, CSV/XLSX/DOCX/PDF/изображения, права на assets и manifest. Независимо вычислить golden totals, пропуски, дубли, revisions.

### 01.3.2 Проверочные изменения и большие наборы
Status: todo

Новая цена, ручная формулировка, изменённая схема CSV, недостаточный ряд и 100k-row input. Воспроизводимые хеши и отсутствие настоящих PII; возможность скачать/перенести свой вариант.

## 01.4 Проверить модели, форматы и управляемое размещение
Status: todo
Requirements: R17, R56, R79, R85, R86, R105
Depends on: 01.1
Owner: SUBAGENT to assign
Paths: scripts/preflight/, tests/preflight/

**Контракт и результат.** C2, C7-C9, C12, C14. После approval ограниченные probes OpenRouter: schema/tool call, vision extraction, отдельная economical image generation с известной полной ценой; запрет OpenAI/Anthropic/дорогого fallback. Проверить лицензии и реальную поставку Univer data-only formulas, Fabric serialisation, DOCX/PDF/Unicode export, arima CTSA. MAIN управляет dependencies/env/deploy; worker только scripts/evidence. Vercel account/project/tier/regions, pooled PostgreSQL, private Blob и Workflow resume проверяются API на synthetic содержимом. Сервисы и платные опции без разрешения не покупать.

**Вход в работу и состояния.** Readiness gate, не публичная кнопка «всё работает». Показать разрешённые модели/цены, недоступную модальность и ограничения форматов. Если библиотека требует Pro, найти проверенную OSS реализацию контракта, не убрать функцию.

### 01.4.1 Форматы и стоимость подтверждены
Status: todo

Roundtrip файлы, Unicode text extraction, formulas vs golden, schema/tool/vision result и usage без секретов. Live budget <= $1 batch; неоднозначный платный timeout не повторять вслепую.

### 01.4.2 Хостинг и региональные условия проверены
Status: todo

Preview HTTP/API + workflow resume после redeploy; storage permissions и лимиты. Privacy gate отдельно для аккаунтов, бизнес-данных, backups и AI subprocessors; неподтверждённую локализацию не считать production-ready.

