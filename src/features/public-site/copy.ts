import type { Locale } from "@/i18n";

type InformationSection = { title: string; text: string; link?: "signup" | "verify" | "reset" | "team" | 'tour'; action?: string };

export type PublicCopy = {
  mechanismIllustration: string; mechanismSource: string; mechanismResult: string;
  ownTaskTitle: string; ownTaskDescription: string; ownTaskLabel: string; ownTaskPlaceholder: string; ownTaskAction: string; ownTaskError: string; ownTaskAccount: string; ownTaskSignedIn: string; exampleAction: string; useScenario: string;
  tagline: string; description: string; home: string; scenarios: string; process: string;
  start: string; signIn: string; account: string; work: string; explore: string; language: string;
  illustration: string; introTitle: string; intro: string;
  scenarioItems: { title: string; task: string; input: string; output: string; detail: string }[];
  inputLabel: string; outputLabel: string;
  controlTitle: string; controlBody: string; controlItems: { title: string; text: string }[];
  processTitle: string; steps: { title: string; text: string }[];
  boundaryTitle: string; boundaryText: string; boundaryItems: string[];
  accessTitle: string; accessText: string; team: string;
  footerText: string; help: string; privacy: string; repository: string; back: string;
  helpTitle: string; helpIntro: string; helpSections: InformationSection[];
  privacyTitle: string; privacyIntro: string; privacySections: InformationSection[];
};

