# 10 Публичный сайт, пример и понятное первое использование
Status: todo

Новый посетитель должен понять продукт и безопасно попробовать его, а вошедший пользователь быстро начать свою работу. Пример и обучение не создают чужие или лишние записи в аккаунте.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 10.1 Показать продукт и привести к настоящей работе
Status: todo
Requirements: R02, R07, R08, R09, R19, R21, R28, R29, R30, R31, R38, R40, R41, R44, R45, R46, R47, R48, R49, R64, R101
Depends on: 04.2, 06.3, 07.2, 01.2
Owner: SUBAGENT to assign
Paths: src/features/public-site/, public/site/, tests/public-site/

**Контракт и результат.** C1, DESIGN публичная часть. Full ru/kk/en site /[locale], clear Tirlik H1 and «Всё для вашего бизнеса», literal supporting examples, visible «Начать работу» and «Посмотреть пример», how-it-works visible before FAQ, actual useful scenarios and footer to product/help/privacy/contact/repo. No pricing or fake partners/results/testimonials. Relevant real or generated subject bitmap carrying business materials, not AI-fake screenshot; actual product views only supplied by user. Fullbleed hero text notcard/notsplit, nextsection hint across widths per DESIGN. MAIN owns routes/SEO metadata registry.

**Вход в работу и состояния.** CTA to real work entry/auth preserving intent, demo explicit; shared profile/session and language. Public URL stays public after signin, correct404, accessible footer and no dead links. Motion modest/reduced-motion; assets dimensions/alt/loading budgets; no imposed auto browser.

### 10.1.1 Содержательная публичная часть
Status: todo

Content and route inventory verified HTTP statuses/destinations, factual claims traced to implemented functions, complete locales/no tariffs. Asset license/hash/dimensions checked, not visual approval.

### 10.1.2 Первое действие и возврат
Status: todo

HTTP auth intent/locale persistence, public/private boundary and footer link checks. User judges first3-5seconds, CTA prominence, text fit/mobile and meaningful illustration.

## 10.2 Дать интерактивный пример без нежелательных записей
Status: todo
Requirements: R08, R21, R24, R26, R27, R75, R76, R82, R99
Depends on: 08.3, 10.1, 01.3
Owner: SUBAGENT to assign
Paths: src/features/demo/, tests/demo/

**Контракт и результат.** C1, C3-C4, C13. Isolated demo snapshots of meaningful business projects, same editors/calculation/tool contracts with ephemeral sandbox commands and TTL; no access to private or shared mutable demo record. Viewing/replaying requires no personal rows, live AI only explicit bounded action with abuse limit if supported; otherwise labelled prepared result not fake streaming generation. «Скопировать в мою работу» after explicit auth retains demo edits via validated payload, remaps all IDs/source ACL, exactly-one owned project per idempotency key, no unwanted copy during tour.

**Вход в работу и состояния.** Visitor can change assumption/text/layer, undo and see dependent proposal using isolated synthetic data; clear label/progress and reset. Three businessmodels show distinct jobs, not mandatory wizard. Logged-in user viewing demo stays in demo until copy; failure retains temporary edits. Phone same core direct edits.

### 10.2.1 Изолированное испытание
Status: todo

Record counts before/after anonymous and logged-in view/replay unchanged; cross-session no edit leakage, TTL cleanup, same domain function golden result.

### 10.2.2 Осознанная копия и продолжение
Status: todo

Login cancel/error preserves intent; explicit copy creates one project+correct assets, replay request no duplicate, reopen manually modified copy. User verifies demonstration feels like actual work.

## 10.3 Провести первое обучение и сохранить возможность повторить
Status: todo
Requirements: R08, R24, R29, R32, R33, R39, R40, R44, R45, R97, R98
Depends on: 10.2, 09.2, 03.2
Owner: SUBAGENT to assign
Paths: src/features/onboarding/, tests/onboarding/

**Контракт и результат.** DESIGN обучение/первый опыт, C13. Mandatory implementation of first-signin contextual tour with skip/resume/replay Settings -> Обучение and Help. Progress versioned per user, not reset after each login; active goal preserved. Anchors based on semantic IDs wait for real element readiness, absent permission/route step skipped with proper alternate, never trapping overlay. Steps own material/goal/result directedit/sources/changes/export; microtour by editor on firstuse optional. Demo tour isolated, no silent projectcreation, no requirement to finish before work.

**Вход в работу и состояния.** Welcome short choice start own work or guided example, free-form entry remains visible. Controls next/back/skip/close with focus restore, user can continue from settings; mobile step avoids target occlusion. Copy uses natural verbs/locales, not instructional filler across every permanent screen.

### 10.3.1 Состояния тура и отсутствие побочных записей
Status: todo

Pure tour-state tests skip/resume/versionchange/missinganchor/authreturn, API progress persists and no business rows created. Returning user not forced through tour again.

### 10.3.2 Связанный первый проход
Status: todo

Routes/labels/settings replay traced to real handlers and all locales; user timed own small case including upload/AI/save/edit/export. Record actual timing and stumbling points, not API benchmark as UX proof.

