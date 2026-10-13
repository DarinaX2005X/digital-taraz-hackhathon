# Состояние проекта
Phase: build
Approval: approved
Active stage: 02
Active task: 02.1

## Сейчас

2026-10-13, Asia/Qyzylorda. Полный план утверждён: «подтверждаю!», содержательная версия f5f1da6230454c3d04aef02f6142bf40e37e3d8f. Продолжается полный объём 15 этапов / 43 задачи / 86 checkpoints, не только foundation или первый slice.

01.1, 01.2, 01.3 приняты. Последний checkpoint 67b2dbfdbcad6b2c16e7c343ed2c5de137f6e9b3 pushed origin/main, все 7 configured checks PASS: fixtures01.3.2, hosting server/CLI/direct proofs, shared dependencies/config/isolation. 01.4.1 capability gate принят с явными ограничениями; 01.4.2 remote Workflow proof пока не выполнен.

02.1.1 оба workers передали пути и STOP. Server: 10 focused unit tests, TypeScript/scoped ESLint и 18 real HTTP/DB/Mailpit tests PASS. UI: 59 tests / 6 files, TypeScript/scoped ESLint PASS. MAIN смонтировал entry/auth/settings routes, provider/server locale, применил migration0003 к локальной базе и добавил HTTP route/SSR проверки. /sign-in HTTP200, guest /api/identity/me ->401. Начинается общий checkpoint. Полноценного рабочего раздела03.2 и landing10.1 ещё нет. F001 остаётся in-progress до интегрированной проверки и затем пользовательского осмотра.

Последнее указание пользователя: не отклоняться от плана, давать агентам крупные самостоятельные пакеты. Последний вопрос о пустом сайте сохранён целиком в TESTING/F001 и передан обоим identity workers. Готовность инфраструктуры не объявляется готовностью экранов.

## Следующие шаги

1. Выполнить штатный checkpoint02.1.1 с explicit paths и --push. Оба identity workers STOP. После PASS отметить checkpoint done, обновить F001, выдать02.1.2.
2. После checkpoint выдать обоим identity workers02.1.2 (invites/workspaces/ACL/revoke/delete) с новым loan migrations/0004_identity_workspaces.sql. Migration0003 после фиксации immutable. Затем02.1 acceptance позволяет независимо начать03.1.
3. 02.2 зависит от полного01.4 и02.1. 01.4.2 start/redeploy/resume отклонён инструментальной средой до создания процесса (`blocked by policy`). Не повторять тот же эффект другим транспортом/агентом/командой. Workflow не запускался, journal отсутствует. Требуется разрешение ограничения среды; независимая разработка продолжается.
4. После03.1 возможен shell03.2. Sources02.3 ждут02.2, mapping02.4 ждёт sources; первый полный provider/edit/save/export путь04.2. Читать реальные Depends on, не менять план ради заглушки.

## Проверено

- План: 15 stages, 43 tasks, 86 checkpoints, 105 requirements; check-plan ранее без ошибок/предупреждений. Доказательства отдельных задач в stages, архитектурные ограничения в PROJECT C1-C14.
- Commits: 01.1 84bc4af; 01.2.1 590789a; 01.3.1/01.4.1 8a7580f; 01.2.2 566291f; 01.3.2 и hosting package 67b2dbf. Все pushed.
- Identity server: настоящее signup/verify/login/reset/change password/logout, replay/expiry/session revoke, CSRF, stale actor, чужие session/intent и rate limit проверены на изолированных PostgreSQL/Mailpit/Next. UI/browser и настоящая Brevo delivery не проверены.
- SMTP STARTTLS authentication PASS, From указан пользователем и задан в private env. Используется canonical SMTP_PASSWORD; лишние BREVO_API_KEY/BREVO_SMTP_KEY удалены по поручению пользователя. Локальный запуск/автотесты только Mailpit и очищенные external credentials.
- MAIN navigation parser: 3 tests PASS для allowlist/opaque intent/ambiguous query/token bounds. Local restart сохранил базу/файлы и порт, /api/health200 database ready.
- Fixtures и preflight proofs подробно в stage01. Live AI ledger partial: confirmed $0.0400707, unresolved reservation $0.480832, attempted ceilings $0.81472 <= $1. Не повторять ambiguous paid call. Mimo metadata expiration2026-10-21 обработать до02.2.
- Dependencies pinned; remaining audit: 3 moderate production entries (Mammoth CLI sprintf-js/argparse chain) и 5 high dev Next ESLint/braces, без доступного совместимого patch. Не выполнять audit fix --force и не заявлять исправленными.

## Сервисы

Local: http://127.0.0.1:59676/
Mailpit: http://127.0.0.1:8029/
Дашборд планирования: http://127.0.0.1:4177/

Локальный Next dev --webpack следит за source. Supervisor PID115104, Next PID127476, instance91e820dd-c239-423f-b355-8a9ffe68a1d3, ready. Logs в .local-data/dev; runtime token приватен. Штатные node scripts/dev/stop.mjs и start.mjs сохраняют PostgreSQL54329, Mailpit и данные. Никаких автоматических вкладок. Видимое Fast Refresh поведение проверяет пользователь.