const ru: PublicCopy = {
  mechanismIllustration: 'Исходный прайс в папке связан с подготовленным предложением. Проверенные изменения переходят в результат.', mechanismSource: 'Цена изменилась в исходнике', mechanismResult: 'Расчёт обновлён, ваша фраза сохранена',
  ownTaskTitle: 'Начните со своей задачи', ownTaskDescription: 'Опишите нужный результат. Затем добавьте прайс, запрос клиента или другие материалы в свой проект.',
  ownTaskLabel: 'Что нужно подготовить?', ownTaskPlaceholder: 'Смету и предложение для клиента по моему прайсу. Отдельно показать доставку и сроки.', ownTaskAction: 'Продолжить с моей задачей', ownTaskError: 'Не удалось продолжить. Ваш текст остался здесь. Попробуйте ещё раз.', ownTaskAccount: 'После входа ваша задача откроется в проекте.', ownTaskSignedIn: 'Выберите рабочее пространство и добавьте материалы.', exampleAction: 'Попробовать на примере', useScenario: 'Начать такую задачу',
  tagline: "Всё для вашего бизнеса",
  work: "Перейти к работе",
  description: "Превратите прайс и запрос клиента в смету и предложение. Отредактируйте результат, обновите цены и сохраните свои формулировки.",
  home: "На главную", scenarios: "Для каких задач", process: "Как это работает", start: "Начать работу", signIn: "Войти", account: "Мой аккаунт", explore: "Посмотреть сценарии", language: "Язык",
  illustration: "Иллюстрация рабочих материалов: таблицы, папка и фотографии продукта.",
  introTitle: "Работа начинается с вашей задачи",
  intro: "Подготовить предложение, разобраться в расходах или собрать материалы для акции. В основе каждого сценария лежат ваши файлы и конкретный результат для бизнеса.",
  scenarioItems: [
    { title: "Предложение для клиента", task: "«Собрать предложение по этому запросу и проверить стоимость»", input: "Запрос клиента, прайс, условия", output: "Смета и коммерческое предложение", detail: "Цены, объём и условия нужны и в расчёте, и в документе. Связь между ними помогает увидеть, что нужно обновить после правки." },
    { title: "Расходы и закупки", task: "«Сравнить предложения поставщиков с учётом доставки»", input: "Прайсы поставщиков, объёмы, сроки", output: "Таблица сравнения и план закупки", detail: "Сопоставляйте одинаковые позиции и единицы. Неизвестная стоимость доставки или неполные условия должны оставаться видимыми при выборе." },
    { title: "Материалы для акции", task: "«Подготовить материалы по нашим товарам и новым ценам»", input: "Фото, описание товара, цены, стиль", output: "Текст предложения, макет и план публикаций", detail: "Фотографии, текст и условия работают вместе. Покупатели по-прежнему обращаются к вам в привычном канале." },
  ],
  inputLabel: "Ваши материалы", outputLabel: "Готовый результат",
  controlTitle: "Правка не должна начинать работу заново",
  controlBody: "Расчёты, документы и визуальные материалы связаны в одной задаче. Меняйте детали, сравнивайте варианты и доводите работу до результата, который подходит вашему бизнесу.",
  controlItems: [
    { title: "Редактируйте по месту", text: "Меняйте текст в документе, значение в таблице или объект в макете. Самостоятельно или вместе с ИИ." },
    { title: "Управляйте изменениями", text: "Обновите исходную цену и проверьте связанные материалы. Вы выбираете, какие изменения принять, сохраняя собственные правки." },
    { title: "Возвращайтесь к лучшему", text: "Сравнивайте версии, находите удачные решения и продолжайте с выбранного состояния." },
  ],
  processTitle: "От исходных материалов к готовой работе",
  steps: [
    { title: "Опишите задачу", text: "Начните с того, что нужно сделать. Используйте свои таблицы, документы, фотографии и условия." },
    { title: "Проверьте основу", text: "Уточните данные, согласуйте план и задайте условия. Tirlik сохраняет исходные материалы рядом с результатом." },
    { title: "Доработайте результат", text: "Проверьте расчёты, формулировки и оформление. Согласуйте итог с коллегами и используйте в своём процессе." },
  ],
  boundaryTitle: "Ваш бизнес остаётся вашим",
  boundaryText: "Tirlik предназначен для внутренней подготовки работы. Клиентам не нужен ещё один аккаунт, а вам не нужно переносить сюда продажи.",
  boundaryItems: ["Общайтесь с клиентами на своём сайте, в мессенджерах и привычных каналах.", "Проверяйте расчёты по исходным данным и принимайте решения сами.", "Работайте с коллегами в одном пространстве и выбирайте, кому доступны материалы."],
  accessTitle: "Что нужно сделать сегодня?",
  accessText: "Предложение клиенту, расчёт закупки или материалы для новой акции. Соберите исходные файлы, опишите задачу и начните работу в Tirlik.",
  team: "Открыть команду", footerText: "Рабочие материалы и повседневные задачи бизнеса. Решения остаются за вами.", help: "Помощь", privacy: "Данные и конфиденциальность", repository: "Код проекта", back: "Вернуться на главную",
  helpTitle: "Помощь с аккаунтом", helpIntro: "Вход, подтверждение почты и начало работы с командой.",
  helpSections: [
    { title: 'Первый результат', text: 'Начните с задачи и своих материалов. Короткие подсказки покажут запуск, редактор, версии и экспорт. Знакомство можно пропустить и повторить в настройках.', link: 'tour', action: 'Открыть обучение' },
    { title: "Создание аккаунта", text: "Укажите имя, электронную почту и пароль. Затем откройте письмо и подтвердите адрес, чтобы перейти к работе.", link: "signup", action: "Создать аккаунт" },
    { title: "Письмо не пришло", text: "Проверьте адрес и папку со спамом, затем запросите новое письмо. Используйте ссылку из последнего полученного письма.", link: "verify", action: "Запросить письмо" },
    { title: "Забыли пароль", text: "Запросите ссылку на адрес, с которым создавали аккаунт. После смены пароля нужно войти снова; остальные сеансы завершатся.", link: "reset", action: "Восстановить доступ" },
    { title: "Работа с коллегами", text: "В разделе команды можно создать пространство, пригласить коллегу и определить его права. Приглашённый человек получает доступ после принятия приглашения.", link: "team", action: "Перейти к команде" },
    { title: "Сеанс завершился", text: "Войдите снова в тот же аккаунт и явно продолжите работу. Проверьте сохранившийся ввод перед повторной отправкой. Пароли и подтверждения опасных действий не восстанавливаются." },
  ],
  privacyTitle: "Данные и конфиденциальность", privacyIntro: "Какие данные используются в работе и как вы управляете доступом к ним.",
  privacySections: [
    { title: "Данные аккаунта", text: "Tirlik хранит имя, адрес электронной почты, выбранный язык, сведения о сеансах и участие в командах. Пароль используется для входа и хранится в виде криптографического хеша." },
    { title: "Доступ к рабочим материалам", text: "Доступ определяется участием в пространстве и назначенными правами. Публичная главная не открывает личные материалы. Выход из аккаунта закрывает текущий сеанс." },
    { title: "Письма аккаунта", text: "Электронная почта используется для подтверждения адреса, восстановления доступа и приглашений в команду. Не передавайте ссылки для входа и восстановления другим людям." },
    { title: "ИИ и внешние сервисы", text: "Для выполнения задачи выбранные материалы могут передаваться внешнему провайдеру ИИ. Добавляйте только те данные, которые вы вправе использовать и передавать для обработки." },
    { title: "Управление аккаунтом", text: "В настройках доступны смена пароля, завершение сеансов и удаление аккаунта. Если вы владеете пространством, сначала нужно решить, кому передать владение или какие данные удалить. Последствия показываются перед подтверждением." },
    { title: "Совместная работа", text: "Проверяйте состав команды и права участников, прежде чем добавлять рабочие материалы. Владелец пространства управляет приглашениями, ролями и доступом коллег." },
  ],
};

