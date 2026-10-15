# 05 Таблицы, сценарии и проверяемые прогнозы
Status: active

Здесь AI помогает разобраться в исходниках, а числа считает проверяемый движок. Можно менять допущения, сравнивать варианты и видеть, когда данных для прогноза недостаточно.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 05.1 Дать полноценную таблицу и анализ собственных данных
Status: active
Requirements: R12, R13, R14, R35, R36, R40, R44, R45, R91, R92, R93, R94, R95, R105
Depends on: 03.1, 01.2
Owner: /root/core_authority
Paths: src/features/sheets/, tests/sheets/, src/app/api/sheets/

Новый owner после checkpoint `d6ac5ff` также получает exclusive shared loan `src/features/artifacts/server/command-history.ts`, `src/features/artifacts/server/service.ts`, `tests/artifacts/server/service.integration.test.ts`, `src/contracts/calculations.ts` и связанные calculation regressions. Цель первого handover — server-authoritative prepared calculation boundary; UI/grid breadth продолжается после неё в том же task.

После independently accepted03.1 и checkpoint8b1b864 ручной table editor/engine/command adapter начинается параллельно02.4, как документный03.3. Format gate01.4.1 уже подтвердил выбранный engine subset. Это вход по готовому shared persistence контракту, не снятие полной02.4: окончательная05.1 acceptance требует настоящего materials query/mapping/source lineage и всех импортных сценариев. Fresh sheets_delivery получает весь05.1, не отдельный grid component. Existing canonical artifact types/history не дублировать; любые shared изменения через integration/ихowner.

Exclusive API prefix `src/app/api/sheets/` для действительно нужных query/materialize/import handlers, которые вызывают canonical materials/source/artifact services. Общий artifact route монтирует его единственный владелец workspace_delivery по согласованному готовому sheet capability; sheets owner обязан довести этот реальный вход/возврат до acceptance, а не оставить unmounted component. Dataset/query storage и stable facts принадлежат materials_delivery, не создавать вторую библиотеку. New package/rootexports/schema loans через integration, установленный versioned engine сначала исследовать по первичным docs.

**Контракт и результат.** C5-C7, C9. Univer editable workbook with stable row/column/cell IDs adapter, direct formulas/format/copy/paste/fill/sort/filter/freeze/find, row/column insert/delete, charts based on typed ranges. Server data-only same engine for tested function subset; unsupported formula diagnostic, no stale cached success. Dataset query AST validates dimensions/measures/predicates; 100k raw dataset queried page/aggregate, bounded20k workbook result. Decimal money services authoritative for finance. XLSX via ExcelJS retains supported formulas/styles with engine cached values; CSV loss+formula injection safe.

**Вход в работу и состояния.** Work -> table or material -> «Анализировать»: sheet dominant, formula bar and column units; chart/table views, filter immediately with cancelable query. All direct edits through Command, locks/pending/conflicts/history. Phone cell-detail editor and horizontal grid scroll preserve coordinates, numeric keyboard and accessible alternatives.

### 05.1.1 Движок и анализ с источниками
Status: done

Golden SUM/IF/SUMIFS/inter-sheet, cycles/errors/rounding, unit mismatch, filters and coverage. Chart point maps to aggregate source query, no model-generated numbers.

Принято authoritative boundary: core92/92, sheets31/31, calculation DB5/5, dependencyDB6/6 иartifactDB14/14 PASS. Server revalidates hashes/revisions/ACL/source facts and rejects forged cached totals; ISO scales JPY0/KWD3/KZT2; real fact420→485 yields131900→143600 with11700 difference and preserved manual phrase/lineage. Dataset group/facet/context и100k paging приняты materials package.05.1.2 остаётся active для полного grid/user interaction review.

### 05.1.2 Редактор и XLSX/CSV
Status: active

15октября sheets_finish перенёс editor/controllers/import-export/API и shared structural adapter;22focused tests иscopedlint PASS, в том числе exact CalculationSpec. Mounted источник→таблица→правка→reopen/export HTTP готовится общимrunner. Aggregate/query/chart provenance, большие bulk operations и полный набор grid controls ещё выполняются,05.1 не принят целиком.

Persistence/undo/insert stable refs, data-only export recalc and reimport golden formulas. Forbidden external links/functions rejected. User checks grid gestures, formulas and opens actual file.

## 05.2 Сравнивать денежные сценарии и календарь обязательств
Status: active
Requirements: R01, R12, R13, R14, R16, R91, R92, R99
Depends on: 03.1, 01.3
Owner: SUBAGENT to assign (передача; прежний автор: finance_delivery)
Paths: src/features/finance/, tests/finance/, evals/finance/, src/app/api/finance/

