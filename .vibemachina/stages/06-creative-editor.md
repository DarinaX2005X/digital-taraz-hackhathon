# 06 Креативы, которые можно менять по слоям
Status: active

Маркетинговый результат должен оставаться редактируемым: текст, фото, композиция и размеры отдельно. Генерация изображения дополняет редактор, а не превращает всё в одну неподвижную картинку.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 06.1 Редактировать послойные макеты и материалы бренда
Status: active
Requirements: R37, R40, R44, R45, R46, R48, R49, R91, R92, R93, R94
Depends on: 03.1, 01.2
Owner: SUBAGENT to assign (передача; прежний автор: designs_finish)
Paths: src/features/designs/, tests/designs/, src/app/api/designs/

После accepted03.1/checkpoint8b1b864 полный direct layout editor начинается на проверенном ArtifactSession параллельно02.4; Fabric format gate01.4.1 принят. Final06.1 acceptance всё ещё требует02.4 для canonical material/brand/source refs и всех asset scenarios. Fresh designs_delivery получает всю модель/редактор/сохранение/бренд-функции/локали/проверки, не только canvas. Генерация изображений и export остаются отдельными06.2/06.3, не имитировать их ради меню.

Exclusive API prefix `src/app/api/designs/` только для нужных feature handlers с общими ACL/source/artifact services. Main artifact route имеет единственного owner workspace_delivery, который подключает готовую design capability; завершение06.1 требует реального mount и входа/возврата. Source private assets остаются source_delivery, library/facts materials_delivery; не заводить альтернативное storage/BrandKit без согласования canonical09.1 contract. Package/root exports/schema через integration. Никакого automated canvas rendering/screenshot QA, browser/headless; pure geometry/state/server checks и пользовательская visual review.

Bounded shared contract extension поручён directly-related artifact_delivery: только artifacts/domain/content-models.ts, semantic-validation.ts, operations.ts и tests/artifacts/domain/content.test.ts, operations.test.ts. Optional normalized crop только image, fontAssetId UUID только text, name<=240; старые snapshots совместимы, изменения проходят единые commands/undo. Canonical private font asset intake/metadata у source_delivery, license/embedding permissions не выводятся из самого факта upload.0010 immutable/image-only; новый DDL номер отдельно после согласования, не создавать design-only asset store.

**Контракт и результат.** C3, C6-C7, DESIGN редактор макета. Fabric typed page/layer model: dimensions/bg, text/image/group, transforms/styles/source bindings; add/delete/duplicate/reorder/group/align/snap/crop/lock, pages and selections, zoom/pan. Stable layerIds, original asset and nondestructive crop preserved, command adapter one history group per gesture. Brand kit uses uploaded logo/photos/fonts/colors with license manifest; unknown font fallback flagged before export. Fit text by intentional reflow/font selection, not silent truncate; contenteditable text not raster-only.

**Вход в работу и состояния.** Full workspace canvas with compact tool rail, layers contextual panel and type-specific inspector. Tooltips and icons; color swatches, numeric dimensions, alignment symbols. Phone select via layer list, direct text/property edit and fit canvas; no hover-only primary operation. Blank/design-import/asset-missing/save-conflict states.

### 06.1.1 Модель макета и базовые действия
Status: active

Layer geometry/serialization/locks/crop/ordering and inverse commands tests; asset references ACL and original preservation. No UI automation/canvas screenshots.

### 06.1.2 Редактор и бренд-набор
Status: active

15октября полноценный Fabric projection/controller/inspector/pages/layers/direct text/crop/history UI перенесён и смонтирован;26focused checks иscopedlint PASS. Продолжаются source binding/confirmed brand facts/canonical visual assets и server save/reopen proof. Отдельный09.1 BusinessContext не заменяется вторым brand store.06.3 exporter пока готовится отдельно и не объявлен работающим; UI/canvas жесты проверяет пользователь.

Persist/reopen/edit page and direct text, group transform undo, missing-font recovery and locale change without text replacement. User verifies canvas gestures/selection/layout/mobile.

## 06.2 Создавать изображения и варианты с сохранением правок
Status: active
Requirements: R14, R15, R16, R17, R43, R86, R91, R96, R102
Depends on: 03.1, 01.3
Owner: SUBAGENT to assign (передача; прежний автор: creative_delivery)
Paths: src/features/creative-ai/, tests/creative-ai/, evals/creative-ai/, src/app/api/creative-ai/

