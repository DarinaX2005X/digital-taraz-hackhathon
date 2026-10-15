# 08 Изменения без потери ручной работы
Status: active

Главная связующая способность продукта: понять последствия изменения и принять нужное, сохранив сделанное человеком. Здесь проверяем не только счастливый путь, но и расхождения между материалами.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 08.1 Рассчитать последствия изменения источника
Status: active
Requirements: R10, R14, R16, R25, R102, R103, R105
Depends on: 03.1
Owner: /root/core_authority
Paths: src/features/dependencies/, tests/dependencies/

Тот же directly-related owner после checkpoint `d6ac5ff` соединяет source facts с table price/quantity, server calculation и downstream patches. Shared loan включает `src/contracts/dependencies.ts`, `src/contracts/dependency-edges.ts`, `src/server/db/dependency-schema.ts`, `src/features/artifacts/domain/content-models.ts`, `src/features/artifacts/domain/operations.ts`, `src/features/artifacts/domain/semantic-validation.ts`, `tests/artifacts/domain/content.test.ts`, `tests/artifacts/domain/operations.test.ts`. После bounded dependency review ему дополнительно выданы exact additive loans `src/contracts/artifacts.ts`, `src/contracts/commands.ts`, `src/features/artifacts/domain/targets.ts`, `src/features/artifacts/domain/content-state.ts`, `src/features/artifacts/server/service-support.ts`, `src/features/artifacts/server/lifecycle.ts` и необходимые focused tests/client snapshot consumers только для property-scoped binding compatibility. Последний consumer audit выдал точные compatibility loans `src/features/designs/domain/actions.ts`, `src/features/designs/ui/design-editor.tsx` и focused design tests, а также `src/features/demo/domain/store.ts` + focused demo store test: actions bind text/fill separately, unbind names the property, UI displays/unbinds them independently, all consumers use `targetElementId` and preserve `targetProperty`. Миграции и root exports передаются integration handover перед Git.

Уточнение2026-10-15: общий binding/graph/invalidation механизм начинается на принятом03.1 и canonical source/fact adapters, не ждёт всех07. Первые реальные adapters таблицы/документа подключаются вместе с05.1/03.3/02.4; раннее доказательство price -> formula -> document с сохранением ручной фразы входит в первый J1. Полная08.1 приёмка по-прежнему требует05.1/06.1/07.1/07.2/07.3/07.4 и всех описанных типов, включая plan/design и отсутствие пересечений прав. Исчезновение конечных зависимостей из условия старта не означает их принятие. Не делать отдельный fake demo engine; общий публичный пример использует те же pure domain transformations.

**Контракт и результат.** C3, C6, C8. Versioned FieldBinding/DependencyEdge DAG links source fact/calculated cell/docfield/designlayer/planentry, allowed updatePolicy formula-auto/propose/manual. Detect cycles; reachable-only propagation, stable IDs survive sorted/inserted rows; removed source yields unresolved not rebind by position. Deterministic calculations create next draft, semantic text/layout modifications proposed patch only. Track local override and AI-lock separately, source revision input snapshot. Invalidations include scenario/approval/export staleness, not destructive regeneration. Cross-project dependency reads enforce rights transitively.

**Вход в работу и состояния.** «Изменился источник» badge with source/revision/count and contextual impact list. No mandatory graph view. User may open source, keep local override with rationale or request patch. New source with schema drift returns to02.4; unrelated material remains current.

### 08.1.1 Граф и адресная инвалидация
Status: done

15октября graph/change-set service иcanonical per-target effects перенесены;11domain tests иscopedlint PASS. Integration подключил атомарные apply/undo/redo hooks;0015 reviewed, реальная SQL приёмка нового набора ещё не завершена. Demo иreview UI продолжаются; никакого окончательного08acceptance по однимdomain tests.

Golden price->formula->doc/design and independent page; cycles/removed IDs/largefanout/ACLdenial. One-source change touches exactly expected target set, not whole workspace.

Дополнительная подтверждённая граница15октября: geometry-only изменение связанного слоя не создаёт value override; price text иbrand fill в одномслое должны независимо адресоваться. Shared additive targeting/legacy compatibility уintegration, graph/proposals уconnected_delivery, UIbinding уdesigns_finish. Это обязательное продолжение полной06/08приёмки после текущегоeditorcheckpoint.

