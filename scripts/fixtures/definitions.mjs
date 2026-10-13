export const DEFAULT_SEED = 20261013;
export const SNAPSHOT_DATE = "2026-01-01";
export const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";
export const SYNTHETIC_NOTICE = "Учебные синтетические данные. Организации, операции, цены и условия вымышлены; это не сведения о реальном бизнесе и не обещание дохода.";
export const LOCALE_SAMPLE = "Тараз | Қазақстан | Ә Ғ Қ Ң Ө Ұ Ү Һ І | Учебный пример | Synthetic example";

const item = (sku, name, unit, price, cost, stock, historyBase) => ({
  sku, name, unit, price, cost, stock, historyBase,
});

export const BUSINESSES = [
  {
    id: "homegoods", sector: "retail", seedOffset: 101,
    name: "Учебный магазин товаров для дома",
    description: "Небольшой магазин готовит корпоративный набор, сравнивает пополнение и сверяет продажи с возвратами. Продажи остаются в собственных каналах магазина.",
    goal: "Подготовить предложение для оснащения переговорной, сравнить варианты комплектации и следующую закупку. Не менять ранее согласованные условия; проверить доставку и сроки.",
    brand: { displayName: "Дом: учебная коллекция", colors: ["#12665D", "#E86652", "#FFFFFF"], tone: "Спокойно, конкретно; без выдуманных скидок и отзывов.", photoId: "white-cup" },
    seasons: [78, 82, 110, 96, 99, 106, 101, 94, 108, 118, 133, 156],
    catalog: [
      item("000101", "Кружка керамическая белая, 300 мл", "piece", "2400.00", "1380.00", "38", 10),
      item("000102", "Банка стеклянная с крышкой, 1 л", "piece", "3600.00", "2250.00", "22", 8),
      item("000103", "Полотенце кухонное, 45 x 70 см", "piece", "1850.00", "980.00", "53", 14),
      item("000104", "Контейнер для хранения, 2 л", "piece", "2950.00", "1860.00", "31", 11),
      item("000105", "Поднос металлический, 30 см", "piece", "5800.00", "3650.00", "9", 4),
      item("000106", "Кружка керамическая белая, 450 мл", "piece", "3100.00", "1940.00", "17", 7),
      item("000107", "Подарочная коробка, малый размер", "piece", "680.00", "350.00", "42", 15),
      item("000108", "Лента упаковочная, отрез", "meter", "180.00", "75.00", "61.5", 22),
    ],
    supplierTarget: { sku: "000101", needed: "27", unit: "piece" },
    suppliers: [
      { id: "HG-A", name: "Учебный поставщик посуды А", sku: "000101", label: "Кружка 0,3 л белая", pack: "6", packUnit: "piece", price: "8200.00", minPacks: 1, delivery: "2500.00", leadDays: 4, validThrough: "2026-01-31" },
      { id: "HG-B", name: "Учебный поставщик посуды Б", sku: "000101", label: "Белая кружка 300 мл, коробка", pack: "4", packUnit: "piece", price: "5700.00", minPacks: 10, delivery: "1500.00", leadDays: 2, validThrough: "2026-01-20" },
      { id: "HG-C", name: "Учебный поставщик посуды В", sku: "000101", label: "Кружка белая", pack: "1", packUnit: "piece", price: "1280.00", minPacks: 1, delivery: null, leadDays: null, validThrough: "2026-01-10" },
      { id: "HG-A", name: "Учебный поставщик посуды А", sku: "000106", label: "Кружка 0,45 л белая", pack: "6", packUnit: "piece", price: "11200.00", minPacks: 1, delivery: "2500.00", leadDays: 4, validThrough: "2026-01-31" },
    ],
    quote: {
      id: "HG-Q-001", requestedDate: "2026-01-22", requiredDate: "2026-01-21", discountPercent: "5.00", delivery: "4500.00", taxStatus: "unconfirmed",
      request: "Оснастить переговорную на 24 места. Нужны белые кружки 300 мл, 18 банок и 12 полотенец. В письме доставка указана на 22 января, а открытие офиса на 21 января. Предложите комплект с упаковкой и вариант без неё. Адрес и контакт намеренно не заданы. Не включать кружку 450 мл как замену без согласования.",
      lines: [{ sku: "000101", quantity: "24" }, { sku: "000102", quantity: "18" }, { sku: "000103", quantity: "12" }],
      terms: ["Учебная скидка 5% согласована только для указанного состава.", "Срок подтверждается после проверки остатка и доставки.", "Хрупкие изделия упаковываются отдельно; упаковка пока не включена в расчёт.", "Фотография иллюстрирует категорию, а не точную модель SKU.", "Налоговый статус не задан: известная сумма не является окончательным счётом."],
      unknowns: ["deliveryAddress", "packagingChoice", "taxStatus", "deliveryDateConflict"],
    },
    workResources: [
      { id: "HG-PACK", label: "Учебный упаковщик", capacityHours: "6", availableDays: "MO,TU,WE,TH,FR", from: "09:00", to: "16:00", exceptionDate: "2026-01-20", exceptionHours: "3" },
      { id: "HG-DELIVERY", label: "Учебная доставка", capacityHours: "4", availableDays: "TU,TH,SA", from: "10:00", to: "14:00", exceptionDate: "2026-01-22", exceptionHours: "0" },
    ],
    tasks: [
      { id: "HG-T1", title: "Проверить комплектность и размеры", resourceId: "HG-PACK", effortHours: "2", durationHours: "2", dependsOn: "", dueDate: "2026-01-19" },
      { id: "HG-T2", title: "Упаковать и промаркировать комплект", resourceId: "HG-PACK", effortHours: "4", durationHours: "4", dependsOn: "HG-T1", dueDate: "2026-01-20" },
      { id: "HG-T3", title: "Передать в доставку после согласования даты", resourceId: "HG-DELIVERY", effortHours: "2", durationHours: "2", dependsOn: "HG-T2", dueDate: "2026-01-22" },
    ],
    bom: [],
  },
  {
    id: "services", sector: "service", seedOffset: 202,
    name: "Учебная сервисная компания",
    description: "Команда уборки готовит смету объекта, график бригад и расход материалов. Площадь, доступ к окнам и длительность работ требуют уточнения; сотрудники представлены ресурсами без личных данных.",
    goal: "Собрать смету и план уборки перед открытием небольшого помещения. Сопоставить подтверждённую площадь, окна и доступность бригад; отдельно перечислить работы, которые ещё нельзя оценить.",
    brand: { displayName: "Чисто: учебная служба", colors: ["#235C82", "#3D9165", "#FFFFFF"], tone: "Деловой, понятный; без обещания стерильности или гарантированного результата.", photoId: "microfiber-mop" },
    seasons: [87, 86, 128, 142, 112, 95, 92, 105, 130, 118, 106, 125],
    catalog: [
      item("010201", "Поддерживающая уборка помещения", "square_meter", "420.00", "245.00", "0", 120),
      item("010202", "Мойка окна изнутри, стандартная створка", "piece", "1800.00", "960.00", "0", 18),
      item("010203", "Дополнительная работа специалиста", "hour", "3900.00", "2300.00", "0", 12),
      item("010204", "Глубокая очистка пола", "square_meter", "780.00", "465.00", "0", 90),
      item("010205", "Чистка мягкого кресла", "piece", "5200.00", "2800.00", "0", 9),
      item("010206", "Концентрат для пола, учебный материал", "liter", "2100.00", "1260.00", "16.5", 0),
      item("010207", "Салфетка микрофибра, расходный материал", "piece", "680.00", "360.00", "72", 0),
      item("010208", "Насадка для швабры, 60 см", "piece", "3200.00", "1850.00", "12", 0),
    ],
    supplierTarget: { sku: "010206", needed: "18.5", unit: "liter" },
    suppliers: [
      { id: "SV-A", name: "Учебный поставщик расходников А", sku: "010206", label: "Концентрат, канистра 5 л", pack: "5", packUnit: "liter", price: "6400.00", minPacks: 1, delivery: "1800.00", leadDays: 3, validThrough: "2026-01-31" },
      { id: "SV-B", name: "Учебный поставщик расходников Б", sku: "010206", label: "Средство концентрированное, 1 л", pack: "1", packUnit: "liter", price: "1210.00", minPacks: 24, delivery: "0.00", leadDays: 7, validThrough: "2026-01-31" },
      { id: "SV-C", name: "Учебный поставщик расходников В", sku: "010206", label: "Средство для пола, канистра", pack: null, packUnit: "liter", price: "4900.00", minPacks: 2, delivery: null, leadDays: 2, validThrough: "2025-12-20" },
      { id: "SV-A", name: "Учебный поставщик расходников А", sku: "010207", label: "Салфетка, упаковка 10 шт.", pack: "10", packUnit: "piece", price: "3300.00", minPacks: 1, delivery: "1800.00", leadDays: 3, validThrough: "2026-01-31" },
    ],
    quote: {
      id: "SV-Q-001", requestedDate: "2026-01-17", requiredDate: "2026-01-16", discountPercent: "0.00", delivery: "3500.00", taxStatus: "unconfirmed",
      request: "Подготовить помещение перед открытием. В плане 180 м², в приложенном описании написано 210 м²; для расчёта использовать подтверждённые 180 м², разницу оставить вопросом. 12 окон изнутри и 8 дополнительных человеко-часов. Наружный доступ не согласован. Заказчик просит 17 января, но открытие 16 января. Не считать человеко-часы длительностью работы всей бригады.",
      lines: [{ sku: "010201", quantity: "180" }, { sku: "010202", quantity: "12" }, { sku: "010203", quantity: "8" }],
      terms: ["Смета использует подтверждённую площадь 180 м².", "Мойка снаружи и работы на высоте исключены до обследования и отдельного согласования.", "8 человеко-часов двух специалистов не равны 8 часам календарной длительности.", "Расход концентрата не равен объёму готового раствора; коэффициент разведения пока не задан.", "Налоговый статус и окончательная дата требуют подтверждения."],
      unknowns: ["areaConflict", "externalWindowAccess", "dilutionRatio", "taxStatus", "serviceDateConflict"],
    },
    workResources: [
      { id: "SV-CREW-A", label: "Учебная бригада А, 2 специалиста", capacityHours: "12", availableDays: "MO,TU,WE,TH,FR", from: "09:00", to: "16:00", exceptionDate: "2026-01-16", exceptionHours: "4" },
      { id: "SV-CREW-B", label: "Учебная бригада Б, 1 специалист", capacityHours: "6", availableDays: "TU,WE,TH,FR,SA", from: "10:00", to: "17:00", exceptionDate: "2026-01-17", exceptionHours: "0" },
    ],
    tasks: [
      { id: "SV-T1", title: "Подтвердить площадь и доступ", resourceId: "SV-CREW-A", effortHours: "2", durationHours: "1", dependsOn: "", dueDate: "2026-01-15" },
      { id: "SV-T2", title: "Уборка и окна изнутри", resourceId: "SV-CREW-A", effortHours: "12", durationHours: "6", dependsOn: "SV-T1", dueDate: "2026-01-16" },
      { id: "SV-T3", title: "Контроль качества и устранение замечаний", resourceId: "SV-CREW-B", effortHours: "2", durationHours: "2", dependsOn: "SV-T2", dueDate: "2026-01-17" },
    ],
    bom: [
      { productSku: "010201", materialSku: "010206", quantityPerUnit: "0.025", materialUnit: "liter", wastePercent: "0", note: "Явное учебное допущение расхода концентрата на м²; не инструкция по химической безопасности." },
      { productSku: "010201", materialSku: "010207", quantityPerUnit: "0.020", materialUnit: "piece", wastePercent: "0", note: "Учебный расход; многократное использование отдельно не моделируется." },
    ],
  },
  {
    id: "manufacturing", sector: "manufacturing", seedOffset: 303,
    name: "Учебная столярная мастерская",
    description: "Небольшая мастерская сравнивает партии материалов, считает изделия с отходами и сушкой, готовит предложение и загрузку. Фото показывает категорию, а не изготовленное компанией изделие.",
    goal: "Подготовить предложение на подарочную партию и ведомость материалов. Сравнить поставщиков по полной цене и сроку; оставить время на сушку и не менять уже утверждённые изделия.",
    brand: { displayName: "Форма: учебная мастерская", colors: ["#364C48", "#BA4262", "#FFFFFF"], tone: "Предметно и точно; размеры, состав и сроки важнее неподтверждённых свойств материала.", photoId: "wooden-board" },
    seasons: [76, 84, 98, 104, 108, 112, 118, 105, 111, 124, 145, 162],
    catalog: [
      item("020301", "Доска сервировочная, учебная модель 30 x 20 см", "piece", "7900.00", "4150.00", "14", 12),
      item("020302", "Поднос деревянный, учебная модель 40 x 25 см", "piece", "12500.00", "7350.00", "6", 7),
      item("020303", "Подготовка индивидуальной партии", "service", "6500.00", "3200.00", "0", 1),
      item("020304", "Полка настенная, учебная модель 60 см", "piece", "14800.00", "8600.00", "8", 6),
      item("020305", "Панель древесная, материал", "square_meter", "8600.00", "7200.00", "12.96", 0),
      item("020306", "Масло для обработки, материал", "liter", "11800.00", "8200.00", "3.25", 0),
      item("020307", "Заготовка упаковочная", "piece", "750.00", "420.00", "64", 0),
      item("020308", "Абразивный лист", "piece", "460.00", "240.00", "120", 0),
    ],
    supplierTarget: { sku: "020305", needed: "9.4", unit: "square_meter" },
    suppliers: [
      { id: "MF-A", name: "Учебный поставщик панелей А", sku: "020305", label: "Панель 2,88 м²", pack: "2.88", packUnit: "square_meter", price: "23500.00", minPacks: 4, delivery: "8000.00", leadDays: 5, validThrough: "2026-01-31" },
      { id: "MF-B", name: "Учебный поставщик панелей Б", sku: "020305", label: "Панель 1,44 м²", pack: "1.44", packUnit: "square_meter", price: "13000.00", minPacks: 8, delivery: "6000.00", leadDays: 2, validThrough: "2026-01-31" },
      { id: "MF-C", name: "Учебный поставщик панелей В", sku: "020305", label: "Древесный щит, м²", pack: "1", packUnit: "square_meter", price: "6900.00", minPacks: 10, delivery: null, leadDays: 4, validThrough: "2026-01-12" },
      { id: "MF-A", name: "Учебный поставщик панелей А", sku: "020306", label: "Масло, банка 0,75 л", pack: "0.75", packUnit: "liter", price: "6300.00", minPacks: 2, delivery: "8000.00", leadDays: 5, validThrough: "2026-01-31" },
    ],
    quote: {
      id: "MF-Q-001", requestedDate: "2026-01-24", requiredDate: "2026-01-23", discountPercent: "3.00", delivery: "8000.00", taxStatus: "unconfirmed",
      request: "Нужны 40 сервировочных досок и 20 подносов с единой упаковкой. В таблице отгрузка 24 января, в тексте вручение 23 января. Макет персонализации не приложен; не считать его утверждённым. Использовать базовые модели и отдельно оценить изменения. Время сушки 24 часа, это ожидание, а не 24 человеко-часа.",
      lines: [{ sku: "020301", quantity: "40" }, { sku: "020302", quantity: "20" }, { sku: "020303", quantity: "1" }],
      terms: ["Учебная скидка 3% применяется к указанной партии, включая подготовку.", "Персонализация возможна только после получения и проверки макета.", "Размеры и пригодность материала должны подтверждаться реальным производителем.", "Сушка: 24 календарных часа; трудозатраты учитываются отдельно.", "Налоговый статус, упаковка и дата отгрузки требуют подтверждения."],
      unknowns: ["personalizationArtwork", "packagingChoice", "taxStatus", "shippingDateConflict"],
    },
    workResources: [
      { id: "MF-CUT", label: "Учебный участок раскроя", capacityHours: "6", availableDays: "MO,TU,WE,TH,FR", from: "09:00", to: "16:00", exceptionDate: "2026-01-20", exceptionHours: "2" },
      { id: "MF-FINISH", label: "Учебный участок отделки", capacityHours: "6", availableDays: "MO,TU,WE,TH,FR", from: "09:00", to: "16:00", exceptionDate: "2026-01-22", exceptionHours: "4" },
    ],
    tasks: [
      { id: "MF-T1", title: "Раскрой и шлифование партии", resourceId: "MF-CUT", effortHours: "10", durationHours: "10", dependsOn: "", dueDate: "2026-01-20" },
      { id: "MF-T2", title: "Нанести покрытие", resourceId: "MF-FINISH", effortHours: "4", durationHours: "4", dependsOn: "MF-T1", dueDate: "2026-01-21" },
      { id: "MF-T3", title: "Сушка покрытия", resourceId: "", effortHours: "0", durationHours: "24", dependsOn: "MF-T2", dueDate: "2026-01-22" },
      { id: "MF-T4", title: "Контроль и упаковка", resourceId: "MF-FINISH", effortHours: "5", durationHours: "5", dependsOn: "MF-T3", dueDate: "2026-01-23" },
    ],
    bom: [
      { productSku: "020301", materialSku: "020305", quantityPerUnit: "0.06", materialUnit: "square_meter", wastePercent: "12", note: "Чистая площадь плюс явно заданный припуск на отходы." },
      { productSku: "020301", materialSku: "020306", quantityPerUnit: "0.018", materialUnit: "liter", wastePercent: "5", note: "Учебный расход покрытия; это не техническая инструкция." },
      { productSku: "020302", materialSku: "020305", quantityPerUnit: "0.10", materialUnit: "square_meter", wastePercent: "15", note: "Отходы отличаются от доски, нельзя применять общий коэффициент молча." },
      { productSku: "020302", materialSku: "020306", quantityPerUnit: "0.028", materialUnit: "liter", wastePercent: "5", note: "Расход указан на готовое изделие." },
      { productSku: "020301", materialSku: "020307", quantityPerUnit: "1", materialUnit: "piece", wastePercent: "0", note: "Упаковка при выборе этого варианта." },
      { productSku: "020302", materialSku: "020307", quantityPerUnit: "1", materialUnit: "piece", wastePercent: "0", note: "Размер упаковки требует отдельного подтверждения." },
    ],
  },
];

