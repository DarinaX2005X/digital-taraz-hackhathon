import type { Locale } from '../../../i18n/locales';
import type { RunAction, RunFailure, RunState, RunStepState } from '../../../contracts/runs';
import type { AssistantSessionState } from '../ui/session-state';

export interface RunCopy {
  title: string; detail: string; home: string; settings: string; workspace: string;
  loading: string; refreshing: string; refresh: string; signIn: string; signInText: string;
  noWorkspace: string; chooseWorkspace: string; manageWorkspace: string; noAccess: string;
  emptyTitle: string; emptyText: string; back: string; previous: string; next: string;
  started: string; updated: string; steps: string; stepsDone: string; results: string;
  cancel: string; cancelTitle: string; cancelText: string; keep: string; resume: string; retryStep: string;
  sending: string; spent: string; reserved: string; budget: string; dollars: string;
  working: string; waiting: string; checkingConnection: string; connectionLost: string;
  checkState: string; operationUnknown: string; synthetic: string; syntheticText: string;
  source: string; artifact: string; export: string; open: string; noResult: string;
  states: Record<RunState, string>; stepStates: Record<RunStepState, string>;
  actions: Record<RunAction, string>; failures: Record<RunFailure, string>;
  errors: { unavailable: string; network: string; invalid: string; unauthenticated: string; forbidden: string; notFound: string; conflict: string; rateLimited: string; accountChanged: string };
}

export interface AssistantSessionCopy {
  assistant: string; emptyTitle: string; emptyText: string; plan: string; activity: string; results: string;
  resultRequired: string; resultRequiredText: string; technical: string; fullActivity: string; noResults: string;
  stop: string; stopTitle: string; stopText: string; keepWorking: string; checkAgain: string; openResult: string;
  collapse: string; expand: string; switchAssistant: string; switchResult: string; currentResult: string;
  branches: string; branchStates: Record<'planned' | 'running' | 'waiting_input' | 'review_ready' | 'completed' | 'failed' | 'cancelled', string>;
  decisionTitle: string; decisionHint: string; outcome: string; quotedTotal: string; directCost: string; contribution: string; contributionRate: string;
  requestedDate: string; openingDate: string; earliestDate: string; capacity: string; conditions: string; chooseOption: string; selectedOption: string; acceptConditions: string; unknown: string; evidence: string; minutes: string;
  sourceAvailability: string; manualAvailability: string; missingAvailability: string; verifiedAvailability: string;
  outcomes: Record<'feasible' | 'conditional' | 'not_confirmed', string>;
  dimensions: Record<'price' | 'scope' | 'deadline' | 'capacity' | 'conditions', string>;
  states: Record<AssistantSessionState, string>;
}