15октября fresh GPT-5.6 Sol owner начинает typed layout/variant/asset procedure на принятом artifact boundary иготовых runtime/source interfaces, пока06.1/04.1 завершают интеграцию. До RELEASE текущегоCP1 только ignoredscratch. Полная06.2приёмка сохраняет06.1/02.2/04.1 иреальную отдельную image modality+priceproof. Самостоятельные paidcalls запрещены: единственный executor agent_execution, общийgrant$10, никакого обходногоAPI/бесплатной имитации. Shared design contracts/root/runtime registry/source asset intake принадлежат текущимowners; панель монтирует designs_finish поhandover, не второй canvas.

**Контракт и результат.** C7-C8. Creative tool generates typed editable layout from goal/brand/product facts, real photos prioritized when actual product inspection matters. Optional image generation/edit endpoint selected only after01.4 modality+unitcost proof, explicit cap includes all image/token costs. Generated raster is one asset layer, texts/prices/logo remain separate editable layers. Store prompt-purpose/model/usage/inputasset refs/provenance; no invented exact product photograph. Adapt chosen design to new aspect ratio/language through proposed layer patches respecting locks; recomposition not screenshot resize.

**Вход в работу и состояния.** In design AI panel «Создать вариант»/«Адаптировать размер» with free text, existing assets selection and cost before paid generation. Failure preserves current design; image denied/timeout explains state and permits own asset. Variants grid previews individual items, compare selected then explicit apply.

### 06.2.1 Отдельная модальность и защита стоимости
Status: active

Real allowed image call with bounded request, actual output asset MIME/dims; denied model/no-price/ambiguous timeout cannot escape reservation. Tool never routes to costly default.

### 06.2.2 Редактируемая композиция и варианты
Status: active

Live ru/kk brief produces layout+asset, required facts matched, locked logo/text unchanged in adapt; one-command accept/undo. User verifies actual creative quality, not claimed by JSON validity.

## 06.3 Выпускать готовые изображения и редактируемый проект
Status: active
Requirements: R25, R42, R43, R95, R102
Depends on: 03.1, 01.2
Owner: SUBAGENT to assign (передача; прежний автор: design_exports)
Paths: src/features/design-export/, tests/design-export/

Передача15октября: designs_finish завершил исходный renderer/package adapter и передал его свежему GPT-5.6 Sol design_exports; дополнительный точный loan src/app/api/designs/import/** принадлежит только новомуowner.06.1 editor остаётся designs_finish. Ранние ручные export/import проверки используют canonical design snapshot иготовый03.4CP1; финальная06.3 приёмка включает06.2 generated variants иполный03.4, эти условия не сняты. Не переписывать уже проверенный9tests renderer без дефекта; проверить новый import UI/ACL/manifest/adapters и полный пользовательский путь.

**Контракт и результат.** C7. Server product export typed layer model -> safe SVG intermediate -> resvg/sharp PNG/JPEG and PDFKit multi-page PDF. No browser renderer; no UI screenshots. Font metrics, image crop/transforms/group opacity and page bounds reflect model. Editable .tirlik package includes schemaVersion/pages/assets/fonts/licenses/hashes; validate untrusted archive import boundaries and roundtrip. Register exporter with03.4 manifest contract via MAIN, per-size variants linked same revision family.

**Вход в работу и состояния.** Export menu format/dimensions/transparency where supported, named pages, bundle preview listing files, missing fonts/assets identified by layer. Export partial/retry same versions; user opens product files externally. No claim pixel-perfect across engines until actual user review.

### 06.3.1 Файлы макета
Status: active

15октября design_exports передал renderer/package/import UI:12focused tests иscopedlint PASS, модуль входит в успешную production сборку. Historical draft отмечается в PNG/JPEG/PDF; bounded .tirlik manifest/import сохраняет provenance иявный detach. Новый handler+isolatedDB proof импорта передан integration, ещё не принят. Регистрация всех форматов в общем exportdialog входит вCP2 exports_delivery. Пользовательская проверка выходных изображений/макетов впереди.

Parse PNG/JPEG dimensions/alpha, PDF text/fonts/pages; known layer coordinate assertions and content hashes without rendering UI. Oversized images/unsafe SVG rejected.

### 06.3.2 Переносимый проект и пакет вариантов
Status: active

Export/import .tirlik preserves editable layer IDs/styles/source refs or explicit relink if external private sources absent. Missing asset causes named error not blank success; ACL/download tests.

