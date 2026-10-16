# Проверка размещённого Tirlik без браузера

`scripts/release/verify-deployment.mjs` выполняет API-проверку уже размещённого приложения. Он не управляет Vercel, Neon или R2, не открывает браузер и не читает deployment credentials. Скрипт принимает только канонический HTTPS origin.

## 1. Подготовить сохранённую работу

После миграций и первого стабильного deployment запустите:

```powershell
node scripts/release/verify-deployment.mjs prepare --origin https://tirlik.vercel.app --expect-missing-model
```

Флаг `--expect-missing-model` используется только в окружении, где намеренно отсутствует `OPENROUTER_API_KEY`. Без него скрипт не запускает модель и не создаёт платный вызов.

Prepare проверяет:

- `/api/health`, регистрацию без обязательного подтверждения email, workspace и проект в PostgreSQL;
- прямую подписанную загрузку текстового исходника размером 6 350 000 байт в приватный R2;
- production CORS origin, открытый `ETag`, immutable `If-None-Match` и commit загрузки через авторизованный API;
- повторное чтение полного файла и совпадение SHA-256;
- ручную правку документа через revision/hash guard;
- настоящие DOCX и PDF, сохранённые в hosted storage;
- при явном флаге — понятное состояние `configuration` без AI-ключа.

Случайный пароль и идентификаторы сохраняются только в игнорируемом файле `.local-data/release/deployment-smoke.json`. Они не печатаются в терминал и не попадают в Git. Если prepare прервётся после регистрации, файл сохраняется для безопасного разбора и cleanup.

## 2. Доказать сохранность между deployment

После нового deployment или подтверждённого перезапуска того же production окружения выполните:

```powershell
node scripts/release/verify-deployment.mjs verify
```

Verify создаёт новую authenticated session и повторно открывает тот же проект, 6,35-МБ исходник, ручную ревизию, export job, DOCX/PDF и ожидаемое missing-model состояние. Успешный prepare и verify без deployment между ними подтверждают API-путь, но не являются доказательством сохранности при замене instance.

Другой state file можно выбрать одинаково в каждой фазе:

```powershell
node scripts/release/verify-deployment.mjs prepare --origin https://tirlik.vercel.app --state D:\tirlik-proof\production.json
node scripts/release/verify-deployment.mjs verify --state D:\tirlik-proof\production.json
```

## 3. Удалить синтетический аккаунт

После принятой проверки:

```powershell
node scripts/release/verify-deployment.mjs cleanup
```

Cleanup входит только в синтетический аккаунт, сверяет его owned workspaces и переводит их в штатный deletion-retention flow. Затем он удаляет локальный файл с паролем. Облачные данные не удаляются в обход серверной политики хранения.

Не запускайте `prepare` повторно с тем же state path. Существующий state file означает незавершённую или ещё не очищенную проверку.
