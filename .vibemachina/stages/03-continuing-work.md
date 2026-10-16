# 03 Связанные изменения, команда и следующий период
Status: done

Старт по contract не равен готовности: обязательные producer handovers до done находятся в PLAN, включая K7; partial/mock результат не закрывает пакет.

Работа остаётся пригодной после изменения входов, перехода к коллеге и возвращения через неделю. Оба пакета приняты в общем checkpoint9b4c339ba135d36d5b58814aeab8f58fe7217526: реальные producer handovers, DB/HTTP/file proofs, type/lint и production build прошли. Полный межэтапный проход принимает04.1; внешний вид и удобство остаются на пользовательской проверке.

Shared core continuity_integration принят: canonical business-work context/rule/occurrence/prepareWorkChanges schemas, Drizzle schema/migration0024 и export release metadata через существующий immutable export job. Focused7/7/scopedlint PASS; isolated DB run17cbe999428445a69549dc1087141c2a: migrate/seed и2files/3tests PASS, containers/volume removed. Оба consumers используют общие exports; четыре navigation routes существуют и скомпилированы. allowedBusinessContextRefs optional для обратной совместимости, recurring передаёт explicit authority. Общие проверки9b4c339:159unit files/986tests, type/lint и production build PASS. Shared owner quiescent.

## 03.1 Согласовать изменения и выпуск всего комплекта
Status: done
Requirements: R10, R14, R16, R25, R32, R33, R39, R40, R43, R92, R93, R94, R95, R96, R102, R103, R105
Depends on: none
Owner: SUBAGENT changes_release
Paths: src/features/dependencies/, src/features/change-review/, src/features/project-packages/, tests/dependencies/, tests/change-review/, tests/project-packages/, src/app/api/changesets/, src/app/api/packages/, src/app/app/projects/

После handover01.2 project route wrappers переданы03.1 целиком; существующие project/artifact/history mounts сохраняются, новые changes/packages страницы входят в эту единую зону. Feature workspace UI остаётся01.2 с точными integration loans вSTATE.

**Результат.** При новом прайсе/сроке/объёме Tirlik находит связанные материалы и предлагает конкретные изменения с основаниями. Пользователь видит affected fields, ручные решения и конфликты, принимает подходящее; выпускает согласованный комплект без смешения разных ревизий. Entry — индикатор изменения в сессии/материале и «Проверить изменения», отдельная page только для полного review, не новый обязательный мастер.

**Механизм.** C6/K6: stable fact/record/property IDs, causal groups, source/artifact revision vector; semantic value отдельно от geometry. Manual override/lock сохраняются, deleted target/row/schema drift требуют адресной коррекции, stale preview409 пересчитывается. Apply/undo одной causal group атомарны, общий epoch/ACL recheck перед commit. Redacted/private lineage не выдаётся получателю без прав. Package manifest фиксирует версии, выбранные файлы, audience/policy и known omissions; повтор скачивает тот же комплект.

**Порядок.** Reconcile существующий dependency/review код, закрыть missing propagation/lock/branch cases; передать decorations/commands editors 01.6/02.2/01.4 через их owners. Затем review UI с выбором/сравнением, package collection/export/export retry. UI по DESIGN: причина и поля рядом, selected/partial/conflict/disabled выразительны, keyboard list/tree и narrow drill-down; RU/KK/EN. Рендеры файлов использует 01.6/02.2, свой второй exporter не создаёт.

### 03.1.1 Изменения сохраняют решения человека
Status: done
P5: source changed + manual phrase + geometry change + locked price; правильные reachable fields, no overwrite, concurrent commands/undo conflict и revoke проверены domain/DB. Отказ части dependency не объявляет весь проект актуальным.

### 03.1.2 Согласованный выпуск и возврат
Status: done
Apply selected group → persisted material revisions → реальный package manifest/files → reopen. Missing asset/failed render даёт повтор нужной части; остальные ready artifacts остаются. Пользователь проверяет ясность diff/review и полноту скачанного комплекта.

Whole-file handover03.1 принят в9b4c339: review/list/prepare/apply/reject и packages list/create/render/retry/download с frozen release metadata, canonicalExportService, routes/UI/locales. Focused changes15/15, package client3/3 и scoped lint PASS; packageDB b7125f36789845fa98329de1ed986d76 migrate/seed+1/1/cleanup PASS. Connected run eee78a11d60d4d178bef8d16c9634e3c: dependencies + project-packages connected,2files/8tests PASS, migrate/seed/cleanup. Реальные apply→persisted revisions→DOCX/XLSX→ZIP→reopen сохраняют manual phrase/formula/revision manifest; origin403/actor409/query422/ACL404 проверены. Общие type/build/nav compilation PASS. Source/tests quiescent; пользовательская визуальная проверка не подменена этими доказательствами.

