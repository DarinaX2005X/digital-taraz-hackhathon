import type { Locale } from "@/i18n";

type InformationSection = { title: string; text: string; link?: "signup" | "reset" | "team" | 'tour'; action?: string };

export type PublicCopy = {
  mechanismIllustration: string; mechanismSource: string; mechanismResult: string;
  ownTaskTitle: string; ownTaskDescription: string; ownTaskLabel: string; ownTaskPlaceholder: string; ownTaskAction: string; ownTaskError: string; ownTaskAccount: string; ownTaskSignedIn: string; useScenario: string;
  cabinet: string; watchDemo: string; presentation: string; mediaPending: string;
  exampleTitle: string; exampleBody: string; exampleAction: string;
  heroTitle: string; description: string; heroPath: string; processAction: string; resumeWork: string; home: string; scenarios: string; process: string;
  start: string; signIn: string; account: string; work: string; explore: string; language: string;
  illustration: string; introTitle: string; intro: string;
  proof: {
    title: string; intro: string; goalLabel: string; goal: string; planLabel: string; plan: { title: string; text: string }[];
    findingLabel: string; findings: string[]; decisionLabel: string; decision: string;
    resultLabel: string; results: { title: string; text: string }[]; continuation: string;
  };
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
  cabinet: 'Мой кабинет', watchDemo: 'Смотреть демо', presentation: 'Презентация', mediaPending: 'Материал появится здесь после финальной подготовки',
  exampleTitle: 'Попробуйте Tirlik на готовом рабочем примере', exampleBody: 'В демо-пространстве уже есть запрос заказчика, прайс, текущая загрузка и ограничения. Пройдите тот же путь, что в своей работе: проверьте заказ, выберите решение и получите редактируемые материалы.', exampleAction: 'Попробовать на примере',
  mechanismIllustration: 'После решения смета, предложение и план остаются связанными живыми материалами.', mechanismSource: 'Новая цена или условие', mechanismResult: 'Показаны только затронутые изменения',
  ownTaskTitle: 'Поставьте реальную задачу', ownTaskDescription: 'Опишите цель своими словами. В рабочей сессии можно добавить запрос, прайс, правила расчёта и данные о загрузке.',
  ownTaskLabel: 'Что нужно решить?', ownTaskPlaceholder: 'Проверь, сможем ли мы выполнить этот заказ к открытию без убыточных условий, и подготовь ответ.', ownTaskAction: 'Начать задачу', ownTaskError: 'Не удалось продолжить. Ваш текст остался здесь. Попробуйте ещё раз.', ownTaskAccount: 'После входа эта цель откроется в рабочей сессии и не потеряется.', ownTaskSignedIn: 'Выберите рабочее пространство и добавьте материалы.', useScenario: 'Начать такую задачу',
  heroTitle: "Всё для вашего бизнеса",
  work: "Перейти к работе",
  description: "Предложения клиентам, планы работы, закупки и рекламные материалы. Tirlik готовит их по вашим данным, а вы выбираете решение и управляете результатом.",
  heroPath: "Цель → план и инструменты AI → ваше решение → смета, предложение и план работ",
  processAction: "Как принимается решение", resumeWork: "Продолжить работу",
  home: "На главную", scenarios: "Для каких задач", process: "Как это работает", start: "Начать работу", signIn: "Войти", account: "Мой аккаунт", explore: "Посмотреть сценарии", language: "Язык",
  illustration: "Предметная иллюстрация рабочих материалов бизнеса.",
  proof: {
    title: "Не написать ответ, а помочь принять решение",
    intro: "На нестандартном заказе Tirlik сначала проверяет экономику и выполнимость. Документы появляются после содержательного выбора, а не вместо него.",
    goalLabel: "Деловая цель", goal: "«Можем ли выполнить этот заказ к открытию без убыточных условий?»",
    planLabel: "Изменяемый план AI", plan: [
      { title: "Разобрать запрос", text: "Ассистент выделяет состав, условия, дату и недостающий факт. Вопрос появляется, только если ответ влияет на решение." },
      { title: "Проверить экономику и загрузку", text: "Точные инструменты сверяют прайс, правила расчёта, сроки и доступную мощность. Неизвестное не заменяется выдуманным числом." },
      { title: "Сравнить варианты", text: "Выполнимые варианты сравниваются по марже, сроку и нагрузке. Ассистент готовит материалы после вашего выбора, а не вместо него." }
    ],
    findingLabel: "Что нашёл ассистент", findings: ["Срок запроса конфликтует с текущей загрузкой", "Одно условие нужно уточнить до расчёта", "Часть вариантов не подходит по марже или сроку"],
    decisionLabel: "Ваше решение", decision: "Изменить состав, перенести срок или пересчитать условия. Каждый вариант показан вместе с последствиями.",
    resultLabel: "Живые результаты после выбора", results: [{ title: "Смета", text: "Точные строки, формулы и допущения" }, { title: "Предложение", text: "Проверенные условия и ваши формулировки" }, { title: "План работ", text: "Сроки, нагрузка и точки контроля" }],
    continuation: "Каждый результат можно исправить прямо в сессии, а затем выгрузить и использовать на своём сайте, в почте или мессенджере."
  },
  introTitle: "Работа начинается с вашей задачи",
  intro: "Ассистент выбирает проверяемые операции под цель, а не заставляет искать нужную AI-кнопку. Вы видите план, исходные факты, вопросы и живые результаты.",
  scenarioItems: [
    { title: "Нестандартный заказ", task: "«Проверь, можем ли мы выполнить этот заказ к открытию без убыточных условий»", input: "Запрос, прайс, правила и загрузка", output: "Решение, смета, предложение и план", detail: "Tirlik находит конфликт срока и загрузки, отделяет неизвестное от фактов и сравнивает варианты до вашего решения." },
    { title: "Расходы и закупки", task: "«Сравнить предложения поставщиков с учётом доставки»", input: "Прайсы поставщиков, объёмы, сроки", output: "Таблица сравнения и план закупки", detail: "Сопоставляйте одинаковые позиции и единицы. Неизвестная стоимость доставки или неполные условия должны оставаться видимыми при выборе." },
    { title: "Материалы для акции", task: "«Подготовить материалы по нашим товарам и новым ценам»", input: "Фото, описание товара, цены, стиль", output: "Текст предложения, макет и план публикаций", detail: "Фотографии, текст и условия работают вместе. Покупатели по-прежнему обращаются к вам в привычном канале." },
  ],
  inputLabel: "Ваши материалы", outputLabel: "Готовый результат",
  controlTitle: "После решения работа остаётся живой",
  controlBody: "Смета, предложение и план открываются как полноценные рабочие компоненты. Прямая правка нужна, чтобы управлять уже принятым деловым решением, а не заменять его текстовым ответом.",
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
  helpTitle: "Как начать работу", helpIntro: "От деловой цели и своих материалов к решению, живым результатам и возврату к сохранённой работе.",
  helpSections: [
    { title: 'Первый результат', text: 'Начните с цели и добавьте только нужные материалы. Проверьте план AI, ответьте на существенный вопрос и примите решение. После этого смета, документ или план откроются для прямой правки и экспорта. Обучение можно пропустить и повторить.', link: 'tour', action: 'Открыть обучение' },
    { title: "Создание аккаунта", text: "Укажите имя, электронную почту и пароль — после регистрации можно сразу перейти к работе.", link: "signup", action: "Создать аккаунт" },
    { title: "Забыли пароль", text: "Запросите ссылку на адрес, с которым создавали аккаунт. После смены пароля нужно войти снова; остальные сеансы завершатся.", link: "reset", action: "Восстановить доступ" },
    { title: "Работа с коллегами", text: "В разделе команды можно создать пространство, пригласить коллегу и определить его права. Приглашённый человек получает доступ после принятия приглашения.", link: "team", action: "Перейти к команде" },
    { title: "Сеанс завершился", text: "Войдите снова в тот же аккаунт и явно продолжите работу. Проверьте сохранившийся ввод перед повторной отправкой. Пароли и подтверждения опасных действий не восстанавливаются." },
  ],
  privacyTitle: "Данные и конфиденциальность", privacyIntro: "Какие данные используются в работе и как вы управляете доступом к ним.",
  privacySections: [
    { title: "Данные аккаунта", text: "Tirlik хранит имя, адрес электронной почты, выбранный язык, сведения о сеансах и участие в командах. Пароль используется для входа и хранится в виде криптографического хеша." },
    { title: "Доступ к рабочим материалам", text: "Доступ определяется участием в пространстве и назначенными правами. Публичная главная не открывает личные материалы. Выход из аккаунта закрывает текущий сеанс." },
    { title: "Письма аккаунта", text: "Электронная почта используется для восстановления доступа и приглашений в команду. Не передавайте другим людям ссылки для восстановления и приглашения." },
    { title: "ИИ и внешние сервисы", text: "Для выполнения задачи выбранные материалы могут передаваться внешнему провайдеру ИИ. Добавляйте только те данные, которые вы вправе использовать и передавать для обработки." },
    { title: "Управление аккаунтом", text: "В настройках доступны смена пароля, завершение сеансов и удаление аккаунта. Если вы владеете пространством, сначала нужно решить, кому передать владение или какие данные удалить. Последствия показываются перед подтверждением." },
    { title: "Совместная работа", text: "Проверяйте состав команды и права участников, прежде чем добавлять рабочие материалы. Владелец пространства управляет приглашениями, ролями и доступом коллег." },
  ],
};