Vercel tirlik: project prj_Wv5YQjbYlzVgN3UFCdwHbaq49cbq, Hobby, runtime region config fra1. Genuine preview READY: https://tirlik-fiiaz5b4w-darinax2005xs-projects.vercel.app, dpl_9miTEtGmYdWdAFYhWLyauLh4uoWW, source67b2dbf. Первый bootstrap неожиданно стал production по поведению нового project: tirlik.vercel.app, dpl_8UingSucoL56TBk2eT89S3yKtump. Production DB/mail/AI secrets не заданы, probe disabled, это не продуктовый launch.

Neon tirlik-preview-db free_v3/fra1 и private Blob tirlik-preview-files/fra1 связаны только с preview. Remote migrations0001+0002 применены через direct DB URL. 0003 remote не применён. Private hosting-preview.env и hosting-control.env в ignored runtime. Automation bypass создан только для tirlik; deployment protection сохранена. Working Vercel63.1.2 CLI: C:/Users/user/AppData/Local/npm-cache/_npx/f56f1f0dfbede539/node_modules/vercel/dist/vc.js; глобальный shim сломан.

Direct Neon TLS/reconnect/unique UUID и private Blob write/read/hash/anonymous403/overwrite denial PASS; synthetic cleanup подтверждён. HTTP Workflow proof не запускался из-за policy rejection. Deploy источник из git archive67b2dbf в ignored runtime, не текущий незавершённый identity worktree. Активных MAIN exec sessions нет.

Hobby noncommercial restriction, Kazakhstan personal-data/backup region gate и processor privacy остаются открытыми. Synthetic preview не доказывает допустимость настоящих аккаунтов/business production; не отключать регистрацию или публичную поставку молча. Свидетельства в tests/preflight/evidence/hosting-facts.json и PROJECT C12/C14.

## Работники

- /root/foundation: 02.1.1 DONE/STOP. Пути переданы MAIN: src/features/identity/server/, domain/, contracts.ts,index.ts; tests/identity/server/,domain/; src/server/db/identity-schema.ts и migrations/0003_identity.sql. Следующий02.1.2 только после release.
- /root/ui_foundation: 02.1.1 DONE/STOP. Переданы src/features/identity/ui/, locales/, tests/identity/ui/. Forms/modal/recovery/profile/password/sessions/account menu + минимальный account entry, ru/kk/en; 59 tests PASS. Общие src/ui и src/i18n уже MAIN. Следующий02.1.2 после release.
- /root/preflight: 01.4.2 STOP, server/CLI/evidence переданы. Remote command отклонён до процесса, retry не было.
- /root/business_fixtures: 01.3.2 DONE/STOP, пути переданы и committed.
- Старые plan_reader_v4/plan_review больше не пишут.

MAIN единолично владеет памятью/Git, package/lock/config, app routes/layout, shared contracts/schema/migrations кроме явно выданных loans. Сейчас MAIN добавил identity route composition/navigation tests/schema re-export, worker files не переписывает. Каждый новый worker читает полный оригинальный BRIEF, все последующие дословные remarks, relevant TESTING и skill domain/design references. Краткий dispatch не заменяет исходники.

## Передача

Tirlik. «Всё для вашего бизнеса». Полные актуальные спецификации: PROJECT, DESIGN, PLAN, PLAN-HUMAN, REQUIREMENTS и stages. Отдельные пользовательские замечания в BRIEF/TESTING, не новая система отчётности. BRIEF содержит только долговременные требования и полезные исходные замечания, не «продолжай»/лимиты/координацию.

Внутренняя работа бизнеса, покупатели остаются в его каналах. Полноценные прямые редакторы, undo/redo/версии, адресные защищённые AI-правки, реальные файлы и сохранение ручной работы. Обучение skip/resume/replay из настроек. Synthetic fixtures явно обозначены; данные бизнеса предоставляет конечный пользователь. Никаких выдуманных интервью/эффекта/срока жюри.

OpenRouter key не печатать и не менять. Primary xiaomi/mimo-v2.5; только разрешённые экономичные modality replacements, без GPT/OpenAI/Claude/Anthropic/дорогого fallback. Цена, modality и полный бюджет проверяются, включая OCR/image.

Git только C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs с реальными configured checks, явными --paths и --push в проверенный origin/main. Он fingerprint всех nonignored source: перед проверками остановить всех writers даже вне commit scope. Частые coherent checkpoints. Runtime/BRIEF/TESTING/env остаются ignored, никогда force-add; другие planning docs разрешены. Product checks/launch работают без скилла.

Полный комплект сдачи: продукт Vercel без своего сервера, repo, название/русское описание, проверенный README/clean launch, презентация «вайбпреза» и видео после стабильного продукта/README с последующим встраиванием. Не объявлять04.2 окончанием.

Весь browser/visual QA выполняет пользователь: никакого CUA/browser-control/Playwright/Selenium/Puppeteer/headless/screenshots/автоматических вкладок или обхода через shell/worker/renderer. Разрешены статические/domain/unit/server/HTTP/API проверки. Непроверенный UI не называть визуально принятым.
