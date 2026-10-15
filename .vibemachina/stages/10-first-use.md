# 10 Публичный сайт, пример и понятное первое использование
Status: active

Новый посетитель должен понять продукт и безопасно попробовать его, а вошедший пользователь быстро начать свою работу. Пример и обучение не создают чужие или лишние записи в аккаунте.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 10.1 Показать продукт и привести к настоящей работе
Status: active
Requirements: R02, R07, R08, R09, R19, R21, R28, R29, R30, R31, R38, R40, R41, R44, R45, R46, R47, R48, R49, R64, R101, R106, R108
Depends on: 01.2, 02.1
Owner: /root/public_ai_story
Paths: src/features/public-site/, public/site/, tests/public-site/, src/app/page.tsx

Точные дополнительные loans `/root/public_ai_story`: `src/app/[locale]/page.tsx`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/help/page.tsx`, `src/app/[locale]/privacy/page.tsx`, `src/app/[locale]/not-found.tsx`. Для R41 root unknown route выдан bounded Next16 repair loan `/root/not_found_repair_v2`: `next.config.ts` только для `experimental.globalNotFound:true`, `src/app/global-not-found.tsx` и `src/proxy.ts` только для direct semantic 404 response of unknown first-segment public paths, плюс focused identity route tests. Proxy must exclude assets, API, app, auth, settings and supported locale routes; no redirect or auth bypass. Только эти файлы, не wildcard subtree. Next dynamic routes перечислены буквально вне glob metadata; MAIN отдельно сверяет ownership. Auth/settings/shared controls read-only; новые server/runtime/workspace contracts запрашиваются у их owners.

Дополнительный bounded loan `src/app/[locale]/not-found.tsx` для полноценной локализованной404 при неизвестном locale/path; текущий checkpoint выявил реальный SSRerror shell вместо h1/lang/home link. Owner исправляет root/locale error boundary по installedNext docs, не снижает HTTP acceptance и не меняет остальной frozen UI.

Bounded repair принят2026-10-14: locale layout закрывает набор ru/kk/en через generateStaticParams/dynamicParams=false, local not-found использует общую страницу.4invalid routes возвращают полноценный404 HTML с h1/lang/home и безerror shell;5valid routes200. Independent isolated identity route suite4/4PASS включает auth intent/workspace/privatequery иinvalidfilter recovery. Rootlayout/next.config для исправления не менялись; public owner STOP. Это серверная проверка, не визуальная приёмка.

Прямое новое поручение пользователя2026-10-14: полноценный landing и заметно переработанные вход/регистрация нужны сейчас, прежнее ожидание04.2/06.3/07.2 для начала публичной страницы отменено. Реальный ранний site/auth workflow строится на уже принятом account/UI foundation. Полные предметные примеры и demo10.2 добавляются после фактической готовности соответствующих сценариев; не изображать недоступные handlers работающими и не считать весь продукт принятым. Исходное полное сообщение в BRIEF/TESTING обязательно. Feature owner сам монтирует свои страницы, shared root integration отдельно.

**Контракт и результат.** C1, DESIGN публичная часть. Full ru/kk/en site /[locale], clear Tirlik H1 and «Всё для вашего бизнеса», visible «Начать работу» and «Посмотреть пример». First argument shows AI assistant receiving a real business goal, performing grounded financial/operational operations and opening editable components; not a generic chat bubble, editor catalogue or one price-update trick. How-it-works visible before FAQ, actual useful scenarios and footer to product/help/privacy/contact/repo. No pricing or fake partners/results/testimonials. Relevant subject art explains the transformation without impersonating unimplemented controls; actual product views use verified components. Fullbleed hero text notcard/notsplit, nextsection hint across widths per DESIGN. MAIN owns routes/SEO metadata registry.

**Вход в работу и состояния.** CTA to real work entry/auth preserving intent, demo explicit; shared profile/session and language. Public URL stays public after signin, correct404, accessible footer and no dead links. Motion modest/reduced-motion; assets dimensions/alt/loading budgets; no imposed auto browser.

### 10.1.1 Содержательная публичная часть
Status: active

Исходное F002 и полное последующее замечание в BRIEF обязательны исполнителю: нынешняя account-entry страница не заменяет лендинг. Сделать самостоятельную публичную подачу с отдельным входом и собственной предметной композицией, не расширять стандартную форму до якобы готового сайта. Внешний вид утверждает пользователь.

Content and route inventory verified HTTP statuses/destinations, claims traced to approved product specification, complete locales/no tariffs. Asset license/hash/dimensions checked, not visual approval. По прямому последующему указанию пользователя публичная copy представляет полную целевую Tirlik до релиза, без временных «пока доступны только настройки», «это иллюстрации, не результаты» и прочих dev-status отчётов. Это разрешение на целевую подачу для её оценки, не приёмка отсутствующего кода; actual readiness отдельно в STATE/чате. Не выдумывать клиентов/отзывы/метрики. Неработающие handlers не симулируются.

Первый mounted handover public/auth: ru/kk/en landing, help/privacy/footer, отдельные формы, localMail hint и width refinement;17 HTTP routes/invalidlocale404,215 focused tests иtype/lint PASS, independent HTTP locale/home/help/privacy/auth/image PASS. Пользователь одобрил фон landing hero, но требует отдельную PNG/SVG-графику для авторизации, более выразительные hover и сокращение больших боковых отступов, включая privacy. Owner продолжает связанное refinement вместе с целевой copy; checkpoints остаются active до этого handover и общей интеграции. Весь интерфейс визуально принятым не объявлен.

### 10.1.2 Первое действие и возврат
Status: active

HTTP auth intent/locale persistence, public/private boundary and footer link checks. User judges first3-5seconds, CTA prominence, text fit/mobile and meaningful illustration.

Финальная невизуальная route acceptance текущего snapshot: `http-identity` PASS (root unknown en/kk semantic404 без redirect/error shell и `/ru/missing` localized recovery), `http-workspace` PASS после Next16 global-not-found/proxy repair, `http-artifacts`, `http-demo`, `http-sources`, `http-sheets` и `http-materials` PASS. Root unknown public paths перехватываются только для неизвестного first segment; assets/API/app/auth/settings/supported locales не затрагиваются. Визуальная композиция и пользовательская понятность остаются needs-user-check.

## 10.2 Дать интерактивный пример без нежелательных записей
Status: active
Requirements: R08, R21, R24, R26, R27, R75, R76, R82, R99, R106, R107
Depends on: 03.1, 01.3
Owner: SUBAGENT to assign (передача; прежний автор: connected_delivery)
Paths: src/features/demo/, tests/demo/

Уточнение2026-10-15: пример обязан начинаться с видимой AI-сессии и существенной деловой цели, а не с готового документа. Подготовленный synthetic путь допустим только как честный изолированный replay той же предметной процедуры: ассистент планирует, проверяет экономику и выполнимость, задаёт критический вопрос, предлагает варианты, создаёт живые результаты и принимает решение человека. Ручная правка и связанное обновление показывают контроль после решения, но не являются главным «вау». Не имитировать generation/streaming и не рисовать pretend controls. Реальный export и explicit copy-to-account обязательны до полной приёмки; URL и UI entry получает этот feature owner через точный loan от MAIN, не скрытая страница по неизвестной ссылке.

**Контракт и результат.** C1, C3-C4, C13. Isolated demo snapshots of meaningful business projects, same editors/calculation/tool contracts with ephemeral sandbox commands and TTL; no access to private or shared mutable demo record. Viewing/replaying requires no personal rows, live AI only explicit bounded action with abuse limit if supported; otherwise labelled prepared result not fake streaming generation. «Скопировать в мою работу» after explicit auth retains demo edits via validated payload, remaps all IDs/source ACL, exactly-one owned project per idempotency key, no unwanted copy during tour.

**Вход в работу и состояния.** Visitor can change assumption/text/layer, undo and see dependent proposal using isolated synthetic data; clear label/progress and reset. Three businessmodels show distinct jobs, not mandatory wizard. Logged-in user viewing demo stays in demo until copy; failure retains temporary edits. Phone same core direct edits.

### 10.2.1 Изолированное испытание
Status: active

На передаче15октября настоящий demo/editor/DOCX export подключён;7/8HTTPcases PASS, включая все3localeфайла и отсутствие personal/artifact/export/run/provider записей. RU colddev compilation timeout ещё требует финальногоproductionHTTPproof. Главное F008: пользователь счёл пример слабым и искусственно преувеличивающим обычное редактирование; это смысловой blocker приёмки независимо от проверок API. Следующий MAIN пересматривает доказательство пользы против Word/Excel, полныйscope сохраняется.

Record counts before/after anonymous and logged-in view/replay unchanged; cross-session no edit leakage, TTL cleanup, same domain function golden result.

### 10.2.2 Осознанная копия и продолжение
Status: todo

Login cancel/error preserves intent; explicit copy creates one project+correct assets, replay request no duplicate, reopen manually modified copy. User verifies demonstration feels like actual work.

## 10.3 Провести первое обучение и сохранить возможность повторить
Status: active
Requirements: R08, R24, R29, R32, R33, R39, R40, R44, R45, R97, R98, R108
Depends on: 03.1, 02.1
Owner: SUBAGENT to assign (передача; прежний автор: journey_delivery)
Paths: src/features/onboarding/, tests/onboarding/

Уточнение2026-10-15: первый вход, skip/resume/replay и доступные real-action steps разрабатываются сразу с03.2. Отсутствующий optional anchor не блокирует работу и не показывает несуществующую функцию. Demo10.2 и командные09.2 шаги присоединяются после их integration; полная10.3 acceptance включает обе исходные зависимости и все editor/export шаги. Никакой предварительной анкеты/автосоздания проектов. Свой goal/material и выбранное до входа намерение сохраняются.

**Контракт и результат.** DESIGN обучение/первый опыт, C13. Mandatory implementation of first-signin contextual tour with skip/resume/replay Settings -> Обучение and Help. Progress versioned per user, not reset after each login; active goal preserved. Anchors based on semantic IDs wait for real element readiness, absent permission/route step skipped with proper alternate, never trapping overlay. Steps own material/goal/result directedit/sources/changes/export; microtour by editor on firstuse optional. Demo tour isolated, no silent projectcreation, no requirement to finish before work.

**Вход в работу и состояния.** Welcome short choice start own work or guided example, free-form entry remains visible. Controls next/back/skip/close with focus restore, user can continue from settings; mobile step avoids target occlusion. Copy uses natural verbs/locales, not instructional filler across every permanent screen.

### 10.3.1 Состояния тура и отсутствие побочных записей
Status: active

Progress0013, skip/resume/replay/settings иactualeditoranchors реализованы в текущемCP1; onboarding/firstresult DBcases PASS. Полнаяприёмка всёещё требует03.2/09.2/10.2 иuserfirst-use, не закрыта только persistenceproof. Новых исполнителей до передачи не запускать.

Pure tour-state tests skip/resume/versionchange/missinganchor/authreturn, API progress persists and no business rows created. Returning user not forced through tour again.

### 10.3.2 Связанный первый проход
Status: active

Routes/labels/settings replay traced to real handlers and all locales; user timed own small case including upload/AI/save/edit/export. Record actual timing and stumbling points, not API benchmark as UX proof.