const en: PublicCopy = {
  cabinet: 'My workspace', watchDemo: 'Watch demo', presentation: 'Presentation', mediaPending: 'This material will appear after final production',
  exampleTitle: 'Try Tirlik in a prepared workspace', exampleBody: 'The demo workspace already contains a customer request, pricing, current capacity and constraints. Follow the same path as your own work: check the order, choose a decision and receive editable materials.', exampleAction: 'Try the example',
  mechanismIllustration: 'After the decision, the estimate, proposal and work plan remain connected live materials.', mechanismSource: 'A new price or condition', mechanismResult: 'Only affected changes are proposed',
  ownTaskTitle: 'Bring a real business decision', ownTaskDescription: 'Describe the goal in your own words. In the work session, add the request, price list, calculation rules and current capacity.',
  ownTaskLabel: 'What do you need to decide?', ownTaskPlaceholder: 'Check whether we can complete this order by opening day without unprofitable terms, and prepare a response.', ownTaskAction: 'Start a task', ownTaskError: 'Could not continue. Your text is still here. Please try again.', ownTaskAccount: 'After sign-in, this goal opens in your work session and is not lost.', ownTaskSignedIn: 'Choose a workspace and add your materials.', useScenario: 'Start this kind of task',
  heroTitle: "Everything for your business",
  work: "Open workspace",
  description: "Customer proposals, work plans, purchasing and campaign materials. Tirlik prepares them from your data; you choose the decision and control the result.",
  heroPath: "Goal → AI plan and grounded tools → your decision → estimate, proposal and work plan",
  processAction: "See how the decision is made", resumeWork: "Continue working",
  home: "Home", scenarios: "Business tasks", process: "How it works", start: "Get started", signIn: "Sign in", account: "My account", explore: "Explore the scenarios", language: "Language",
  illustration: "An authored illustration of a business's working materials.",
  proof: {
    title: "Not a written answer, but a decision you can use",
    intro: "For a non-standard order, Tirlik checks economics and feasibility first. Documents appear after a consequential choice, not in place of one.",
    goalLabel: "Business goal", goal: "Can we complete this order by opening day without unprofitable terms?",
    planLabel: "Editable AI plan", plan: [
      { title: "Understand the request", text: "The assistant extracts scope, terms, date and the missing fact. It asks a question only when the answer changes the decision." },
      { title: "Check economics and capacity", text: "Exact tools check the price list, calculation rules, dates and available capacity. An unknown is never replaced with an invented number." },
      { title: "Compare the options", text: "Feasible options are aligned by margin, deadline and load. The assistant prepares working materials after your choice, not instead of it." }
    ],
    findingLabel: "What the assistant found", findings: ["The requested date conflicts with current capacity", "One condition must be clarified before calculation", "Some options fail the margin or deadline constraint"],
    decisionLabel: "Your decision", decision: "Change the scope, move the date or recalculate the terms. Every option is shown with its consequences.",
    resultLabel: "Live results after the choice", results: [{ title: "Estimate", text: "Exact lines, formulas and assumptions" }, { title: "Proposal", text: "Reviewed terms and your own wording" }, { title: "Work plan", text: "Dates, capacity and control points" }],
    continuation: "Edit every result inside the session, then export it for your website, email or messenger. Your customers do not need a Tirlik account."
  },
  introTitle: "Start with the work you need to do",
  intro: "The assistant chooses verifiable operations for the goal instead of asking you to find the right AI button. You see its plan, source facts, questions and live results.",
  scenarioItems: [
    { title: "A non-standard order", task: "“Check whether we can complete this order by opening day without unprofitable terms”", input: "Request, price list, rules and capacity", output: "Decision, estimate, proposal and plan", detail: "Tirlik finds the deadline and capacity conflict, separates unknowns from facts and compares options before you decide." },
    { title: "Expenses and purchasing", task: "“Compare suppliers, including delivery costs”", input: "Supplier prices, quantities, deadlines", output: "Comparison table and purchasing plan", detail: "Compare the same items and units. Unknown delivery costs and incomplete terms should remain visible when you decide." },
    { title: "A promotion", task: "“Prepare materials for our products and new prices”", input: "Photos, product details, prices, brand style", output: "Offer copy, design and publishing plan", detail: "Photos, copy and terms work together. Customers still reach you through the channels they already use." },
  ],
  inputLabel: "Your materials", outputLabel: "Your finished work",
  controlTitle: "The work stays live after the decision",
  controlBody: "The estimate, proposal and plan open as complete working components. Direct editing lets you control a business decision already made instead of replacing that decision with generated prose.",
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
  helpTitle: "How to start working", helpIntro: "From a business goal and your own materials to a decision, live results and a saved work session.",
  helpSections: [
    { title: 'Your first result', text: 'Start with a goal and only the materials it needs. Review the AI plan, answer a consequential question and make the decision. The estimate, document or plan then opens for direct editing and export. Skip the guidance or replay it later.', link: 'tour', action: 'Open getting started' },
    { title: "Create an account", text: "Enter your name, email and password, then start working immediately.", link: "signup", action: "Create an account" },
    { title: "Forgotten password", text: "Request a link for the email used to create your account. After changing your password, sign in again. Other sessions will end.", link: "reset", action: "Recover access" },
    { title: "Work with colleagues", text: "Create a space in the team section, invite a colleague and choose their permissions. They gain access after accepting the invitation.", link: "team", action: "Open team" },
    { title: "Your session ended", text: "Sign in to the same account and explicitly resume your work. Review retained input before submitting again. Passwords and confirmations for dangerous actions are not restored." },
  ],
  privacyTitle: "Data and privacy", privacyIntro: "The data used in your work and how you control access to it.",
  privacySections: [
    { title: "Account data", text: "Tirlik stores your name, email address, language preference, session details and team memberships. Your password is used for authentication and stored as a cryptographic hash." },
    { title: "Access to work materials", text: "Space membership and assigned permissions determine access. The public website does not expose private materials. Signing out ends the current session." },
    { title: "Account emails", text: "Your email is used to recover access and receive team invitations. Do not share recovery or invitation links with anyone else." },
    { title: "AI and external services", text: "Selected materials may be sent to an external AI provider to complete a task. Only add data you have permission to use and share for processing." },
    { title: "Manage your account", text: "Settings let you change your password, end sessions and delete your account. Space owners must first decide whether to transfer ownership or delete the relevant data. Consequences are shown before confirmation." },
    { title: "Working together", text: "Review team membership and permissions before adding work materials. The space owner manages invitations, roles and colleagues’ access." },
  ],
};

