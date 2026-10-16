# Самостоятельный запуск Tirlik

Основная инструкция по prerequisites, `.env.local`, локальному постоянному хранилищу, запуску, остановке, обновлению, production-сборке и backup находится непосредственно в [README](../../README.md#самостоятельный-запуск). Этот документ дополняет её деталями launcher, recovery и hosted-конфигурации; отдельного обязательного пути установки здесь нет.

## Предварительные условия

- Node.js `>=22.13.0 <23` и npm `>=10`.
- Docker Engine и Docker Compose.
- Локальные loopback-порты для приложения, PostgreSQL, SMTP и Mailpit.
- Отдельный случайный `BETTER_AUTH_SECRET` для каждого окружения.

Next.js 16.4 поддерживает Node.js server deployment. Этот проект добавляет собственный launcher, который привязывает локальные сервисы к конкретной копии репозитория и не останавливает чужие процессы по PID.

## Первый запуск

```powershell
Copy-Item .env.example .env.local
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(48).toString('base64url'))"
```

Запишите значение как `BETTER_AUTH_SECRET`, затем:

```powershell
node scripts/dev/start.mjs
```

`start.mjs` выполняет следующие шаги:

1. Проверяет Node.js 22.13+, Docker Engine и Compose.
2. Сверяет lockfile и выполняет `npm ci`, если в этой копии нет подходящих зависимостей.
3. Выбирает или восстанавливает принадлежащие копии порты.
4. Запускает PostgreSQL 17 и Mailpit только для этой копии.
5. Применяет миграции и idempotent seed.
6. Запускает supervisor и ждёт `/api/health`.

По умолчанию приложение предпочитает порт 3000, PostgreSQL 54329, SMTP 10259 и Mailpit 8029. При первом старте свободный fallback выбирается автоматически. Явный порт приложения задаётся через `--port`.

## Остановка и повторный запуск

```powershell
node scripts/dev/stop.mjs
node scripts/dev/start.mjs
```

Stop-команда обращается к приватному control endpoint сохранённого supervisor. Она не завершает процесс только по номеру из файла. PostgreSQL, Mailpit, Docker volume, пользовательские файлы и workflow остаются на месте.

Если startup lock остался после аварийного завершения и записанный процесс уже не существует:

```powershell
node scripts/dev/stop.mjs --recover-lock
```

## Production-режим на одном сервере

Остановите обычное приложение перед изменением каталога production-сборки:

```powershell
node scripts/dev/stop.mjs
node scripts/check-build.mjs
node scripts/dev/start.mjs --mode production
```

`check-build.mjs` проверяет lockfile и build inputs, собирает Next.js через webpack и сохраняет проверенную сборку в `.local-data/build`. Команда удерживает startup lock и до изменения каталога сборки проверяет, что принадлежащий этой копии production-процесс подтверждённо остановлен. При активном или неоднозначном runtime она завершается с `PRODUCTION_RUNTIME_ACTIVE`. `start.mjs --mode production` отказывается использовать отсутствующую или устаревшую сборку.

## Классы локальных данных

| Путь или volume | Содержимое | Можно пересоздать без потери работы |
| --- | --- | --- |
| `tirlik-<checkout>_postgres-data` | аккаунты, проекты, права, версии, команды, jobs | нет |
| `.local-data/files` | исходники, изображения, шрифты и экспорты | нет |
| `.local-data/workflow` | устойчивое состояние запусков | нет, пока есть активная или возобновляемая работа |
| `.local-data/dev` | runtime identity, supervisor state и локальные журналы | только штатными dev-командами |
| `.local-data/build` | проверенная production-сборка | да, когда production-процесс остановлен |
| `.next`, `.swc` | development/compiler cache | да, когда приложение и компилятор остановлены |
| `node_modules` | зависимости из lockfile | да, после остановки; следующий start выполнит `npm ci` |

Не удаляйте `.local-data` для уменьшения размера проекта. В нём находятся пользовательские файлы и состояние. Обычный stop ничего из этой области не очищает.

## Хранилище файлов

Локальный self-hosted режим:

```dotenv
TIRLIK_STORAGE_DRIVER=local
TIRLIK_DATA_DIR=.local-data/files
```

Вне Vercel отсутствующий `TIRLIK_STORAGE_DRIVER` также означает `local`. Даже полный набор R2-реквизитов не меняет драйвер неявно.

Принятый контракт Vercel:

```dotenv
TIRLIK_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

Bucket остаётся приватным. На production CORS разрешает `PUT` только с `https://tirlik.vercel.app`, заголовки `Content-Type` и `If-None-Match`, открывает `ETag`, max age 3600. Preview origin добавляется отдельно только на время проверки прямой загрузки preview. Любой неполный набор реквизитов считается ошибкой. На Vercel `local` запрещён, потому что ephemeral filesystem не является постоянным хранилищем пользовательских файлов.

Публичная версия находится на [tirlik.vercel.app](https://tirlik.vercel.app). Для каждого нового deployment готовность постоянного хранилища подтверждается на фактическом URL через upload, commit, private read, restart/resume и large-file проверку; один ответ health-check этого не доказывает.

## AI и бюджет

Без `OPENROUTER_API_KEY` продукт запускается, а ручные редакторы, источники и экспорт работают. AI-действие сообщает о недоступной модели и сохраняет задачу для продолжения.

При включении AI нужны:

```dotenv
OPENROUTER_API_KEY=
TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD=
```

Лимит является серверной верхней границей активированной авторизации окружения. Переменная необязательна и по умолчанию равна `10`. При явной настройке нужна положительная десятичная сумма без экспоненты; ноль, отрицательное и некорректное значение блокируют AI-действие как ошибку конфигурации.

Активация создаёт grant с настроенным пределом. Уже действующий grant с тем же провайдером и ключом можно только атомарно понизить, если `reserved=0` и фактический расход не превышает новый предел. Повышение, несовпадение identity или незавершённые обязательства требуют отдельного решения и возвращают конфликт. Readiness требует точного совпадения сохранённого и настроенного предела.

Лимит не расходуется автоматически и не заменяет ledger в PostgreSQL. Назначайте отдельную ограниченную сумму каждому окружению в пределах общего разрешённого бюджета. Не переносите значения ключа или private ledger в документацию и клиентский код.

## Почта

Локальный launcher всегда подключает собственный Mailpit и очищает внешние SMTP credentials из дочернего процесса. Для deployment нужны серверные `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_REQUIRE_TLS=true` и подтверждённый sender. Отсутствие почты не должно превращаться в неявно отправленное письмо: интерфейс сообщает недоступность соответствующего действия.

## Backup и restore

Остановите приложение перед созданием копии или восстановлением:

```powershell
node scripts/dev/stop.mjs
node scripts/ops/local-data.mjs backup
```

По умолчанию готовая копия появляется в `.local-data/backups/`. В ней находятся PostgreSQL custom dump, `TIRLIK_DATA_DIR`, `.local-data/workflow`, применённые миграции, размеры и SHA-256. Секреты, логи, build, кеши и Mailpit не копируются.

Копию можно независимо проверить, а затем восстановить:

```powershell
node scripts/ops/local-data.mjs verify --from D:\tirlik-backups\before-update
node scripts/ops/local-data.mjs restore --from D:\tirlik-backups\before-update
```

Restore повторно проверяет содержимое и миграции, сохраняет проверенный снимок текущего состояния в `.local-data/backups/pre-restore-*`, восстанавливает PostgreSQL одной транзакцией и подменяет каталоги через подготовленные деревья. При ошибке он пытается вернуть прежнюю базу и файлы. Существующие копии не перезаписываются и не удаляются автоматически. Полная процедура: [резервное копирование локальных данных](../operations/local-backup.md).

## Диагностика

- `APP_ALREADY_RUNNING`: остановите эту копию перед сменой режима или явного порта.
- `DEPENDENCIES_CHANGED`: остановите приложение и запустите снова, чтобы launcher проверил lockfile.
- `DOCKER_UNAVAILABLE`: запустите Docker Desktop или Docker Engine и повторите.
- `DATABASE_NOT_LOCAL_COMPOSE`: удалите внешний `DATABASE_URL` из локального старта.
- `DATA_DIRECTORY_OUTSIDE_LOCAL_ROOT`: верните `TIRLIK_DATA_DIR` внутрь `.local-data` этой копии.
- `STALE_START_LOCK`: выполните `node scripts/dev/stop.mjs --recover-lock` после проверки, что предыдущий start завершён.

