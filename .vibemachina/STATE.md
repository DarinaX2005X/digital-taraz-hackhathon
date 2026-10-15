# Состояние проекта
Phase: build
Approval: approved
Active stage: 04
Active task: 04.1

## Сейчас

Полный Tirlik v4 утверждён пользователем 2026-10-13 ответом «подтверждаю!», утверждённая содержательная версия `f5f1da6230454c3d04aef02f6142bf40e37e3d8f`. Сохраняются C1-C14, J1-J5, 15 этапов, 43 задачи, 86 checkpoints и теперь 106 требований. Существенного сокращения объёма или новой концепции нет.

Первый приоритет изменён прямыми F008/F009. Пользователь не принимает обычное редактирование и связанную правку цены как убедительную причину перейти из Word/Excel. AI должен быть видимой основой рабочей сессии и ассистентом по финансовым и операционным задачам; внутри этой сессии открываются полноценные предметные компоненты и редакторы. Первый proof начинается со свободной цели, показывает изменяемый план AI, несколько реальных инструментальных операций, существенный вопрос, финансовое или операционное решение человека и применимые результаты. Generic chat, скрытый AI, редактор сам по себе и одна автоматическая правка proof не закрывают.

Новый VibeMachina plan contract применён: PLAN содержит обещание, общие контракты и граф; stage files содержат task/checkpoint status и evidence; PLAN-HUMAN объясняет те же ID без статусов; этот STATE является коротким recovery cursor. `check-plan.mjs` после изменения проходит: 15 stages, 43 tasks, 86 checkpoints, 106 requirements, без конфликтов путей.

Git остаётся на `8aa783453935c0e2553e81a7ba7c58488b223120` (`origin/main`). Поверх него находится большой незакоммиченный, но ранее проверявшийся WIP: sources/materials, workspace, documents, sheets, designs, exports, runtime/tools, demo/onboarding и миграции 0011-0016. Старый MAIN не завершил обещанный handoff checkpoint. Никаких прежних workers не восстановлено; source writers сейчас отсутствуют.

## Следующие шаги

1. Завершить свежий read-only value/code review по исходному BRIEF/TESTING и F008/F009. Он проверяет реальный committed+WIP путь без чтения планового оправдания на первом проходе и не пишет файлы.
2. Сохранить существующий WIP отдельным честным checkpoint через штатный `checkpoint.mjs` после plan/privacy/code/build checks. До этого source writers не запускаются, чтобы не менять validation inputs. Это WIP boundary, не принятие всех активных задач.
3. После checkpoint назначить свежего integration owner на общий prerequisite package: server-authoritative prepared calculations с immutable input/content hash и transactional revision/ACL revalidation; корректный currency scale для разных валют; property-scoped binding targets без geometry-as-value override; совместимый additive PlanEntry; затем BusinessContext provenance union. Не копировать целиком ignored scratch.
4. Параллельно назначить свежих whole-journey owners на assistant-first 03.2/04.1/07.1 и на реальные предметные компоненты по непересекающимся путям. Главный пользовательский пакет: цель -> AI plan/tools -> решение по экономике/сроку/нагрузке -> estimate/offer/plan -> direct edit -> fixed export/reopen -> новая вводная и review изменений.
5. Выполнить bounded live J1 только после server calculation authority, runtime ledger/readiness и HTTP integration. Реальный provider proof не повторяет старый connectivity test и не запускается при неопределённой цене/резерве.

## Проверено

- Новый плановый контракт: `node C:/Users/user/.codex/skills/vibemachina/scripts/check-plan.mjs C:/Users/user/Desktop/digitaltaraz` PASS после R106 и исправления write-path graph.
- Последний принятый baseline `999e1e25951569e7ceff6fecb69b9b3438dce89f` и dependency checkpoint `8aa783453935c0e2553e81a7ba7c58488b223120` pushed в `origin/main`.
- Перед передачей старый общий runner проходил type, lint и 771/771 unit tests; production build был успешен до последующих bounded changes. Эти результаты не подтверждают текущий dirty snapshot.
- В текущем WIP есть focused/DB/HTTP evidence по materials, sources, editors, exports, runtime и demo, записанное в соответствующих stage tasks. Полная новая сборка, вся HTTP-матрица и live J1 ещё не приняты.
- Критические известные границы до live/financial acceptance: не доверять client cached formula value; не использовать универсальное minor/100; geometry/style-only change не создаёт value override; text/fill bindings независимы.
- Внешний вид, ясность AI-first композиции, 3–5 секунд понимания и 2–3 минуты знакомства не проверены агентами и остаются пользовательской проверкой.

## Сервисы

Dashboard: http://127.0.0.1:4177/

Последняя проверка handoff показала продукт `http://127.0.0.1:59676/` недоступным; прежние PID исторические. PostgreSQL `54329` и Mailpit `8029` не считать текущими без новой штатной health-проверки. Продукт восстанавливается после checkpoint через `node scripts/dev/start.mjs --port 59676`, без открытия вкладок; данные/volumes не удалять.

## Работники

- `/root/value_evidence_review`: свежий GPT-5.6 Sol, xhigh, read-only. Полный BRIEF/TESTING и новое сообщение F009 переданы дословно. Проверяет ценность против Word/Excel/generic chat и фактическую AI-assistant цепочку. Paths: none; Git/memory edits/provider calls/browser automation запрещены.
- Активных source writers нет. Имена старых работников в stage evidence и ignored scratch обозначают только историческое авторство, не ownership.

После WIP checkpoint новые самостоятельные области получают новых GPT-5.6 Sol workers с medium/high/xhigh по сложности. Каждый читает полный BRIEF, TESTING и требуемые VibeMachina references; UI workers дополнительно читают DESIGN, foundation, anti-slop, UX, copy/system/art и полный F009.

## Передача

Только VibeMachina; другие skills/plugins не используются. MAIN владеет памятью, Git и координацией; substantial source review, implementation и integration делегируются. Визуальная/browser проверка полностью принадлежит пользователю: никаких CUA, Playwright, Selenium, Puppeteer, headless, screenshots или обходов через worker/renderer.

Работа только локальная. Hosting search, cloud deploy и probes отложены пользователем до выбора сервера. Git только через `C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs` с реальными checks, explicit paths и `--push` в проверенный upstream. Private `.vibemachina/BRIEF.md`, `.vibemachina/TESTING.md`, `.vibemachina/runtime/`, `.local-data/` и env не публикуются.

Общий новый OpenRouter ceiling: USD 10. Последний подтверждённый новый расход `$0.00008652`, новый reserve `0`; старый отдельный ledger confirmed `$0.0400707`, unresolved `$0.480832`, attempted ceilings `$0.81472` сохраняется. Не освобождать uncertain reserve и не делать blind retry. Платные обращения выполняет один назначенный executor после quote/reservation/readiness; secrets остаются server-only.

Ignored `.local-data/agent-scratch/` содержит частичные пакеты старых авторов. Продвигать только review mapped paths после сравнения с active source; полный каталог поверх проекта не копировать. Подробный фактический progress остаётся в stage tasks, а не дублируется здесь или в новых handoff/queue/report файлах.
