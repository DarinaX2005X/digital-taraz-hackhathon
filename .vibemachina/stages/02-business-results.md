# 02 Полный набор полезных бизнес-работ
Status: active

Старт по contract не равен готовности: обязательные producer handovers до done находятся в PLAN, включая K7; partial/mock результат не закрывает пакет.

Два независимых крупных пакета превращают исходники в новые финансовые, закупочные и рекламные материалы. Они развиваются параллельно первому этапу по общим contracts и соединяются в 04.1. Наличие таблицы или canvas само по себе не закрывает ни одну задачу.

Общие [PLAN](../PLAN.md), [DESIGN](../DESIGN.md), PROJECT C1/C5–C10, K0–K6, P2/P3. UI владельцы отвечают за entry, result, editing, return, локали RU/KK/EN и все состояния, включая narrow/keyboard/feedback. Общие schemas/registry/migrations — только 01.3; feature-specific API prefixes принадлежат указанному пакету.

## 02.1 Подготовить финансовую модель, прогноз и обоснованную закупку
Status: active
Requirements: R01, R12, R13, R14, R15, R16, R35, R82, R91, R92, R99, R104, R109
Depends on: none
Owner: SUBAGENT money_procurement
Paths: src/features/finance/, src/features/forecast/, src/features/procurement/, tests/finance/, tests/forecast/, tests/procurement/, evals/finance/, evals/forecast/, evals/procurement/, src/app/api/finance/, src/app/api/forecast/, src/app/api/procurement/

**Результат.** В одной работе из продаж/возвратов/расходов/остатков/предложений поставщиков получаются editable денежная модель, календарь обязательств, сравнение вариантов закупки, заказ поставщику и прогноз с исторической проверкой, когда история пригодна. Это устранение ручного сведения разных таблиц, единиц, сроков и условий. Отдельное сложение не считается ценностью. Пользователь может независимо попросить любую из этих работ.

**Входы и механизм.** Finance C9 принимает observed transactions, dated receivables/payables и explicit assumptions. Не смешивать продажу с её оплатой; возвраты/FX/налоги/начальный остаток имеют происхождение. Точные currency minor units и quantities, unknown не ноль. Scenario сохраняет formula graph, source revisions, exclusions; compare сопоставляет одинаковые измерения. Procurement нормализует упаковки/MOQ/скидки/доставку/платёжные условия, потребность минус доступный остаток и срок. Неполная цена не становится победителем. Candidate order является черновиком, ничего не отправляет поставщику.

Forecast C9: regularity/coverage/zero/outliers, train/holdout без leakage, economical CTSA candidates против naive/seasonal baseline, rolling-origin ≥2 folds, MAE/WAPE с zero denominator, интервалы с методом/калибровкой. Слабая модель уступает baseline; недостаточная история даёт честный отказ и сохранённый ввод для сценария. Нет произвольной кривой от LLM. Новые факты сравниваются со старым неизменяемым forecast.

**Порядок.** Реализовать точные domain services и specs инструментов, затем persisted scenarios/forecast metadata и artifacts через K3, UI assumptions/compare/chart/calendar/supplier order, editable/export/return paths. Registry/DB changes передать 01.3; sheets/mapping consume 01.6/01.2 по существующим contracts. Entry — свободная цель или «Анализировать» у выбранных материалов; результат открывается в workbook с панелью допущений/coverage, не в длинном ответе чата. Варианты можно назвать самостоятельно, выбор/применение сохраняет исходную ветку.

**Состояния и приёмка.** P3: разные упаковки, срок поставки, частичная цена, возвраты и currency case; конкретный usable order + денежные последствия и связанные материалы. Stale source/ref, inconsistent unit, missing opening balance, model failure/cancel сохраняют пригодную часть. Пересчёт после правки оставляет manual overrides и старые версии. Narrow charts имеют tabular equivalent. Scoped domain/DB/HTTP и реальные файлы; paid invocation только executor 01.3, итог живого пути проверяет 04.1.