export const PHOTO_SOURCES = [
  {
    id: "white-cup", businessId: "homegoods", title: "White Ceramic Cup (28217866307).jpg", author: "Saif Selim",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/59/White_Ceramic_Cup_%2828217866307%29.jpg",
    page: "https://commons.wikimedia.org/wiki/File:White_Ceramic_Cup_(28217866307).jpg", pageRevision: 1096774163,
    license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sha1: "31141039c4c5805f44b0d183cb5cdb7d328eabfa", sourceBytes: 1095918,
    evidence: "Commons file description declares CC0; its Pexels source predates the 5 July 2018 licence change. Commons review by 0x0a on 2025-02-07 confirmed the stated licence.",
    alt: "Фотография белой керамической чашки. Учебная иллюстрация категории, не точная модель товара.",
  },
  {
    id: "microfiber-mop", businessId: "services", title: "Mop for wet use, looped microfiber, velcro back, 60 cm.jpg", author: "Bjornwireen",
    url: "https://upload.wikimedia.org/wikipedia/commons/f/f3/Mop_for_wet_use%2C_looped_microfiber%2C_velcro_back%2C_60_cm.jpg",
    page: "https://commons.wikimedia.org/wiki/File:Mop_for_wet_use,_looped_microfiber,_velcro_back,_60_cm.jpg", pageRevision: 1178028145,
    license: "LicenseRef-Public-Domain-Self", licenseUrl: "https://commons.wikimedia.org/wiki/Template:PD-self", sha1: "1fea93e84d58c56c06340d34528edc7653cb9884", sourceBytes: 263746,
    evidence: "Commons file description records uploader's worldwide public-domain release with unconditional permission fallback where dedication is not possible.",
    alt: "Фотография насадки для влажной уборки с мерной линейкой. Учебная иллюстрация инвентаря, не имущество компании.",
  },
  {
    id: "wooden-board", businessId: "manufacturing", title: "Wooden cutting board 2017.jpg", author: "Fructibus",
    url: "https://upload.wikimedia.org/wikipedia/commons/9/9e/Wooden_cutting_board_2017.jpg",
    page: "https://commons.wikimedia.org/wiki/File:Wooden_cutting_board_2017.jpg", pageRevision: 1132586525,
    license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sha1: "fc634df54d40962218d23ef83cd7a93d3d14fbfc", sourceBytes: 5137480,
    evidence: "Commons file description identifies own work by Fructibus and the CC0 1.0 dedication.",
    alt: "Фотография деревянной доски. Учебная иллюстрация категории, не изделие вымышленной мастерской.",
  },
];