const ru: RunCopy = {
  title: 'Выполнение задач', detail: 'Задача', home: 'Главная', settings: 'Настройки', workspace: 'Пространство',
  loading: 'Загружаем задачи', refreshing: 'Обновляем', refresh: 'Обновить', signIn: 'Войти', signInText: 'Войдите, чтобы вернуться к своим задачам.',
  noWorkspace: 'Сначала создайте пространство для своей работы.', chooseWorkspace: 'Выберите пространство', manageWorkspace: 'Мои пространства', noAccess: 'Это пространство недоступно. Выберите другое или проверьте доступ в настройках.',
  emptyTitle: 'Задач пока нет', emptyText: 'Здесь появится ход работы над вашими материалами и результатами.', back: 'Все задачи', previous: 'Новее', next: 'Раньше',
  started: 'Начало', updated: 'Обновлено', steps: 'Ход работы', stepsDone: 'Готовые шаги', results: 'Результаты',
  cancel: 'Остановить', cancelTitle: 'Остановить задачу?', cancelText: 'Готовые результаты сохранятся. Начатый запрос к модели может завершиться и учесть расходы после остановки.', keep: 'Продолжить выполнение', resume: 'Продолжить', retryStep: 'Повторить шаг',
  sending: 'Отправляем', spent: 'Учтённые расходы', reserved: 'Ожидаемые расходы', budget: 'Расходы на задачу', dollars: 'USD',
  working: 'Выполняется', waiting: 'Ожидает решения', checkingConnection: 'Восстанавливаем связь', connectionLost: 'Обновления временно недоступны. Сохранённые результаты не потеряны.',
  checkState: 'Проверить состояние', operationUnknown: 'Ответ не получен. Проверьте состояние задачи перед следующим действием.', synthetic: 'Учебная проверка', syntheticText: 'Этот запуск использует синтетические данные для проверки выполнения. Это не результат работы с материалами вашего бизнеса.',
  source: 'Источник', artifact: 'Материал', export: 'Файл', open: 'Открыть', noResult: 'Отдельных материалов в этом запуске нет.',
  states: { queued: 'В очереди', running: 'Выполняется', waiting_input: 'Нужно ваше решение', review_ready: 'Готово к проверке', completed: 'Завершено', failed: 'Не выполнено', cancelled: 'Остановлено' },
  stepStates: { planned: 'Ожидает', claimed: 'Выполняется', succeeded: 'Готово', failed: 'Не выполнено', skipped: 'Пропущено' },
  actions: { read_sources: 'Чтение материалов', extract_text: 'Распознавание текста', calculate: 'Расчёт', prepare_document: 'Подготовка документа', prepare_design: 'Подготовка макета', validate: 'Проверка результата', save: 'Сохранение', export: 'Подготовка файла', continue: 'Продолжение работы', process: 'Обработка' },
  failures: {
    unavailable: 'Выполнение временно недоступно. Можно повторить попытку.', configuration: 'Модель сейчас недоступна. Задача сохранена, её можно продолжить после восстановления доступа.',
    provider: 'Модель не приняла запрос. Можно повторить этот шаг.', provider_timeout: 'Ответ модели не получен вовремя. Расходы ещё уточняются; повторный запрос пока недоступен.', ambiguous_charge: 'Исход запроса ещё не подтверждён. Сохраняем его резерв расходов и не отправляем повторно.', invalid_result: 'Результат не прошёл проверку. Готовая часть работы сохранена.',
    price_unknown: 'Не удалось подтвердить стоимость модели. Запрос не отправлен.', price_expired: 'Стоимость модели требует обновления. Запрос не отправлен.', price_exceeded: 'Фактическая стоимость превысила подтверждённую. Она учтена, дальнейшие запросы к этой модели остановлены.', model_expired: 'Эта модель больше недоступна. Требуется проверенная замена.', model_unproven: 'Эта модель ещё не готова для работы с вашими материалами.', model_forbidden: 'Выбранная модель не разрешена для этой задачи.', unsupported_parameters: 'Модель не поддерживает нужный формат работы.',
    run_budget: 'Достигнут предел расходов на эту задачу. Готовые результаты сохранены.', workspace_budget: 'Достигнут дневной предел расходов пространства.', deployment_budget: 'Достигнут дневной предел расходов сервиса.', authorization_budget: 'Исчерпан разрешённый общий бюджет. Готовые результаты сохранены.', request_limit: 'Достигнут предел запросов для этой задачи.', step_limit: 'Достигнут предел шагов для этой задачи.', branch_limit: 'Все доступные параллельные запросы заняты.', continuation_limit: 'Эта задача уже достигла предела продолжений. Откройте сохранённые результаты или начните новую задачу с изменённой целью.',
    run_deadline: 'Время выполнения задачи истекло. Готовые результаты сохранены.', step_deadline: 'Этот шаг занял слишком много времени. Неподтверждённые изменения не применены.', lease_lost: 'Выполнение прервалось. Сохранённые шаги восстанавливаются.', access_changed: 'Права доступа изменились. Продолжение остановлено.', cancelled: 'Вы остановили задачу. Готовые результаты сохранены.', conflict: 'Состояние задачи изменилось. Обновите её перед действием.',
  },
  errors: { unavailable: 'Не удалось загрузить задачи. Попробуйте ещё раз.', network: 'Нет связи с сервером. Сохранённые данные остаются на месте.', invalid: 'Не удалось прочитать ответ. Обновите страницу.', unauthenticated: 'Сеанс завершён. Войдите снова.', forbidden: 'У вас нет доступа к этой задаче.', notFound: 'Задача не найдена или недоступна.', conflict: 'Задача уже изменилась. Обновите её состояние.', rateLimited: 'Слишком много запросов. Подождите немного.', accountChanged: 'Аккаунт изменился. Обновите страницу перед следующим действием.' },
};
const kk: RunCopy = {
  title: 'Тапсырмалардың орындалуы', detail: 'Тапсырма', home: 'Басты бет', settings: 'Баптаулар', workspace: 'Кеңістік',
  loading: 'Тапсырмалар жүктелуде', refreshing: 'Жаңартылуда', refresh: 'Жаңарту', signIn: 'Кіру', signInText: 'Тапсырмаларыңызға оралу үшін кіріңіз.',
  noWorkspace: 'Алдымен жұмысыңыз үшін кеңістік жасаңыз.', chooseWorkspace: 'Кеңістікті таңдаңыз', manageWorkspace: 'Менің кеңістіктерім', noAccess: 'Бұл кеңістік қолжетімсіз. Басқасын таңдаңыз немесе баптаулардан рұқсатты тексеріңіз.',
  emptyTitle: 'Әзірге тапсырма жоқ', emptyText: 'Мұнда материалдарыңыз бен нәтижелеріңіз бойынша жұмыс барысы көрсетіледі.', back: 'Барлық тапсырмалар', previous: 'Жаңалары', next: 'Алдыңғылары',
  started: 'Басталуы', updated: 'Жаңартылды', steps: 'Жұмыс барысы', stepsDone: 'Дайын қадамдар', results: 'Нәтижелер',
  cancel: 'Тоқтату', cancelTitle: 'Тапсырманы тоқтату керек пе?', cancelText: 'Дайын нәтижелер сақталады. Басталған модель сұрауы тоқтағаннан кейін аяқталып, шығын есептелуі мүмкін.', keep: 'Орындауды жалғастыру', resume: 'Жалғастыру', retryStep: 'Қадамды қайталау',
  sending: 'Жіберілуде', spent: 'Есептелген шығын', reserved: 'Күтілетін шығын', budget: 'Тапсырма шығыны', dollars: 'USD',
  working: 'Орындалуда', waiting: 'Шешім күтілуде', checkingConnection: 'Байланыс қалпына келтірілуде', connectionLost: 'Жаңартулар уақытша қолжетімсіз. Сақталған нәтижелер жоғалған жоқ.',
  checkState: 'Күйін тексеру', operationUnknown: 'Жауап алынбады. Келесі әрекет алдында тапсырманың күйін тексеріңіз.', synthetic: 'Оқу тексеруі', syntheticText: 'Бұл іске қосу орындалуды тексеру үшін жасанды деректерді пайдаланады. Бұл сіздің бизнес материалдарыңызбен жұмыс нәтижесі емес.',
  source: 'Дереккөз', artifact: 'Материал', export: 'Файл', open: 'Ашу', noResult: 'Бұл іске қосуда жеке материалдар жоқ.',
  states: { queued: 'Кезекте', running: 'Орындалуда', waiting_input: 'Шешіміңіз қажет', review_ready: 'Тексеруге дайын', completed: 'Аяқталды', failed: 'Орындалмады', cancelled: 'Тоқтатылды' },
  stepStates: { planned: 'Күтуде', claimed: 'Орындалуда', succeeded: 'Дайын', failed: 'Орындалмады', skipped: 'Өткізілді' },
  actions: { read_sources: 'Материалдарды оқу', extract_text: 'Мәтінді тану', calculate: 'Есептеу', prepare_document: 'Құжат дайындау', prepare_design: 'Макет дайындау', validate: 'Нәтижені тексеру', save: 'Сақтау', export: 'Файл дайындау', continue: 'Жұмысты жалғастыру', process: 'Өңдеу' },
  failures: {
    unavailable: 'Орындау уақытша қолжетімсіз. Әрекетті қайталауға болады.', configuration: 'Модель қазір қолжетімсіз. Тапсырма сақталды, қолжетімділік қалпына келгенде жалғастыруға болады.',
    provider: 'Модель сұрауды қабылдамады. Қадамды қайталауға болады.', provider_timeout: 'Модель жауабы уақытында алынбады. Шығын нақтылануда; қайталау әзірге қолжетімсіз.', ambiguous_charge: 'Сұрау нәтижесі әлі расталмаған. Шығын резерві сақталады, сұрау қайталанбайды.', invalid_result: 'Нәтиже тексеруден өтпеді. Дайын жұмыс бөлігі сақталды.',
    price_unknown: 'Модель құны расталмады. Сұрау жіберілген жоқ.', price_expired: 'Модель құнын жаңарту қажет. Сұрау жіберілген жоқ.', price_exceeded: 'Нақты құн расталған шектен асты. Шығын есептелді, бұл модельге келесі сұраулар тоқтатылды.', model_expired: 'Бұл модель енді қолжетімсіз. Тексерілген балама қажет.', model_unproven: 'Бұл модель материалдарыңызбен жұмыс істеуге әлі дайын емес.', model_forbidden: 'Бұл тапсырмаға таңдалған модельге рұқсат жоқ.', unsupported_parameters: 'Модель қажетті жұмыс пішімін қолдамайды.',
    run_budget: 'Тапсырманың шығын шегіне жетті. Дайын нәтижелер сақталды.', workspace_budget: 'Кеңістіктің күндік шығын шегіне жетті.', deployment_budget: 'Сервистің күндік шығын шегіне жетті.', authorization_budget: 'Рұқсат етілген жалпы бюджет таусылды. Дайын нәтижелер сақталды.', request_limit: 'Тапсырма сұрауларының шегіне жетті.', step_limit: 'Тапсырма қадамдарының шегіне жетті.', branch_limit: 'Барлық қатар сұраулар бос емес.', continuation_limit: 'Бұл тапсырма жалғастыру шегіне жетті. Сақталған нәтижелерді ашыңыз немесе өзгертілген мақсатпен жаңа тапсырма бастаңыз.',
    run_deadline: 'Тапсырма уақыты аяқталды. Дайын нәтижелер сақталды.', step_deadline: 'Бұл қадам тым ұзақ орындалды. Расталмаған өзгерістер қолданылған жоқ.', lease_lost: 'Орындау үзілді. Сақталған қадамдар қалпына келтірілуде.', access_changed: 'Қол жеткізу құқықтары өзгерді. Жалғастыру тоқтатылды.', cancelled: 'Сіз тапсырманы тоқтаттыңыз. Дайын нәтижелер сақталды.', conflict: 'Тапсырма күйі өзгерді. Әрекет алдында жаңартыңыз.',
  },
  errors: { unavailable: 'Тапсырмалар жүктелмеді. Қайталап көріңіз.', network: 'Сервермен байланыс жоқ. Сақталған деректер орнында.', invalid: 'Жауап оқылмады. Бетті жаңартыңыз.', unauthenticated: 'Сеанс аяқталды. Қайта кіріңіз.', forbidden: 'Бұл тапсырмаға қол жеткізу рұқсатыңыз жоқ.', notFound: 'Тапсырма табылмады немесе қолжетімсіз.', conflict: 'Тапсырма өзгерді. Күйін жаңартыңыз.', rateLimited: 'Сұрау тым көп. Біраз күтіңіз.', accountChanged: 'Аккаунт өзгерді. Келесі әрекет алдында бетті жаңартыңыз.' },
};
const en: RunCopy = {
  title: 'Task activity', detail: 'Task', home: 'Home', settings: 'Settings', workspace: 'Workspace',
  loading: 'Loading tasks', refreshing: 'Refreshing', refresh: 'Refresh', signIn: 'Sign in', signInText: 'Sign in to return to your tasks.',
  noWorkspace: 'Create a workspace for your work first.', chooseWorkspace: 'Choose a workspace', manageWorkspace: 'My workspaces', noAccess: 'This workspace is unavailable. Choose another or check your access in settings.',
  emptyTitle: 'No tasks yet', emptyText: 'Progress on your materials and results will appear here.', back: 'All tasks', previous: 'Newer', next: 'Older',
  started: 'Started', updated: 'Updated', steps: 'Progress', stepsDone: 'Completed steps', results: 'Results',
  cancel: 'Stop', cancelTitle: 'Stop this task?', cancelText: 'Completed results will remain. A model request already in progress may finish and incur costs after you stop.', keep: 'Keep running', resume: 'Continue', retryStep: 'Retry step',
  sending: 'Sending', spent: 'Recorded cost', reserved: 'Pending cost', budget: 'Task cost', dollars: 'USD',
  working: 'Running', waiting: 'Awaiting a decision', checkingConnection: 'Reconnecting', connectionLost: 'Updates are temporarily unavailable. Saved results are still safe.',
  checkState: 'Check status', operationUnknown: 'No response was received. Check the task status before taking another action.', synthetic: 'Synthetic check', syntheticText: 'This run uses synthetic data to check execution. It is not a result produced from your business materials.',
  source: 'Source', artifact: 'Material', export: 'File', open: 'Open', noResult: 'This run has no separate materials.',
  states: { queued: 'Queued', running: 'Running', waiting_input: 'Needs your decision', review_ready: 'Ready to review', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped' },
  stepStates: { planned: 'Waiting', claimed: 'Running', succeeded: 'Done', failed: 'Failed', skipped: 'Skipped' },
  actions: { read_sources: 'Reading materials', extract_text: 'Recognizing text', calculate: 'Calculating', prepare_document: 'Preparing a document', prepare_design: 'Preparing a design', validate: 'Checking results', save: 'Saving', export: 'Preparing a file', continue: 'Continuing work', process: 'Processing' },
  failures: {
    unavailable: 'Execution is temporarily unavailable. You can try again.', configuration: 'The model is unavailable. Your task is saved and can continue when access is restored.',
    provider: 'The model did not accept the request. You can retry this step.', provider_timeout: 'The model did not respond in time. Costs are being reconciled; another request is not available yet.', ambiguous_charge: 'The request outcome is not confirmed. Its cost reservation is retained and the request will not be repeated.', invalid_result: 'The result did not pass validation. Completed work is saved.',
    price_unknown: 'The model cost could not be confirmed. No request was sent.', price_expired: 'The model cost needs updating. No request was sent.', price_exceeded: 'Actual cost exceeded the confirmed limit. It has been recorded and further requests to this model are stopped.', model_expired: 'This model is no longer available. A verified replacement is needed.', model_unproven: 'This model is not yet ready to work with your materials.', model_forbidden: 'The selected model is not allowed for this task.', unsupported_parameters: 'The model does not support the required format.',
    run_budget: 'This task reached its spending limit. Completed results are saved.', workspace_budget: 'The workspace reached its daily spending limit.', deployment_budget: 'The service reached its daily spending limit.', authorization_budget: 'The authorized total budget is exhausted. Completed results are saved.', request_limit: 'This task reached its request limit.', step_limit: 'This task reached its step limit.', branch_limit: 'All concurrent request slots are occupied.', continuation_limit: 'This task has reached its continuation limit. Open the saved results or start a new task with the changed goal.',
    run_deadline: 'The task time limit expired. Completed results are saved.', step_deadline: 'This step took too long. Unconfirmed changes were not applied.', lease_lost: 'Execution was interrupted. Saved steps are being recovered.', access_changed: 'Access permissions changed. Execution has stopped.', cancelled: 'You stopped the task. Completed results are saved.', conflict: 'The task changed. Refresh its status before acting.',
  },
  errors: { unavailable: 'Tasks could not be loaded. Try again.', network: 'The server is unreachable. Saved data is still safe.', invalid: 'The response could not be read. Refresh the page.', unauthenticated: 'Your session ended. Sign in again.', forbidden: 'You do not have access to this task.', notFound: 'This task was not found or is unavailable.', conflict: 'The task has changed. Refresh its status.', rateLimited: 'Too many requests. Wait a moment.', accountChanged: 'The account changed. Refresh the page before your next action.' },
};
export const runCatalog: Record<Locale, RunCopy> = { ru, kk, en };

export const assistantSessionCatalog: Record<Locale, AssistantSessionCopy> = {
  ru: {
    assistant: 'Ассистент', emptyTitle: 'Опишите деловую задачу', emptyText: 'Tirlik составит план, выполнит доступные проверки и откроет результат в рабочем компоненте.',
    plan: 'План', activity: 'Что уже сделано', results: 'Результаты', resultRequired: 'Нужен рабочий результат', resultRequiredText: 'Ответ ассистента сохранён, но задача не считается завершённой, пока нет проверяемого материала или операции.',
    technical: 'Технические сведения', fullActivity: 'Открыть полную историю', noResults: 'Готового материала пока нет.', stop: 'Остановить', stopTitle: 'Остановить работу?', stopText: 'Уже созданные результаты сохранятся. Запущенная операция может завершиться после остановки.', keepWorking: 'Продолжить работу', checkAgain: 'Проверить состояние', openResult: 'Открыть',
    collapse: 'Свернуть ассистента', expand: 'Вернуть ассистента', switchAssistant: 'Ассистент', switchResult: 'Результат', currentResult: 'Текущий результат',
    branches: 'Параллельные части работы', branchStates: { planned: 'Запланировано', running: 'Выполняется', waiting_input: 'Нужно решение', review_ready: 'Готово к проверке', completed: 'Готово', failed: 'Не выполнено', cancelled: 'Остановлено' },
    decisionTitle: 'Выберите рабочий вариант', decisionHint: 'Сравнение основано на проверенных расчётах, сроках и доступности. Выбор создаст связанные результаты.', outcome: 'Вывод', quotedTotal: 'Цена предложения', directCost: 'Прямые затраты', contribution: 'Вклад в покрытие', contributionRate: 'Маржа по вкладу', requestedDate: 'Запрошенная дата', openingDate: 'Можно начать', earliestDate: 'Ранняя выполнимая дата', capacity: 'Нужно / доступно', conditions: 'Основания и условия', chooseOption: 'Выбрать этот вариант', selectedOption: 'Выбранный вариант', acceptConditions: 'Принять условия и продолжить', unknown: 'Не подтверждено', evidence: 'Связанные источники', minutes: 'мин',
    sourceAvailability: 'Доступность из подтверждённой версии источника', manualAvailability: 'Доступность введена вручную', missingAvailability: 'Доступность не предоставлена', verifiedAvailability: 'Проверено',
    outcomes: { feasible: 'Можно выполнить', conditional: 'Можно при условиях', not_confirmed: 'Нельзя подтвердить' },
    dimensions: { price: 'цена', scope: 'состав', deadline: 'срок', capacity: 'нагрузка', conditions: 'условия' },
    states: { empty: 'Новая задача', entered: 'Цель введена', planning: 'Планируем и выполняем', waiting_input: 'Нужно ваше решение', partial: 'Есть готовая часть', review_ready: 'Готово к проверке', completed: 'Результат готов', failed: 'Не удалось выполнить', interrupted: 'Работа остановлена', revoked: 'Доступ отозван' },
  },
  kk: {
    assistant: 'Ассистент', emptyTitle: 'Іскерлік тапсырманы сипаттаңыз', emptyText: 'Tirlik жоспар құрып, қолжетімді тексерулерді орындайды және нәтижені жұмыс компонентінде ашады.',
    plan: 'Жоспар', activity: 'Орындалған әрекеттер', results: 'Нәтижелер', resultRequired: 'Жұмыс нәтижесі қажет', resultRequiredText: 'Ассистент жауабы сақталды, бірақ тексерілетін материал немесе операция болмайынша тапсырма аяқталды деп саналмайды.',
    technical: 'Техникалық мәліметтер', fullActivity: 'Толық тарихты ашу', noResults: 'Дайын материал әлі жоқ.', stop: 'Тоқтату', stopTitle: 'Жұмысты тоқтату керек пе?', stopText: 'Жасалған нәтижелер сақталады. Басталған операция тоқтатқаннан кейін аяқталуы мүмкін.', keepWorking: 'Жұмысты жалғастыру', checkAgain: 'Күйін тексеру', openResult: 'Ашу',
    collapse: 'Ассистентті жинау', expand: 'Ассистентті қайтару', switchAssistant: 'Ассистент', switchResult: 'Нәтиже', currentResult: 'Ағымдағы нәтиже',
    branches: 'Қатар орындалатын жұмыс бөліктері', branchStates: { planned: 'Жоспарланған', running: 'Орындалуда', waiting_input: 'Шешім қажет', review_ready: 'Тексеруге дайын', completed: 'Дайын', failed: 'Орындалмады', cancelled: 'Тоқтатылды' },
    decisionTitle: 'Жұмыс нұсқасын таңдаңыз', decisionHint: 'Салыстыру тексерілген есептерге, мерзімдерге және қолжетімділікке негізделген. Таңдау байланысты нәтижелерді жасайды.', outcome: 'Қорытынды', quotedTotal: 'Ұсыныс бағасы', directCost: 'Тікелей шығындар', contribution: 'Жабуға үлес', contributionRate: 'Үлес маржасы', requestedDate: 'Сұралған күн', openingDate: 'Бастауға болады', earliestDate: 'Ең ерте орындалатын күн', capacity: 'Қажет / қолжетімді', conditions: 'Негіздер мен шарттар', chooseOption: 'Осы нұсқаны таңдау', selectedOption: 'Таңдалған нұсқа', acceptConditions: 'Шарттарды қабылдап, жалғастыру', unknown: 'Расталмаған', evidence: 'Байланысты дереккөздер', minutes: 'мин',
    sourceAvailability: 'Қолжетімділік расталған дереккөз нұсқасынан', manualAvailability: 'Қолжетімділік қолмен енгізілген', missingAvailability: 'Қолжетімділік берілмеген', verifiedAvailability: 'Тексерілген',
    outcomes: { feasible: 'Орындауға болады', conditional: 'Шарттармен орындауға болады', not_confirmed: 'Растау мүмкін емес' },
    dimensions: { price: 'баға', scope: 'құрам', deadline: 'мерзім', capacity: 'жүктеме', conditions: 'шарттар' },
    states: { empty: 'Жаңа тапсырма', entered: 'Мақсат енгізілді', planning: 'Жоспарлау және орындау', waiting_input: 'Сіздің шешіміңіз қажет', partial: 'Дайын бөлігі бар', review_ready: 'Тексеруге дайын', completed: 'Нәтиже дайын', failed: 'Орындау мүмкін болмады', interrupted: 'Жұмыс тоқтатылды', revoked: 'Қолжетімділік алынып тасталды' },
  },
  en: {
    assistant: 'Assistant', emptyTitle: 'Describe the business task', emptyText: 'Tirlik will make a plan, run the available checks, and open the result in a working component.',
    plan: 'Plan', activity: 'Work completed', results: 'Results', resultRequired: 'A working result is still needed', resultRequiredText: 'The assistant response is saved, but the task is not complete until it produces a verifiable material or operation.',
    technical: 'Technical details', fullActivity: 'Open full activity', noResults: 'No working material is ready yet.', stop: 'Stop', stopTitle: 'Stop this work?', stopText: 'Created results will remain. An operation already in progress may finish after you stop.', keepWorking: 'Keep working', checkAgain: 'Check status', openResult: 'Open',
    collapse: 'Collapse assistant', expand: 'Restore assistant', switchAssistant: 'Assistant', switchResult: 'Result', currentResult: 'Current result',
    branches: 'Parallel work', branchStates: { planned: 'Planned', running: 'Running', waiting_input: 'Needs a decision', review_ready: 'Ready to review', completed: 'Done', failed: 'Failed', cancelled: 'Stopped' },
    decisionTitle: 'Choose a workable option', decisionHint: 'This comparison uses checked calculations, dates, and availability. Your choice creates the linked results.', outcome: 'Outcome', quotedTotal: 'Quoted total', directCost: 'Direct cost', contribution: 'Contribution', contributionRate: 'Contribution margin', requestedDate: 'Requested date', openingDate: 'Can start', earliestDate: 'Earliest feasible date', capacity: 'Required / available', conditions: 'Evidence and conditions', chooseOption: 'Choose this option', selectedOption: 'Selected option', acceptConditions: 'Accept conditions and continue', unknown: 'Not confirmed', evidence: 'Linked sources', minutes: 'min',
    sourceAvailability: 'Availability from a confirmed source version', manualAvailability: 'Availability entered manually', missingAvailability: 'Availability was not provided', verifiedAvailability: 'Verified',
    outcomes: { feasible: 'Can be delivered', conditional: 'Can be delivered with conditions', not_confirmed: 'Cannot be confirmed' },
    dimensions: { price: 'price', scope: 'scope', deadline: 'deadline', capacity: 'capacity', conditions: 'conditions' },
    states: { empty: 'New task', entered: 'Goal entered', planning: 'Planning and working', waiting_input: 'Your decision is needed', partial: 'A usable part is ready', review_ready: 'Ready to review', completed: 'Result ready', failed: 'Could not complete', interrupted: 'Work stopped', revoked: 'Access revoked' },
  },
};
