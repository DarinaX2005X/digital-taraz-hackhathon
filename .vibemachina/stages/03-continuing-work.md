# 03 Связанные изменения, команда и следующий период
Status: todo

Старт по contract не равен готовности: обязательные producer handovers до done находятся в PLAN, включая K7; partial/mock результат не закрывает пакет.

Работа остаётся пригодной после изменения входов, перехода к коллеге и возвращения через неделю. Два крупных пакета завершают среду вокруг разовой AI-сессии; они начинают по утверждённым C6/C10/K6 параллельно 01–02. Общую интеграцию принимает 04.1.

## 03.1 Согласовать изменения и выпуск всего комплекта
Status: todo
Requirements: R10, R14, R16, R25, R32, R33, R39, R40, R43, R92, R93, R94, R95, R96, R102, R103, R105
Depends on: none
Owner: SUBAGENT to assign
Paths: src/features/dependencies/, src/features/change-review/, src/features/project-packages/, tests/dependencies/, tests/change-review/, tests/project-packages/, src/app/api/changesets/, src/app/api/packages/

**Результат.** При новом прайсе/сроке/объёме Tirlik находит связанные материалы и предлагает конкретные изменения с основаниями. Пользователь видит affected fields, ручные решения и конфликты, принимает подходящее; выпускает согласованный комплект без смешения разных ревизий. Entry — индикатор изменения в сессии/материале и «Проверить изменения», отдельная page только для полного review, не новый обязательный мастер.

**Механизм.** C6/K6: stable fact/record/property IDs, causal groups, source/artifact revision vector; semantic value отдельно от geometry. Manual override/lock сохраняются, deleted target/row/schema drift требуют адресной коррекции, stale preview409 пересчитывается. Apply/undo одной causal group атомарны, общий epoch/ACL recheck перед commit. Redacted/private lineage не выдаётся получателю без прав. Package manifest фиксирует версии, выбранные файлы, audience/policy и known omissions; повтор скачивает тот же комплект.

**Порядок.** Reconcile существующий dependency/review код, закрыть missing propagation/lock/branch cases; передать decorations/commands editors 01.6/02.2/01.4 через их owners. Затем review UI с выбором/сравнением, package collection/export/export retry. UI по DESIGN: причина и поля рядом, selected/partial/conflict/disabled выразительны, keyboard list/tree и narrow drill-down; RU/KK/EN. Рендеры файлов использует 01.6/02.2, свой второй exporter не создаёт.

### 03.1.1 Изменения сохраняют решения человека
Status: todo
P5: source changed + manual phrase + geometry change + locked price; правильные reachable fields, no overwrite, concurrent commands/undo conflict и revoke проверены domain/DB. Отказ части dependency не объявляет весь проект актуальным.

### 03.1.2 Согласованный выпуск и возврат
Status: todo
Apply selected group → persisted material revisions → реальный package manifest/files → reopen. Missing asset/failed render даёт повтор нужной части; остальные ready artifacts остаются. Пользователь проверяет ясность diff/review и полноту скачанного комплекта.

## 03.2 Сохранить контекст бизнеса, передать работу и повторить её
Status: todo
Requirements: R01, R05, R10, R11, R12, R13, R16, R22, R23, R24, R25, R32, R34, R35, R36, R39, R41, R42, R43, R44, R45, R90, R91, R94, R96, R99, R103, R105, R109
Depends on: none
Owner: SUBAGENT to assign
Paths: src/features/business-context/, src/features/collaboration/, src/features/recurring-work/, tests/business-context/, tests/collaboration/, tests/recurring-work/, evals/recurring-work/, src/app/api/business-context/, src/app/api/comments/, src/app/api/work-rules/, src/app/api/outcomes/, src/app/api/collaboration/, src/app/app/business/, src/app/app/team/

**Результат.** Подтверждённые правила/бренд/контакты/допущения помогают следующей задаче без повторного ввода. Владелец даёт сотруднику нужный проект, коллега комментирует или согласует конкретную версию. Из завершённой работы можно подготовить следующий период по новым данным; фактический результат записывается отдельно от прогноза. Ресурс планирования и аккаунт сотрудника различаются.

**Контракты.** PROJECT C3/C10 и K6. BusinessContext/BrandKit versioned, scope/owner/confirmation/source explicit; вывод модели не становится постоянным правилом сам. BusinessProfile/Customer/Supplier связи не требуют переноса всей CRM. Comments/approval target artifact version + stable target/selection, revisions и resolved state; revoke действует на источники/files/run/citations. WorkRule version: source selectors, mapping versions, capability/procedure version, schedule/new-source/manual trigger, timezone, outputs policy. OccurrenceId+ruleVersion unique; повтор создаёт новую ветку, никогда не перезаписывает предыдущий период и не отправляет сообщения/публикации наружу.

**Порядок.** Сначала контекст/контрагенты/brand CRUD и explicit use из сессии, затем project roles/share/invite accept/revoke с существующим auth; workflow agreement/comment UI; versioned repeat/outcomes с current tools. Автоматический запуск только из явно включённого пользователем правила, bounded budget/queue/cancel и audit receipt. Schema drift спрашивает mapping, отсутствующая source/permission остановит затронутую работу. Регистрацию и DB migration передать 01.3; изменения используют 03.1. Email invitations допустимы только по явной команде пользователя продукта; в разработке Mailpit/synthetic адреса.

**UI.** «Бизнес» необязателен для первого результата. «Сохранить правило», «Пригласить», «Согласовать эту версию», «Подготовить следующий период» являются контекстными действиями; их эффекты понятны до нажатия. Списки людей/ресурсов/правил, empty/paused/running/failed/needs-mapping/ready, permission denial и return context по DESIGN; RU/KK/EN и narrow.

### 03.2.1 Контекст и командная работа с правами
Status: todo
Owner/editor/reviewer/foreign member через HTTP; comment/approval привязаны к версии, повторный revoke запрещает поздний доступ и write. Подтверждённое правило влияет на новую задачу, локальный override не изменяет его глобально.

### 03.2.2 Повтор по новым данным и проверяемый итог
Status: todo
P5: новая source version → один occurrence → новая ветка → review → reopen; duplicate event/cancel/restart/schema drift/limits сохраняют прежнюю работу. Actual outcome записан с периодом и источником, не объявляет причинный рост от Tirlik. Новый запуск проходит настоящие domain tools.
