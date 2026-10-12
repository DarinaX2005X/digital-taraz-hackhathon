# 06 Креативы, которые можно менять по слоям
Status: todo

Маркетинговый результат должен оставаться редактируемым: текст, фото, композиция и размеры отдельно. Генерация изображения дополняет редактор, а не превращает всё в одну неподвижную картинку.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 06.1 Редактировать послойные макеты и материалы бренда
Status: todo
Requirements: R37, R40, R44, R45, R46, R48, R49, R91, R92, R93, R94
Depends on: 03.1, 02.3, 01.2
Owner: SUBAGENT to assign
Paths: src/features/designs/, tests/designs/

**Контракт и результат.** C3, C6-C7, DESIGN редактор макета. Fabric typed page/layer model: dimensions/bg, text/image/group, transforms/styles/source bindings; add/delete/duplicate/reorder/group/align/snap/crop/lock, pages and selections, zoom/pan. Stable layerIds, original asset and nondestructive crop preserved, command adapter one history group per gesture. Brand kit uses uploaded logo/photos/fonts/colors with license manifest; unknown font fallback flagged before export. Fit text by intentional reflow/font selection, not silent truncate; contenteditable text not raster-only.

**Вход в работу и состояния.** Full workspace canvas with compact tool rail, layers contextual panel and type-specific inspector. Tooltips and icons; color swatches, numeric dimensions, alignment symbols. Phone select via layer list, direct text/property edit and fit canvas; no hover-only primary operation. Blank/design-import/asset-missing/save-conflict states.

### 06.1.1 Модель макета и базовые действия
Status: todo

Layer geometry/serialization/locks/crop/ordering and inverse commands tests; asset references ACL and original preservation. No UI automation/canvas screenshots.

### 06.1.2 Редактор и бренд-набор
Status: todo

Persist/reopen/edit page and direct text, group transform undo, missing-font recovery and locale change without text replacement. User verifies canvas gestures/selection/layout/mobile.

## 06.2 Создавать изображения и варианты с сохранением правок
Status: todo
Requirements: R14, R15, R16, R17, R43, R86, R91, R96, R102
Depends on: 06.1, 04.1, 04.2
Owner: SUBAGENT to assign
Paths: src/features/creative-ai/, tests/creative-ai/, evals/creative-ai/

**Контракт и результат.** C7-C8. Creative tool generates typed editable layout from goal/brand/product facts, real photos prioritized when actual product inspection matters. Optional image generation/edit endpoint selected only after01.4 modality+unitcost proof, explicit cap includes all image/token costs. Generated raster is one asset layer, texts/prices/logo remain separate editable layers. Store prompt-purpose/model/usage/inputasset refs/provenance; no invented exact product photograph. Adapt chosen design to new aspect ratio/language through proposed layer patches respecting locks; recomposition not screenshot resize.

**Вход в работу и состояния.** In design AI panel «Создать вариант»/«Адаптировать размер» with free text, existing assets selection and cost before paid generation. Failure preserves current design; image denied/timeout explains state and permits own asset. Variants grid previews individual items, compare selected then explicit apply.

### 06.2.1 Отдельная модальность и защита стоимости
Status: todo

Real allowed image call with bounded request, actual output asset MIME/dims; denied model/no-price/ambiguous timeout cannot escape reservation. Tool never routes to costly default.

### 06.2.2 Редактируемая композиция и варианты
Status: todo

Live ru/kk brief produces layout+asset, required facts matched, locked logo/text unchanged in adapt; one-command accept/undo. User verifies actual creative quality, not claimed by JSON validity.

## 06.3 Выпускать готовые изображения и редактируемый проект
Status: todo
Requirements: R25, R42, R43, R95, R102
Depends on: 06.1, 06.2, 03.4
Owner: SUBAGENT to assign
Paths: src/features/design-export/, tests/design-export/

**Контракт и результат.** C7. Server product export typed layer model -> safe SVG intermediate -> resvg/sharp PNG/JPEG and PDFKit multi-page PDF. No browser renderer; no UI screenshots. Font metrics, image crop/transforms/group opacity and page bounds reflect model. Editable .tirlik package includes schemaVersion/pages/assets/fonts/licenses/hashes; validate untrusted archive import boundaries and roundtrip. Register exporter with03.4 manifest contract via MAIN, per-size variants linked same revision family.

**Вход в работу и состояния.** Export menu format/dimensions/transparency where supported, named pages, bundle preview listing files, missing fonts/assets identified by layer. Export partial/retry same versions; user opens product files externally. No claim pixel-perfect across engines until actual user review.

### 06.3.1 Файлы макета
Status: todo

Parse PNG/JPEG dimensions/alpha, PDF text/fonts/pages; known layer coordinate assertions and content hashes without rendering UI. Oversized images/unsafe SVG rejected.

### 06.3.2 Переносимый проект и пакет вариантов
Status: todo

Export/import .tirlik preserves editable layer IDs/styles/source refs or explicit relink if external private sources absent. Missing asset causes named error not blank success; ACL/download tests.