const kk: PublicCopy = {
  cabinet: 'Менің кабинетім', watchDemo: 'Демоны көру', presentation: 'Презентация', mediaPending: 'Материал финалдық дайындықтан кейін осында шығады',
  exampleTitle: 'Tirlik-ті дайын жұмыс мысалында көріңіз', exampleBody: 'Демо кеңістігінде клиент сұрауы, бағалар, ағымдағы жүктеме және шектеулер дайын. Өз жұмысыңыздағыдай жолдан өтіңіз: тапсырысты тексеріп, шешім таңдап, өңделетін материалдарды алыңыз.', exampleAction: 'Мысалда байқап көру',
  mechanismIllustration: 'Шешімнен кейін смета, ұсыныс және жұмыс жоспары өзара байланысқан жанды материалдар болып қалады.', mechanismSource: 'Жаңа баға немесе шарт', mechanismResult: 'Тек өзгерген бөліктер ұсынылады',
  ownTaskTitle: 'Нақты бизнес шешімін қойыңыз', ownTaskDescription: 'Мақсатты өз сөзіңізбен жазыңыз. Жұмыс сеансында сұрауды, бағаларды, есептеу ережелерін және ағымдағы жүктемені қосуға болады.',
  ownTaskLabel: 'Қандай шешім қабылдау керек?', ownTaskPlaceholder: 'Бұл тапсырысты ашылу күніне дейін тиімсіз шарттарсыз орындай аламыз ба, тексеріп, жауап дайында.', ownTaskAction: 'Тапсырманы бастау', ownTaskError: 'Жалғастыру мүмкін болмады. Мәтініңіз осында қалды. Қайталап көріңіз.', ownTaskAccount: 'Кіргеннен кейін бұл мақсат жұмыс сеансында ашылып, жоғалмайды.', ownTaskSignedIn: 'Жұмыс кеңістігін таңдап, материалдарыңызды қосыңыз.', useScenario: 'Осындай тапсырманы бастау',
  heroTitle: "Бизнесіңізге қажеттінің бәрі",
  work: "Жұмысқа өту",
  description: "Клиенттерге ұсыныстар, жұмыс жоспарлары, сатып алу және жарнама материалдары. Tirlik оларды сіздің деректеріңіз бойынша дайындайды, ал шешімді сіз таңдап, нәтижені өзіңіз басқарасыз.",
  heroPath: "Мақсат → AI жоспары мен нақты құралдар → сіздің шешіміңіз → смета, ұсыныс және жұмыс жоспары",
  processAction: "Шешім қалай қабылданады", resumeWork: "Жұмысты жалғастыру",
  home: "Басты бет", scenarios: "Қандай міндеттерге", process: "Қалай жұмыс істейді", start: "Жұмысты бастау", signIn: "Кіру", account: "Менің аккаунтым", explore: "Сценарийлерді қарау", language: "Тіл",
  illustration: "Бизнестің жұмыс материалдарының авторлық иллюстрациясы.",
  proof: {
    title: "Мәтіндік жауап емес, қолдануға болатын шешім",
    intro: "Стандарттан тыс тапсырыс үшін Tirlik алдымен экономика мен орындалу мүмкіндігін тексереді. Құжаттар маңызды таңдаудан кейін ғана пайда болады.",
    goalLabel: "Бизнес мақсаты", goal: "«Бұл тапсырысты ашылу күніне дейін тиімсіз шарттарсыз орындай аламыз ба?»",
    planLabel: "Өзгертуге болатын AI жоспары", plan: [
      { title: "Сұрауды түсіну", text: "Ассистент құрамды, шарттарды, күнді және жетіспейтін деректі бөледі. Сұрақ жауап шешімге әсер еткенде ғана қойылады." },
      { title: "Экономика мен жүктемені тексеру", text: "Нақты құралдар бағаны, есептеу ережелерін, мерзімді және бос қуатты тексереді. Белгісіз мән ойдан шығарылған санмен ауыстырылмайды." },
      { title: "Нұсқаларды салыстыру", text: "Орындалатын нұсқалар маржа, мерзім және жүктеме бойынша салыстырылады. Ассистент материалдарды сіздің таңдауыңыздан кейін ғана дайындайды." }
    ],
    findingLabel: "Ассистент нені тапты", findings: ["Сұралған мерзім ағымдағы жүктемемен қақтығысады", "Есептеуден бұрын бір шартты нақтылау керек", "Кейбір нұсқа маржаға немесе мерзімге сәйкес емес"],
    decisionLabel: "Сіздің шешіміңіз", decision: "Құрамды өзгерту, мерзімді жылжыту немесе шарттарды қайта есептеу. Әр нұсқа өз салдарымен бірге көрсетіледі.",
    resultLabel: "Таңдаудан кейінгі жанды нәтижелер", results: [{ title: "Смета", text: "Нақты жолдар, формулалар және болжамдар" }, { title: "Ұсыныс", text: "Тексерілген шарттар мен өз мәтініңіз" }, { title: "Жұмыс жоспары", text: "Мерзімдер, жүктеме және бақылау нүктелері" }],
    continuation: "Әр нәтижені сеанс ішінде түзетіп, содан кейін экспорттап, сайтта, поштада немесе мессенджерде қолдануға болады. Клиенттерге Tirlik аккаунты қажет емес."
  },
  introTitle: "Жұмыс өз міндетіңізден басталады", intro: "Ассистент сізді қажетті AI батырмасын іздеуге мәжбүрлемей, мақсатқа сәйкес тексерілетін әрекеттерді таңдайды. Сіз жоспарды, деректерді, сұрақтарды және жанды нәтижелерді көресіз.",
  scenarioItems: [
    { title: "Стандарттан тыс тапсырыс", task: "«Бұл тапсырысты ашылу күніне дейін тиімсіз шарттарсыз орындай аламыз ба?»", input: "Сұрау, баға, ережелер және жүктеме", output: "Шешім, смета, ұсыныс және жоспар", detail: "Tirlik мерзім мен жүктеме қақтығысын табады, белгісізді фактіден бөледі және сіз шешім қабылдағанға дейін нұсқаларды салыстырады." },
    { title: "Шығындар мен сатып алу", task: "«Жеткізуді ескеріп, жеткізушілерді салыстыру»", input: "Жеткізуші бағалары, көлем, мерзім", output: "Салыстыру кестесі және сатып алу жоспары", detail: "Бірдей тауарлар мен өлшем бірліктерін салыстырыңыз. Белгісіз жеткізу құны мен толық емес шарттар шешім қабылдағанда көрініп тұруы керек." },
    { title: "Акция материалдары", task: "«Тауарларымыз бен жаңа бағаларға материал дайындау»", input: "Фото, тауар сипаттамасы, баға, стиль", output: "Ұсыныс мәтіні, макет және жариялау жоспары", detail: "Фотосурет, мәтін және шарттар бірге қолданылады. Клиенттер сізге бұрынғы таныс арналар арқылы хабарласа береді." },
  ],
  inputLabel: "Өз материалдарыңыз", outputLabel: "Дайын нәтиже",
  controlTitle: "Шешімнен кейін жұмыс жанды күйде қалады", controlBody: "Смета, ұсыныс және жоспар толыққанды жұмыс компоненттері ретінде ашылады. Тікелей өңдеу шешімді жасанды мәтінмен алмастыру үшін емес, оны басқару үшін қажет.",
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
  helpTitle: "Жұмысты қалай бастауға болады", helpIntro: "Бизнес мақсаты мен өз материалдарыңыздан шешімге, жанды нәтижелерге және сақталған сеансқа дейін.",
  helpSections: [
    { title: 'Алғашқы нәтиже', text: 'Мақсаттан бастап, қажетті материалдарды ғана қосыңыз. AI жоспарын тексеріп, маңызды сұраққа жауап беріңіз және шешім қабылдаңыз. Содан кейін смета, құжат немесе жоспар тікелей өңдеу мен экспортқа ашылады. Нұсқаулықты өткізіп жіберуге немесе кейін қайталауға болады.', link: 'tour', action: 'Бастау нұсқаулығын ашу' },
    { title: "Аккаунт ашу", text: "Атыңызды, электрондық поштаңызды және құпиясөзді енгізіп, бірден жұмысты бастаңыз.", link: "signup", action: "Аккаунт ашу" },
    { title: "Құпиясөз ұмытылды", text: "Аккаунт ашқан поштаңызға сілтеме сұраңыз. Құпиясөз өзгергеннен кейін қайта кіру керек. Басқа сеанстар аяқталады.", link: "reset", action: "Кіруді қалпына келтіру" },
    { title: "Әріптестермен жұмыс", text: "Команда бөлімінде кеңістік ашып, әріптесті шақырыңыз және рұқсаттарын таңдаңыз. Шақыруды қабылдағаннан кейін оған қолжетімділік беріледі.", link: "team", action: "Командаға өту" },
    { title: "Сеанс аяқталды", text: "Сол аккаунтқа қайта кіріп, жұмысты жалғастыруды таңдаңыз. Қайта жібермес бұрын сақталған енгізуді тексеріңіз. Құпиясөздер мен қауіпті әрекеттерді растау қалпына келтірілмейді." },
  ],
  privacyTitle: "Деректер және құпиялылық", privacyIntro: "Жұмыста қолданылатын деректер және оларға қолжетімділікті басқару.",
  privacySections: [
    { title: "Аккаунт деректері", text: "Tirlik атыңызды, пошта мекенжайын, таңдаған тілді, сеанс мәліметтерін және команда мүшелігін сақтайды. Құпиясөз кіру үшін қолданылады және криптографиялық хеш түрінде сақталады." },
    { title: "Жұмыс материалдарына қолжетімділік", text: "Қолжетімділік кеңістік мүшелігі мен тағайындалған рұқсаттарға байланысты. Басты бет жеке материалдарды ашпайды. Аккаунттан шығу ағымдағы сеансты аяқтайды." },
    { title: "Аккаунт хаттары", text: "Пошта кіруді қалпына келтіру және команда шақырулары үшін қолданылады. Қалпына келтіру немесе шақыру сілтемелерін басқа адамға бермеңіз." },
    { title: "ЖИ және сыртқы сервистер", text: "Міндетті орындау үшін таңдалған материалдар сыртқы ЖИ провайдеріне берілуі мүмкін. Пайдалануға және өңдеуге беруге рұқсатыңыз бар деректерді ғана қосыңыз." },
    { title: "Аккаунтты басқару", text: "Баптауларда құпиясөзді өзгерту, сеанстарды аяқтау және аккаунтты жою бар. Кеңістік иесі алдымен иелікті беру немесе тиісті деректерді жою туралы шешім қабылдайды. Салдары растаудан бұрын көрсетіледі." },
    { title: "Бірлескен жұмыс", text: "Жұмыс материалдарын қоспас бұрын команда құрамын және қатысушылар рұқсаттарын тексеріңіз. Кеңістік иесі шақыруларды, рөлдерді және әріптестер қолжетімділігін басқарады." },
  ],
};

export const publicCopy: Record<Locale, PublicCopy> = { ru, kk, en };
