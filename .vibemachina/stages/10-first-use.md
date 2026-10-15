# 10 Публичный сайт, пример и понятное первое использование
Status: active

Новый посетитель должен понять продукт и безопасно попробовать его, а вошедший пользователь быстро начать свою работу. Пример и обучение не создают чужие или лишние записи в аккаунте.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 10.1 Показать продукт и привести к настоящей работе
Status: active
Requirements: R02, R07, R08, R09, R19, R21, R28, R29, R30, R31, R38, R40, R41, R44, R45, R46, R47, R48, R49, R64, R101
Depends on: 01.2, 02.1
Owner: /root/journey_delivery
Paths: src/features/public-site/, public/site/, tests/public-site/, src/app/page.tsx

Точные дополнительные loans public_auth: `src/app/[locale]/page.tsx`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/help/page.tsx`, `src/app/[locale]/privacy/page.tsx`. Только эти файлы, не wildcard subtree. Next dynamic routes перечислены буквально вне glob metadata; MAIN отдельно сверяет ownership. Существующие auth/settings/shared UI loans перечислены в STATE и не пересекаются с server/runtime/workspace owners.

Дополнительный bounded loan `src/app/[locale]/not-found.tsx` для полноценной локализованной404 при неизвестном locale/path; текущий checkpoint выявил реальный SSRerror shell вместо h1/lang/home link. Owner исправляет root/locale error boundary по installedNext docs, не снижает HTTP acceptance и не меняет остальной frozen UI.

Bounded repair принят2026-10-14: locale layout закрывает набор ru/kk/en через generateStaticParams/dynamicParams=false, local not-found использует общую страницу.4invalid routes возвращают полноценный404 HTML с h1/lang/home и безerror shell;5valid routes200. Independent isolated identity route suite4/4PASS включает auth intent/workspace/privatequery иinvalidfilter recovery. Rootlayout/next.config для исправления не менялись; public owner STOP. Это серверная проверка, не визуальная приёмка.

Прямое новое поручение пользователя2026-10-14: полноценный landing и заметно переработанные вход/регистрация нужны сейчас, прежнее ожидание04.2/06.3/07.2 для начала публичной страницы отменено. Реальный ранний site/auth workflow строится на уже принятом account/UI foundation. Полные предметные примеры и demo10.2 добавляются после фактической готовности соответствующих сценариев; не изображать недоступные handlers работающими и не считать весь продукт принятым. Исходное полное сообщение в BRIEF/TESTING обязательно. Feature owner сам монтирует свои страницы, shared root integration отдельно.

**Контракт и результат.** C1, DESIGN публичная часть. Full ru/kk/en site /[locale], clear Tirlik H1 and «Всё для вашего бизнеса», literal supporting examples, visible «Начать работу» and «Посмотреть пример», how-it-works visible before FAQ, actual useful scenarios and footer to product/help/privacy/contact/repo. No pricing or fake partners/results/testimonials. Relevant real or generated subject bitmap carrying business materials, not AI-fake screenshot; actual product views only supplied by user. Fullbleed hero text notcard/notsplit, nextsection hint across widths per DESIGN. MAIN owns routes/SEO metadata registry.

**Вход в работу и состояния.** CTA to real work entry/auth preserving intent, demo explicit; shared profile/session and language. Public URL stays public after signin, correct404, accessible footer and no dead links. Motion modest/reduced-motion; assets dimensions/alt/loading budgets; no imposed auto browser.

### 10.1.1 Содержательная публичная часть
Status: active

Исходное F002 и полное последующее замечание в BRIEF обязательны исполнителю: нынешняя account-entry страница не заменяет лендинг. Сделать самостоятельную публичную подачу с отдельным входом и собственной предметной композицией, не расширять стандартную форму до якобы готового сайта. Внешний вид утверждает пользователь.

Content and route inventory verified HTTP statuses/destinations, claims traced to approved product specification, complete locales/no tariffs. Asset license/hash/dimensions checked, not visual approval. По прямому последующему указанию пользователя публичная copy представляет полную целевую Tirlik до релиза, без временных «пока доступны только настройки», «это иллюстрации, не результаты» и прочих dev-status отчётов. Это разрешение на целевую подачу для её оценки, не приёмка отсутствующего кода; actual readiness отдельно в STATE/чате. Не выдумывать клиентов/отзывы/метрики. Неработающие handlers не симулируются.

Первый mounted handover public/auth: ru/kk/en landing, help/privacy/footer, отдельные формы, localMail hint и width refinement;17 HTTP routes/invalidlocale404,215 focused tests иtype/lint PASS, independent HTTP locale/home/help/privacy/auth/image PASS. Пользователь одобрил фон landing hero, но требует отдельную PNG/SVG-графику для авторизации, более выразительные hover и сокращение больших боковых отступов, включая privacy. Owner продолжает связанное refinement вместе с целевой copy; checkpoints остаются active до этого handover и общей интеграции. Весь интерфейс визуально принятым не объявлен.

### 10.1.2 Первое действие и возврат
Status: todo

HTTP auth intent/locale persistence, public/private boundary and footer link checks. User judges first3-5seconds, CTA prominence, text fit/mobile and meaningful illustration.

## 10.2 Дать интерактивный пример без нежелательных записей
Status: active
Requirements: R08, R21, R24, R26, R27, R75, R76, R82, R99
Depends on: 03.1, 01.3
Owner: /root/connected_delivery
Paths: src/features/demo/, tests/demo/

Уточнение2026-10-15: пример начинается вместе с первым реально редактируемым J1 на общих typed operations, не ждёт полного08.3. Ранний checkpoint: изолированные подготовленные synthetic смета+предложение, ручная правка, изменение цены/количества через тот же расчёт и адресное предложение, undo/reset без личных записей. Не имитировать генерацию/streaming и не рисовать pretend controls. По мере готовности08/exports подключить реальный export и явную copy-to-account; полная10.2 приёмка остаётся после08.3/10.1 и всех трёх бизнес-моделей. URL и UI entry получает этот feature owner через точный loan от MAIN, не скрытая страница по неизвестной ссылке.

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
Depends on: 03.2
Owner: /root/journey_delivery
Paths: src/features/onboarding/, tests/onboarding/

Уточнение2026-10-15: первый вход, skip/resume/replay и доступные real-action steps разрабатываются сразу с03.2. Отсутствующий optional anchor не блокирует работу и не показывает несуществующую функцию. Demo10.2 и командные09.2 шаги присоединяются после их integration; полная10.3 acceptance включает обе исходные зависимости и все editor/export шаги. Никакой предварительной анкеты/автосоздания проектов. Свой goal/material и выбранное до входа намерение сохраняются.

**Контракт и результат.** DESIGN обучение/первый опыт, C13. Mandatory implementation of first-signin contextual tour with skip/resume/replay Settings -> Обучение and Help. Progress versioned per user, not reset after each login; active goal preserved. Anchors based on semantic IDs wait for real element readiness, absent permission/route step skipped with proper alternate, never trapping overlay. Steps own material/goal/result directedit/sources/changes/export; microtour by editor on firstuse optional. Demo tour isolated, no silent projectcreation, no requirement to finish before work.

**Вход в работу и состояния.** Welcome short choice start own work or guided example, free-form entry remains visible. Controls next/back/skip/close with focus restore, user can continue from settings; mobile step avoids target occlusion. Copy uses natural verbs/locales, not instructional filler across every permanent screen.

### 10.3.1 Состояния тура и отсутствие побочных записей
Status: todo

Pure tour-state tests skip/resume/versionchange/missinganchor/authreturn, API progress persists and no business rows created. Returning user not forced through tour again.

### 10.3.2 Связанный первый проход
Status: todo

Routes/labels/settings replay traced to real handlers and all locales; user timed own small case including upload/AI/save/edit/export. Record actual timing and stumbling points, not API benchmark as UX proof.