Принято: finite property bindings `value/text/fill`, legacy compatibility, independent design text/fill, geometry-only no override, property-aware demo/client/server consumers и real stable fact→price/quantity→formula→document/design/plan proposal. Design actions19/19 иdurable design DB3/3 PASS; dependency DB6/6.08.1.2 остаётся active до полного user-facing source-update/review flow.

### 08.1.2 Безопасное обновление фактов
Status: todo

Real new source snapshot computes draft diff, preserves locked/manual content, invalidates old approval honestly. Batched worker resume after failure without duplicate changes.

## 08.2 Принять изменения, сравнить версии и разрешить конфликт
Status: todo
Requirements: R16, R32, R33, R39, R40, R92, R93, R94, R96, R102
Depends on: 08.1, 03.2
Owner: SUBAGENT to assign (передача; прежний автор: connected_delivery)
Paths: src/features/change-review/, tests/change-review/

**Контракт и результат.** C4, C6. ChangeSet target operations with before/after/source reason/dependency group/baseRevision; causal group closure prevents accepttotal/rejectlines inconsistency. Preview is computed from same apply validation, no separate optimistic interpretation. Accept/reject selected groups/whole, human edits before apply create new validation; 409 beforeHash/source drift preserves selection and shows recomputed diff. Compare table cells/doc blocks/layers geometry+text/plan fields by stable IDs. Version approval hash invalidated on material change; restore creates newversion; branch merge explicit conflicts.

**Вход в работу и состояния.** Editor «Изменения» side panel, focused before/after, primary «Применить выбранное», reject and open-source. Historic compare read-only, restore clear effect confirmation. Show protected/skipped/unresolved items not silent disappearance. Phone review full screen with next/previous target, back restores editor position; undo package one step.

### 08.2.1 Выбор без несогласованных итогов
Status: todo

Tests causal groups, locked target, stale revision/source, ACL loss, partial accept and branch merge. Applying same changeset twice yields receipt, not second edit. Multi-artifact CommandGroup по C6: один apply/inverse с revision vector, row locks в порядке ID и общей транзакцией. Приёмка: table+document+design apply -> другой actor меняет document -> undo возвращает409, сохраняет чужую правку и не откатывает table/design частично. После явного разрешения новая согласованная группа откатывается/повторяется одним действием и одинаково видна во всех историях.

### 08.2.2 Сравнение и восстановление в редакторе
Status: todo

Integration each artifact kind approve->edit invalidates->compare->restore new version->undo. User checks diff readability and absence of surprising replacements.

## 08.3 Собрать согласованный пакет и перенести проект
Status: todo
Requirements: R10, R25, R43, R94, R95, R102, R103
Depends on: 08.2, 03.4, 06.3, 07.4
Owner: SUBAGENT to assign
Paths: src/features/project-packages/, tests/project-packages/

**Контракт и результат.** C3, C7. Bundle selection across workbook/doc/design/plan fixes exact revision set and checks critical shared binding equality/overrides/approval. User can explicitly export marked independent draft but not false coherent approved package. Manifest includes content hashes/versions/locale/sources/assumptions/redaction, human-readable file names. Whole-project portable .tirlik archive all supported artifact schemas+assets+declared source ownership; import creates new IDs via mapping, never adopts actor/ACL from archive. Size/decompression/path traversal and missing assets handled.

**Вход в работу и состояния.** Project «Экспортировать набор»: choose deliverables/formats, conflicts by item, preview excluded confidential fields; retry partial files same snapshot. Library of exports dates/revisions/download and expired/revoked states. No public share URL needed for customers.

### 08.3.1 Проверка согласованности
Status: todo

Golden changed price across quote/sheet/creative/calendar; mismatching critical binding blocks approved bundle with exact location. Redaction removes confidential fields from files and metadata.

### 08.3.2 Поставка и восстановление
Status: todo

Real files parse/open syntactically, manifest hashes match; import project into own workspace preserves editable content with remappedrefs. Malicious archive/foreignasset denied, revoke denies old download.

