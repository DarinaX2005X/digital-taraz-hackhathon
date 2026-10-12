# 08 Изменения без потери ручной работы
Status: todo

Главная связующая способность продукта: понять последствия изменения и принять нужное, сохранив сделанное человеком. Здесь проверяем не только счастливый путь, но и расхождения между материалами.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 08.1 Рассчитать последствия изменения источника
Status: todo
Requirements: R10, R14, R16, R25, R102, R103, R105
Depends on: 05.1, 06.1, 07.1, 07.2, 07.3, 07.4
Owner: SUBAGENT to assign
Paths: src/features/dependencies/, tests/dependencies/

**Контракт и результат.** C3, C6, C8. Versioned FieldBinding/DependencyEdge DAG links source fact/calculated cell/docfield/designlayer/planentry, allowed updatePolicy formula-auto/propose/manual. Detect cycles; reachable-only propagation, stable IDs survive sorted/inserted rows; removed source yields unresolved not rebind by position. Deterministic calculations create next draft, semantic text/layout modifications proposed patch only. Track local override and AI-lock separately, source revision input snapshot. Invalidations include scenario/approval/export staleness, not destructive regeneration. Cross-project dependency reads enforce rights transitively.

**Вход в работу и состояния.** «Изменился источник» badge with source/revision/count and contextual impact list. No mandatory graph view. User may open source, keep local override with rationale or request patch. New source with schema drift returns to02.3; unrelated material remains current.

### 08.1.1 Граф и адресная инвалидация
Status: todo

Golden price->formula->doc/design and independent page; cycles/removed IDs/largefanout/ACLdenial. One-source change touches exactly expected target set, not whole workspace.

### 08.1.2 Безопасное обновление фактов
Status: todo

Real new source snapshot computes draft diff, preserves locked/manual content, invalidates old approval honestly. Batched worker resume after failure without duplicate changes.

## 08.2 Принять изменения, сравнить версии и разрешить конфликт
Status: todo
Requirements: R16, R32, R33, R39, R40, R92, R93, R94, R96, R102
Depends on: 08.1, 03.2
Owner: SUBAGENT to assign
Paths: src/features/change-review/, tests/change-review/

**Контракт и результат.** C4, C6. ChangeSet target operations with before/after/source reason/dependency group/baseRevision; causal group closure prevents accepttotal/rejectlines inconsistency. Preview is computed from same apply validation, no separate optimistic interpretation. Accept/reject selected groups/whole, human edits before apply create new validation; 409 beforeHash/source drift preserves selection and shows recomputed diff. Compare table cells/doc blocks/layers geometry+text/plan fields by stable IDs. Version approval hash invalidated on material change; restore creates newversion; branch merge explicit conflicts.

**Вход в работу и состояния.** Editor «Изменения» side panel, focused before/after, primary «Применить выбранное», reject and open-source. Historic compare read-only, restore clear effect confirmation. Show protected/skipped/unresolved items not silent disappearance. Phone review full screen with next/previous target, back restores editor position; undo package one step.

### 08.2.1 Выбор без несогласованных итогов
Status: todo

Tests causal groups, locked target, stale revision/source, ACL loss, partial accept and branch merge. Applying same changeset twice yields receipt, not second edit.

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