15октября отдельный GPT-5.6 Sol worker начинает точную предметную модель и цельный финансовый путь на принятом versioned artifact boundary и fixtures. До RELEASE текущего editorcheckpoint пишет только ignored scratch. Полная приёмка05.2 сохраняет зависимости05.1/04.1: authoritative server calculations, настоящий materials query, AI tool invocation, workbook/report, direct edit/reopen/export. Начало независимой модели не объявляет готовыми таблицы или финансовые результаты. Canonical CalculationSpec принадлежит runtime owner; shared artifact/model changes только integration, editor mount только sheet/workspace owners. Нет второго хранилища артефактов или формульного движка.

**Контракт и результат.** C1 J3, C3, C9. Finance tools create versioned scenario models from observed transactions, dated receivables/payables and explicit assumptions; no double-count sale+payment, returns separate, unknown costs not0. Money decimal/unit normalization and dated FX source. User-defined variables and formulas support unit economics, break-even, price/volume sensitivity, cash calendar and custom variants; no mandatory optimistic/base/pessimistic labels or generated uplift. Scenario carries sourceVersions, assumption provenance, derived formula graph, exclusions. Compare same dimensions and show missing evidence, not winner by narrative.

**Вход в работу и состояния.** Result opens table with editable assumptions and adjacent scenario/actual chart, not hidden chat. «Добавить вариант», inspect formula, change date/amount, switch cash/accrual clearly. Missing starting balance/terms shows exact gap; preserve model until explicit apply/recalc, source update becomes change set.

### 05.2.1 Точные расчёты и варианты
Status: active

Golden costs/returns/FX/receivables timing and negative cash cases; sensitivity independent recalculation, no tax rate invention. Scenario changed one assumption retains original branch.

### 05.2.2 Полезный финансовый результат
Status: todo

Tool creates workbook and annotated report, direct edits/export and fresh GET match model. Comparative outputs cite coverage; invalid units block only affected calculation, not entire project.

## 05.3 Строить прогноз только с исторической проверкой
Status: active
Requirements: R12, R13, R14, R15, R91, R104
Depends on: 03.1, 01.3
Owner: SUBAGENT to assign (передача; прежний автор: forecast_delivery)
Paths: src/features/forecast/, tests/forecast/, evals/forecast/, src/app/api/forecast/, src/server/db/forecast-schema.ts

15октября независимое статистическое ядро/валидация/история прогноза начинается наготовых03.1/01.3 ипринятомCTSA formatproof. До RELEASE текущегоCP1 только ignoredscratch. Полная05.3приёмка сохраняет05.2 иреальныйmaterials/query/runtime/editor/export путь; самостоятельный domainпрогноз ещё не продуктоваяприёмка. Никакихоблачныхcompute/paidcalls; canonicalRun/Artifact используются черезowners. Если нужен ForecastRun metadata store,0019forecast зарезервирована только после precisecontractreviewintegration; второйjobexecutor запрещён.

Локальная реализация использует принятый CTSA/licence proof01.4.1. Отложенный remote01.4.2 не блокирует локальную domain-проверку, но не считается выполненным; cloud execution limits остаются acceptance11.2/13.2.

**Контракт и результат.** C9 полностью. ForecastRequest target/date/value/aggregation/horizon/calendar/sourceVersion/exclusions. Validate regularity/missing periods/zeros/outliers, eligibility thresholds C9; no leakage through holdout. Fixed economical arima CTSA candidates + naive/seasonal baseline, rolling-origin >=2 folds, MAE/WAPE zero case, choose candidate only if beats comparable baseline. Prediction intervals method+level+calibration coverage, no Gaussian-looking decoration from LLM. Persist train range, selected params, folds, residuals, raw/adjusted predictions and new actual comparison; cancel/resume versioned job.

**Вход в работу и состояния.** Chart labels fact/forecast/range with date boundary and baseline toggle; editable horizon/exclusions require rerun new version. Insufficient history shows why and «Рассчитать сценарий» preserving input, never fake forecast. Table of points available for access/export; ru/kk/en terms, phone chart+scroll table.

### 05.3.1 Eligibility, baseline и отсутствие утечки
Status: active

Deterministic short/constant/seasonal/noisy/zero series; no future values in train, wrong frequency rejected; weak model loses to baseline. Model library failures return recoverable state.

### 05.3.2 Сохранённый прогноз и новая фактическая история
Status: todo

Golden backtest metrics independently recomputed, interval provenance, XLSX/PDF contains dates/error/assumptions. New history rerun leaves prior forecast intact and enables plan-fact. User judges readable uncertainty.