const en: PublicCopy = {
  mechanismIllustration: 'A source price list in a folder is connected to a prepared proposal. Reviewed changes carry into the result.', mechanismSource: 'A price changes in the source', mechanismResult: 'Calculation updated, your wording kept',
  ownTaskTitle: 'Start with your own task', ownTaskDescription: 'Describe the result you need. Then add a price list, a client request or other materials to your project.',
  ownTaskLabel: 'What do you need to prepare?', ownTaskPlaceholder: 'An estimate and customer proposal using my price list. Show delivery and deadlines separately.', ownTaskAction: 'Continue with my task', ownTaskError: 'Could not continue. Your text is still here. Please try again.', ownTaskAccount: 'After signing in, your task will open in your project.', ownTaskSignedIn: 'Choose a workspace and add your materials.', exampleAction: 'Try an example', useScenario: 'Start this kind of task',
  tagline: "Everything for your business",
  work: "Open workspace",
  description: "Turn a price list and client request into an estimate and proposal. Edit the result, update prices and keep your own wording.",
  home: "Home", scenarios: "Business tasks", process: "How it works", start: "Get started", signIn: "Sign in", account: "My account", explore: "Explore the scenarios", language: "Language",
  illustration: "An illustration of business materials: worksheets, a folder and product photographs.",
  introTitle: "Start with the work you need to do",
  intro: "Prepare a proposal, understand expenses or put together a promotion. Each scenario starts with your files and a useful business result.",
  scenarioItems: [
    { title: "A client proposal", task: "“Prepare a proposal for this request and check the cost”", input: "Client request, price list, terms", output: "Estimate and business proposal", detail: "Prices, quantities and terms belong in both the calculation and the document. Connecting them makes it easier to see what needs updating after a change." },
    { title: "Expenses and purchasing", task: "“Compare suppliers, including delivery costs”", input: "Supplier prices, quantities, deadlines", output: "Comparison table and purchasing plan", detail: "Compare the same items and units. Unknown delivery costs and incomplete terms should remain visible when you decide." },
    { title: "A promotion", task: "“Prepare materials for our products and new prices”", input: "Photos, product details, prices, brand style", output: "Offer copy, design and publishing plan", detail: "Photos, copy and terms work together. Customers still reach you through the channels they already use." },
  ],
  inputLabel: "Your materials", outputLabel: "Your finished work",
  controlTitle: "A change should not mean starting over",
  controlBody: "Calculations, documents and visual materials stay connected within your task. Adjust the details, compare alternatives and shape the result around your business.",
  controlItems: [
    { title: "Edit where the work is", text: "Change text in a document, a value in a table or an object in a design. On your own or together with AI." },
    { title: "Control each change", text: "Update a source price and review the related materials. Choose which changes to accept while keeping your own edits." },
    { title: "Return to your best work", text: "Compare versions, find the strongest ideas and continue from the state you choose." },
  ],
  processTitle: "From source materials to finished work",
  steps: [
    { title: "Describe your task", text: "Start with what you need to do. Bring your tables, documents, photos and requirements." },
    { title: "Check the inputs", text: "Review the data, agree on a plan and set your requirements. Tirlik keeps source materials alongside the result." },
    { title: "Refine the result", text: "Check calculations, wording and design. Agree on the result with colleagues and use it in your own process." },
  ],
  boundaryTitle: "Your business stays yours", boundaryText: "Tirlik is for preparing work inside your business. Customers do not need another account, and you do not need to move your sales here.",
  boundaryItems: ["Reach customers on your website, in messengers and through your existing channels.", "Check calculations against source data and make your own decisions.", "Work with colleagues in one space and choose who can access your materials."],
  accessTitle: "What needs doing today?", accessText: "A client proposal, a purchasing estimate or materials for your next promotion. Bring your files, describe the task and get to work in Tirlik.",
  team: "Open team", footerText: "Business materials and everyday work. The decisions remain yours.", help: "Help", privacy: "Data and privacy", repository: "Project source", back: "Back to home",
  helpTitle: "Account help", helpIntro: "Signing in, verifying your email and getting started with your team.",
  helpSections: [
    { title: 'Your first result', text: 'Start with your task and materials. Brief guidance shows you how to start work, edit results, review versions and export. Skip it or replay it in settings.', link: 'tour', action: 'Open getting started' },
    { title: "Create an account", text: "Enter your name, email and password. Open the email and verify your address to start working.", link: "signup", action: "Create an account" },
    { title: "An email has not arrived", text: "Check the address and spam folder, then request a new email. Use the link in the most recent message.", link: "verify", action: "Request an email" },
    { title: "Forgotten password", text: "Request a link for the email used to create your account. After changing your password, sign in again. Other sessions will end.", link: "reset", action: "Recover access" },
    { title: "Work with colleagues", text: "Create a space in the team section, invite a colleague and choose their permissions. They gain access after accepting the invitation.", link: "team", action: "Open team" },
    { title: "Your session ended", text: "Sign in to the same account and explicitly resume your work. Review retained input before submitting again. Passwords and confirmations for dangerous actions are not restored." },
  ],
  privacyTitle: "Data and privacy", privacyIntro: "The data used in your work and how you control access to it.",
  privacySections: [
    { title: "Account data", text: "Tirlik stores your name, email address, language preference, session details and team memberships. Your password is used for authentication and stored as a cryptographic hash." },
    { title: "Access to work materials", text: "Space membership and assigned permissions determine access. The public website does not expose private materials. Signing out ends the current session." },
    { title: "Account emails", text: "Your email is used to verify your address, recover access and receive team invitations. Do not share sign-in or recovery links with anyone else." },
    { title: "AI and external services", text: "Selected materials may be sent to an external AI provider to complete a task. Only add data you have permission to use and share for processing." },
    { title: "Manage your account", text: "Settings let you change your password, end sessions and delete your account. Space owners must first decide whether to transfer ownership or delete the relevant data. Consequences are shown before confirmation." },
    { title: "Working together", text: "Review team membership and permissions before adding work materials. The space owner manages invitations, roles and colleagues’ access." },
  ],
};

