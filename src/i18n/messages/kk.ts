import type { ru } from "./ru";
import type { MessageShape } from "./types";

export const kk = {
  common: {
    brand: { name: "Tirlik", tagline: "Бизнесіңізге қажеттінің бәрі" },
    navigation: { work: "Жұмыс", materials: "Материалдар", business: "Бизнес", settings: "Баптаулар", help: "Көмек", profile: "Профиль", language: "Тіл", back: "Артқа", home: "Басты бетке", skipToContent: "Мазмұнға өту" },
    actions: { create: "Жасау", newTask: "Жаңа тапсырма", open: "Ашу", edit: "Өңдеу", save: "Сақтау", cancel: "Бас тарту", close: "Жабу", confirm: "Растау", retry: "Қайталау", remove: "Жою", archive: "Мұрағатқа", restore: "Қалпына келтіру", search: "Іздеу", clear: "Тазарту", choose: "Таңдау", download: "Жүктеп алу", upload: "Жүктеу", export: "Экспорт", undo: "Әрекетті болдырмау", redo: "Әрекетті қайталау", versions: "Нұсқалар", duplicate: "Көшірмесін жасау", more: "Басқа әрекеттер", signIn: "Кіру", signOut: "Шығу", continue: "Жалғастыру" },
    fields: { required: "Міндетті өріс", optional: "Міндетті емес", invalid: "Мәнді тексеріңіз", chooseOption: "Тізімнен нұсқаны таңдаңыз", noMatches: "Ештеңе табылмады", noOptions: "Қолжетімді нұсқалар жоқ", searching: "Іздеу", unit: "Өлшем бірлігі" },
    state: { loading: "Жүктелуде", pending: "Орындалуда", empty: "Әзірге ештеңе жоқ", partial: "Ішінара дайын", interrupted: "Жұмыс үзілді", saved: "Сақталды", saving: "Сақталуда", unsaved: "Сақталмады", savedLocally: "Осы браузерде сақталды", offline: "Байланыс жоқ", conflict: "Өзгерістердің басқа нұсқасы бар" },
    dialog: { unsavedTitle: "Сақталмаған өзгерістер бар", unsavedDescription: "Қазір жапсаңыз, сақталмаған өзгерістер жоғалады.", keepEditing: "Өңдеуді жалғастыру", discard: "Сақтамай жабу" },
    errors: { unauthenticated: "Жалғастыру үшін кіріңіз.", forbidden: "Бұл әрекетке құқығыңыз жеткіліксіз.", notFound: "Материал табылмады немесе қолжетімсіз.", conflict: "Материал өзгерді. Сақтамас бұрын нұсқаларды салыстырыңыз.", payloadTooLarge: "Файл тым үлкен. Көлемі кішірек файлды таңдаңыз.", validationFailed: "Белгіленген өрістерді тексеріңіз.", rateLimited: "Сұрау тым көп. Сәл кейінірек қайталаңыз.", providerFailed: "AI жұмысын аяқтау мүмкін болмады. Қайталап көріңіз.", unavailable: "Сервис уақытша қолжетімсіз. Қайталап көріңіз.", unexpected: "Әрекетті орындау мүмкін болмады. Қайталап көріңіз.", saveFailed: "Өзгерістерді сақтау мүмкін болмады.", loadFailed: "Деректерді жүктеу мүмкін болмады." },
    locale: { sessionOnly: "Тіл осы кіру кезінде ғана өзгертілді.", preferenceFailed: "Тілді профильде сақтау мүмкін болмады.", savingPreference: "Тіл сақталуда", savedPreference: "Тіл сақталды" },
    time: { timeZone: "Уақыт белдеуі", date: "Күн", time: "Уақыт" },
    feedback: { notifications: "Хабарламалар" },
  },
} as const satisfies MessageShape<typeof ru>;