## 03.2 Сохранить контекст бизнеса, передать работу и повторить её
Status: done
Requirements: R01, R05, R10, R11, R12, R13, R16, R22, R23, R24, R25, R32, R34, R35, R36, R39, R41, R42, R43, R44, R45, R90, R91, R94, R96, R99, R103, R105, R109
Depends on: none
Owner: SUBAGENT business_continuity
Paths: src/features/business-context/, src/features/collaboration/, src/features/recurring-work/, tests/business-context/, tests/collaboration/, tests/recurring-work/, evals/recurring-work/, src/app/api/business-context/, src/app/api/comments/, src/app/api/work-rules/, src/app/api/outcomes/, src/app/api/collaboration/, src/app/app/business/, src/app/app/team/

**Результат.** Подтверждённые правила/бренд/контакты/допущения помогают следующей задаче без повторного ввода. Владелец даёт сотруднику нужный проект, коллега комментирует или согласует конкретную версию. Из завершённой работы можно подготовить следующий период по новым данным; фактический результат записывается отдельно от прогноза. Ресурс планирования и аккаунт сотрудника различаются.

**Контракты.** PROJECT C3/C10 и K6. BusinessContext/BrandKit versioned, scope/owner/confirmation/source explicit; вывод модели не становится постоянным правилом сам. BusinessProfile/Customer/Supplier связи не требуют переноса всей CRM. Comments/approval target artifact version + stable target/selection, revisions и resolved state; revoke действует на источники/files/run/citations. WorkRule version: source selectors, mapping versions, capability/procedure version, schedule/new-source/manual trigger, timezone, outputs policy. OccurrenceId+ruleVersion unique; повтор создаёт новую ветку, никогда не перезаписывает предыдущий период и не отправляет сообщения/публикации наружу.

**Порядок.** Сначала контекст/контрагенты/brand CRUD и explicit use из сессии, затем project roles/share/invite accept/revoke с существующим auth; workflow agreement/comment UI; versioned repeat/outcomes с current tools. Автоматический запуск только из явно включённого пользователем правила, bounded budget/queue/cancel и audit receipt. Schema drift спрашивает mapping, отсутствующая source/permission остановит затронутую работу. Регистрацию и DB migration передать 01.3; изменения используют 03.1. Email invitations допустимы только по явной команде пользователя продукта; в разработке Mailpit/synthetic адреса.

**UI.** «Бизнес» необязателен для первого результата. «Сохранить правило», «Пригласить», «Согласовать эту версию», «Подготовить следующий период» являются контекстными действиями; их эффекты понятны до нажатия. Списки людей/ресурсов/правил, empty/paused/running/failed/needs-mapping/ready, permission denial и return context по DESIGN; RU/KK/EN и narrow.

### 03.2.1 Контекст и командная работа с правами
Status: done
Owner/editor/reviewer/foreign member через HTTP; comment/approval привязаны к версии, повторный revoke запрещает поздний доступ и write. Подтверждённое правило влияет на новую задачу, локальный override не изменяет его глобально.

### 03.2.2 Повтор по новым данным и проверяемый итог
Status: done
P5: новая source version → один occurrence → новая ветка → review → reopen; duplicate event/cancel/restart/schema drift/limits сохраняют прежнюю работу. Actual outcome записан с периодом и источником, не объявляет причинный рост от Tirlik. Новый запуск проходит настоящие domain tools.

03.2 whole-file handover принят в9b4c339 и quiescent: versioned business context/brand/archive/restore/overrides, project member scopes, exact-version comments/resolve/approve/request-changes, recurring rules/limits/idempotency/cancel/restart и outcomes. Artifact-thread подключён к authenticated editor, учитывает exact revision/recovery/autosave/operation и не делает authenticated requests из demo. Canonical RecurringRunBridge интегрирован runtime owner: business.goal@1, pinned source revisions/branch artifact0, trusted context/authority/currentArtifact, rule budget; cancel и continuations сохраняют canonical epoch/authz/budget. Bridge unit2/2, scoped lint/diff и shared typecheck PASS. Isolated run754730309ed54a35a8f5880a9252849e: migrate/seed,6files/50tests PASS (runtime/business/context/collaboration/recurring/campaign), cleanup/pruning PASS. Общий production build PASS; UI принимает пользователь.