const kk: PublicCopy = {
  mechanismIllustration: 'Қалтадағы бастапқы бағалар тізімі дайын ұсыныспен байланысты. Тексерілген өзгерістер нәтижеге өтеді.', mechanismSource: 'Бастапқы материалдағы баға өзгерді', mechanismResult: 'Есеп жаңартылды, өз мәтініңіз сақталды',
  ownTaskTitle: 'Өз тапсырмаңыздан бастаңыз', ownTaskDescription: 'Қажетті нәтижені сипаттаңыз. Содан кейін жобаңызға бағалар тізімін, клиент сұрауын немесе басқа материалдарды қосыңыз.',
  ownTaskLabel: 'Не дайындау керек?', ownTaskPlaceholder: 'Менің бағалар тізімім бойынша клиентке смета мен ұсыныс. Жеткізу мен мерзімдерді бөлек көрсету.', ownTaskAction: 'Өз тапсырмаммен жалғастыру', ownTaskError: 'Жалғастыру мүмкін болмады. Мәтініңіз осында қалды. Қайталап көріңіз.', ownTaskAccount: 'Кіргеннен кейін тапсырмаңыз жобаңызда ашылады.', ownTaskSignedIn: 'Жұмыс кеңістігін таңдап, материалдарыңызды қосыңыз.', exampleAction: 'Мысалмен байқап көру', useScenario: 'Осындай тапсырманы бастау',
  tagline: "Бизнесіңізге қажеттінің бәрі",
  work: "Жұмысқа өту",
  description: "Бағалар тізімі мен клиент сұрауынан смета және ұсыныс дайындаңыз. Нәтижені өңдеп, бағаларды жаңартыңыз және өз мәтініңізді сақтаңыз.",
  home: "Басты бет", scenarios: "Қандай міндеттерге", process: "Қалай жұмыс істейді", start: "Жұмысты бастау", signIn: "Кіру", account: "Менің аккаунтым", explore: "Сценарийлерді қарау", language: "Тіл",
  illustration: "Жұмыс материалдарының иллюстрациясы: кестелер, бума және өнім фотосуреттері.",
  introTitle: "Жұмыс өз міндетіңізден басталады", intro: "Ұсыныс дайындау, шығындарды талдау немесе акция материалдарын жинау. Әр сценарийдің негізінде өз файлдарыңыз бен бизнеске қажет нәтиже бар.",
  scenarioItems: [
    { title: "Клиентке ұсыныс", task: "«Осы сұранысқа ұсыныс дайындап, құнын тексеру»", input: "Клиент сұранысы, бағалар, шарттар", output: "Смета және коммерциялық ұсыныс", detail: "Баға, көлем және шарттар есепте де, құжатта да қажет. Олардың байланысы түзетуден кейін нені жаңарту керегін көруге көмектеседі." },
    { title: "Шығындар мен сатып алу", task: "«Жеткізуді ескеріп, жеткізушілерді салыстыру»", input: "Жеткізуші бағалары, көлем, мерзім", output: "Салыстыру кестесі және сатып алу жоспары", detail: "Бірдей тауарлар мен өлшем бірліктерін салыстырыңыз. Белгісіз жеткізу құны мен толық емес шарттар шешім қабылдағанда көрініп тұруы керек." },
    { title: "Акция материалдары", task: "«Тауарларымыз бен жаңа бағаларға материал дайындау»", input: "Фото, тауар сипаттамасы, баға, стиль", output: "Ұсыныс мәтіні, макет және жариялау жоспары", detail: "Фотосурет, мәтін және шарттар бірге қолданылады. Клиенттер сізге бұрынғы таныс арналар арқылы хабарласа береді." },
  ],
  inputLabel: "Өз материалдарыңыз", outputLabel: "Дайын нәтиже",
  controlTitle: "Түзету жұмысты қайта бастатпауы керек", controlBody: "Есептеулер, құжаттар мен көрнекі материалдар бір міндет аясында байланысады. Мәліметтерді өзгертіңіз, нұсқаларды салыстырыңыз және нәтижені бизнесіңізге бейімдеңіз.",
  controlItems: [
    { title: "Орнында өңдеңіз", text: "Құжаттағы мәтінді, кестедегі мәнді немесе макеттегі объектіні өзгертіңіз. Өз бетіңізше немесе ЖИ көмегімен." },
    { title: "Өзгерістерді басқарыңыз", text: "Бастапқы бағаны жаңартып, байланысты материалдарды тексеріңіз. Өз түзетулеріңізді сақтай отырып, қай өзгерістерді қабылдауды таңдаңыз." },
    { title: "Үздік нұсқаға оралыңыз", text: "Нұсқаларды салыстырыңыз, сәтті шешімдерді табыңыз және таңдалған күйден жалғастырыңыз." },
  ],
  processTitle: "Бастапқы материалдан дайын жұмысқа дейін",
  steps: [
    { title: "Міндетті сипаттаңыз", text: "Не істеу керегінен бастаңыз. Өз кестелеріңізді, құжаттарыңызды, фотоларыңыз бен шарттарыңызды пайдаланыңыз." },
    { title: "Негізін тексеріңіз", text: "Деректерді нақтылап, жоспарды келісіңіз және шарттарды белгілеңіз. Tirlik бастапқы материалдарды нәтижемен бірге сақтайды." },
    { title: "Нәтижені толықтырыңыз", text: "Есептеулерді, мәтінді және безендіруді тексеріңіз. Әріптестермен келісіп, өз жұмысыңызда қолданыңыз." },
  ],
  boundaryTitle: "Бизнесіңіз өз қолыңызда", boundaryText: "Tirlik бизнестің ішкі жұмысын дайындауға арналған. Клиентке тағы бір аккаунт керек емес, ал сізге сатылымдарды мұнда көшіру қажет емес.",
  boundaryItems: ["Клиенттермен сайтыңызда, мессенджерлерде және таныс арналарда байланысыңыз.", "Есептеулерді бастапқы деректермен тексеріп, шешімді өзіңіз қабылдаңыз.", "Әріптестермен бір кеңістікте жұмыс істеп, материалдарға кім кіре алатынын таңдаңыз."],
  accessTitle: "Бүгін не істеу керек?", accessText: "Клиентке ұсыныс, сатып алу есебі немесе жаңа акция материалдары. Файлдарыңызды жинап, міндетті сипаттаңыз және Tirlik-те жұмысты бастаңыз.",
  team: "Команданы ашу", footerText: "Бизнес материалдары мен күнделікті жұмыс. Шешім өз қолыңызда.", help: "Көмек", privacy: "Деректер және құпиялылық", repository: "Жоба коды", back: "Басты бетке оралу",
  helpTitle: "Аккаунт бойынша көмек", helpIntro: "Кіру, поштаны растау және командамен жұмысты бастау.",
  helpSections: [
    { title: 'Алғашқы нәтиже', text: 'Тапсырмаңыз бен материалдарыңыздан бастаңыз. Қысқа кеңестер іске қосуды, редакторды, нұсқалар мен экспортты көрсетеді. Танысуды өткізіп жіберуге немесе баптаулардан қайталауға болады.', link: 'tour', action: 'Бастау нұсқаулығын ашу' },
    { title: "Аккаунт ашу", text: "Атыңызды, электрондық поштаңызды және құпиясөзді енгізіңіз. Жұмысты бастау үшін хатты ашып, мекенжайды растаңыз.", link: "signup", action: "Аккаунт ашу" },
    { title: "Хат келмеді", text: "Мекенжай мен спам бумасын тексеріп, жаңа хат сұраңыз. Соңғы келген хаттағы сілтемені пайдаланыңыз.", link: "verify", action: "Хат сұрау" },
    { title: "Құпиясөз ұмытылды", text: "Аккаунт ашқан поштаңызға сілтеме сұраңыз. Құпиясөз өзгергеннен кейін қайта кіру керек. Басқа сеанстар аяқталады.", link: "reset", action: "Кіруді қалпына келтіру" },
    { title: "Әріптестермен жұмыс", text: "Команда бөлімінде кеңістік ашып, әріптесті шақырыңыз және рұқсаттарын таңдаңыз. Шақыруды қабылдағаннан кейін оған қолжетімділік беріледі.", link: "team", action: "Командаға өту" },
    { title: "Сеанс аяқталды", text: "Сол аккаунтқа қайта кіріп, жұмысты жалғастыруды таңдаңыз. Қайта жібермес бұрын сақталған енгізуді тексеріңіз. Құпиясөздер мен қауіпті әрекеттерді растау қалпына келтірілмейді." },
  ],
  privacyTitle: "Деректер және құпиялылық", privacyIntro: "Жұмыста қолданылатын деректер және оларға қолжетімділікті басқару.",
  privacySections: [
    { title: "Аккаунт деректері", text: "Tirlik атыңызды, пошта мекенжайын, таңдаған тілді, сеанс мәліметтерін және команда мүшелігін сақтайды. Құпиясөз кіру үшін қолданылады және криптографиялық хеш түрінде сақталады." },
    { title: "Жұмыс материалдарына қолжетімділік", text: "Қолжетімділік кеңістік мүшелігі мен тағайындалған рұқсаттарға байланысты. Басты бет жеке материалдарды ашпайды. Аккаунттан шығу ағымдағы сеансты аяқтайды." },
    { title: "Аккаунт хаттары", text: "Пошта мекенжайды растау, кіруді қалпына келтіру және команда шақырулары үшін қолданылады. Кіру немесе қалпына келтіру сілтемелерін басқа адамға бермеңіз." },
    { title: "ЖИ және сыртқы сервистер", text: "Міндетті орындау үшін таңдалған материалдар сыртқы ЖИ провайдеріне берілуі мүмкін. Пайдалануға және өңдеуге беруге рұқсатыңыз бар деректерді ғана қосыңыз." },
    { title: "Аккаунтты басқару", text: "Баптауларда құпиясөзді өзгерту, сеанстарды аяқтау және аккаунтты жою бар. Кеңістік иесі алдымен иелікті беру немесе тиісті деректерді жою туралы шешім қабылдайды. Салдары растаудан бұрын көрсетіледі." },
    { title: "Бірлескен жұмыс", text: "Жұмыс материалдарын қоспас бұрын команда құрамын және қатысушылар рұқсаттарын тексеріңіз. Кеңістік иесі шақыруларды, рөлдерді және әріптестер қолжетімділігін басқарады." },
  ],
};

export const publicCopy: Record<Locale, PublicCopy> = { ru, kk, en };
