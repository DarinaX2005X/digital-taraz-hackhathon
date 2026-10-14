# 11 Полная связность, безопасность и рост нагрузки
Status: todo

Проверяем продукт целиком, включая неприятные ситуации: разные права, большие файлы, сбой модели и возвращение после перезапуска. Масштабируемость здесь выражается измерениями и механизмами, а не обещанием выдержать любую нагрузку.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 11.1 Пройти все деловые пути и состояния через реальные границы
Status: todo
Requirements: R06, R07, R10, R11, R13, R14, R15, R16, R39, R40, R41, R42, R43, R44, R45, R60, R82, R83, R84, R90, R91, R92, R93, R94, R95, R96, R97, R98, R99, R100, R102, R103, R104
Depends on: 09.3, 10.3, 07.3
Owner: SUBAGENT to assign
Paths: tests/journeys/, evals/suite/, scripts/eval-live.mjs

**Контракт и результат.** C1 J1-J5, C13. HTTP/API and domain matrix three business models/all artifact kinds/owner-editor-reviewer. Sources -> actual tools -> result -> direct edit -> undo -> sourcechange -> selective review -> exports -> new session -> repeat. Live economical eval unseen tasks, contradictory context, malformed provider output, cancellation and missingkey; results not hand-authored fixtures pretending live. Static route/action/locale parity includes emails/exports/errors/tour/accessibility semantics and narrow CSS constraints. User visual findings consumed in original TESTING, never browser automation.

**Вход в работу и состояния.** MAIN publishes actual local/preview URLs and compact user-check routes for each capability, desktop/mobile and languages. Pending visual checks remain needs-user-check, unrelated successful domain tests retained. No universal happiness from allroutes200.

### 11.1.1 Сквозные доказательства и негативные ветки
Status: todo

Run check.mjs/integration/build and capped eval cases, record exact fixtures/versions/provider usage. Test edits affect actual exports, unknown not0, confidential data absent, restart retains work.

### 11.1.2 Реестр UX-проверок и исправленные разрывы
Status: todo

Static entry->action->result->next inventory every task; locale gap/missing control fixes delegated via MAIN bounded paths. User feedback preserved, no fabricated first-session speed or visual pass.

## 11.2 Проверить изоляцию, объёмы, восстановление и условия эксплуатации
Status: todo
Requirements: R18, R22, R23, R25, R42, R43, R79, R85, R105
Depends on: 11.1
Owner: SUBAGENT to assign
Paths: tests/resilience/, scripts/ops/, docs/operations/

**Контракт и результат.** C3-C5, C8, C11-C12. Fixture100kCSV/20kXLSX/10kprojects/100kmetadata,20concurrentHTTPusers5tenants30queuedjobs8active. Measure warm metadata p95 target<500ms/mutationack<1s with hardware/region/dataset notes, no unmeasured guarantee. EXPLAIN indexes/keyset50/<=1MBmetadata/lazyeditor/chunkresume/fairqueue and bounded memory/context. Security probes SSRF DNS redirects/privateIPs, file formats/injection, IDOR, CSRF, event/export leaks, revocation midjob. Backup+restore isolated database/files, schema/capability compatibility of in-flight workflows, retention/delete behavior. Regional privacy/account/subprocessor/deletion/backup gate from01.4 must be resolved before real PII rollout.

**Вход в работу и состояния.** Manual editor remains usable during AI queue/limit; readable job wait and file processing failure. Ops evidence documents test envelope and hosting plan cost/limits. If legal region or service unavailable, report precise unfinished gate, not silently deploy unsafe real-data collection or drop requested service.

Уточнение local-only2026-10-14: локальные нагрузка/изоляция/backup-restore11.2.1 выполняются после11.1 на принятом capability gate01.4.1 и не ждут отложенного cloud01.4.2. Условия будущего hosting/region rollout11.2.2 сохраняются отдельным непроверенным gate, не исследуются до выбора сервера пользователем. Для перехода к локальному review12.1 требуется фактическая приёмка11.2.1; полный11.2 не объявлять done при отложенной production части.

### 11.2.1 Нагрузка и отказоустойчивость
Status: todo

Bounded parallel API load without UI, stale worker fencing, duplicate external receipt and DBrestart; compare metrics before/after targeted fixes. Backup restored records/hashes and ACL checked. Добавить1000 локальных правок большого workbook: storage не растёт как1000 полных копий, reopen и export дают тот же snapshotHash/значения. Проверить30-day trash/backup policy, immediate purge, reference-count-safe chunks и tombstones после восстановления; активные jobs не воскрешают удалённое.

### 11.2.2 Защита и разрешённый режим публикации
Status: todo

Verify data flows/regions/PII including account email, current official policies and env scoping. Synthetic public demo mode segregated; production readiness only with concrete resolved gate. User financial subscription approval separate.