### 02.1.1 Предметная модель и пригодные варианты
Status: active
Независимые golden расчёты закупки/денег и прогнозные backtests, mismatched units/FX/unknown/negative cash cases. Tool descriptors и canonical mutation/read-back дают новые редактируемые материалы, не JSON-only proof.

### 02.1.2 Полная работа с собственными данными
Status: todo
Import/mapping → сравнение → ручная правка → сохранение → фактический экспорт → reopen → новые факты. P3, lineage и failure recovery подтверждены сервером; читабельность/взаимодействие принимает пользователь.

## 02.2 Создать кампанию и полноценные редактируемые макеты
Status: active
Requirements: R01, R07, R14, R15, R16, R17, R25, R30, R37, R40, R42, R43, R44, R45, R46, R48, R49, R82, R86, R90, R91, R92, R93, R94, R95, R96, R99, R102, R109
Depends on: none
Owner: SUBAGENT campaign_studio
Paths: src/features/designs/, src/features/design-export/, src/features/creative-ai/, src/features/campaigns/, tests/designs/, tests/design-export/, tests/creative-ai/, tests/campaigns/, evals/creative-ai/, evals/campaigns/, src/app/api/designs/, src/app/api/campaigns/, src/app/api/creative-ai/

**Результат.** Из собственных фотографий/бренда/условий акции Tirlik готовит связанные послойные макеты разных размеров, тексты RU/KK/EN, рабочий календарь и бюджетный вариант. Владелец выбирает композицию, меняет любой текст/фото/объект, адаптирует формат и получает готовые файлы. Это создание нового usable материала, не просмотр загруженной картинки и не заставка с AI-ответом.

**Механизм.** C7 DesignModel/Fabric, C8 creative tools, C1 J2 и K3. Варианты различаются композицией/сообщением по brief; assets имеют права/источник, subject constraints и crop-safe bounds. Если нужен raster generation, только разрешённый существующий OpenRouter runtime, без новых plugins/skills и лишь через общего paid executor. Generated bitmap не заменяет editable text/layout. Image failure оставляет вариант из собственных assets и точный retry state. Нельзя выдумывать скидки, отзывы, партнёров, наличие товара или рекламный uplift.

**Порядок.** Завершить direct editor/layers/selection/undo/zoom/alignment/text/image crop/pages/resize/export; добавить предметную процедуру campaign → brief/conditions → variants → selected kit → dated plan/budget; подключить 01.4 plan и 02.1 budget через их descriptors/typed results. Brand versions приходят из 03.2, отсутствие brand не блокирует первую работу. Source/condition binding — semantic property IDs, geometry-only правка не снимает value dependency. Price/date update создаёт changeset и сохраняет ручной язык/раскладку.

**Вход и состояния.** Сессия либо «Создать макет»: большой canvas, contextual toolbar, layers/variant selector по запросу, свойства выделенного объекта, явные «Сравнить варианты»/«Применить»/«Скачать». Empty/partial/loading/error/noasset/permission/stale version не закрывают canvas. Selection/focus и keyboard shortcuts не крадут текстовый ввод; narrow даёт тот же базовый editing через properties sheet. Все states и тексты входят в пакет.

### 02.2.1 Новый материал и непосредственная правка
Status: active
P2: собственные фото/двуязычный текст/два размера → раздельные реальные слои → ручная правка → undo/redo/reopen. Schema overflow/font/asset missing и модельный сбой не выдают невалидную композицию за готовую; content/bounds checks не называют visual acceptance.

### 02.2.2 Связанный комплект кампании и реальный выпуск
Status: todo
Обновить условие/дату → адресные предложения → сохранить ручные поля → PNG/JPEG/PDF/editable проект. Файлы содержат выбранную ревизию/размеры/Unicode; alpha/quality/progress/retry проверены по данным и файлам без браузера. Календарь и бюджет ссылаются на те же условия; пользователь проверяет композицию и экспорт.
