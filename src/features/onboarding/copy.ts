import type { Locale } from '@/i18n';
import { TOUR_STEPS, type TourStep } from './contracts';

type StepCopy = { title: string; body: string; unavailable: string };
type Copy = {
  title: string; intro: string; start: string; show: string; next: string; back: string; close: string; skip: string;
  resume: string; replay: string; settings: string; error: string; retry: string; saved: string;
  optional: string; skipStep: string; openWork: string; stepLabel: (step: TourStep) => string;
  steps: Record<TourStep, StepCopy>;
};

export const tourCopy: Record<Locale, Copy> = {
  ru: {
    title: 'Первый результат в Tirlik', intro: 'Шесть коротких подсказок на той странице, где вы уже работаете. Тур не переводит вас в другой раздел и не запускает действия сам.',
    start: 'Начать', show: 'Показать здесь', next: 'Дальше', back: 'Назад', close: 'Продолжить позже', skip: 'Пропустить обучение',
    resume: 'Продолжить с моего шага', replay: 'Пройти сначала', settings: 'Обучение', error: 'Не удалось сохранить шаг. Работа не изменилась.', retry: 'Повторить',
    saved: 'Текущий шаг сохранён в аккаунте.', optional: 'Короткое обучение, по желанию', skipStep: 'Пропустить отсутствующий шаг', openWork: 'Открыть работу',
    stepLabel: (step) => `Шаг ${TOUR_STEPS.indexOf(step) + 1} из ${TOUR_STEPS.length}`,
    steps: {
      start: { title: 'Сформулируйте результат', body: 'Опишите деловую задачу своими словами и добавьте файлы, которые нужны для решения.', unavailable: 'Поле задачи есть в разделе «Работа». Этот шаг можно пропустить и продолжить без перехода.' },
      task: { title: 'Следите за выполнением', body: 'В сессии видны план, текущая операция, существенный вопрос и уже готовые части результата.', unavailable: 'Выполнение появится после запуска задачи. Тур останется на текущей странице.' },
      materials: { title: 'Проверяйте основания', body: 'Источники и факты остаются рядом с решением. Неизвестное не превращается в выдуманное значение.', unavailable: 'Контекст источников появится в проекте, когда задача использует материалы.' },
      edit: { title: 'Откройте полезный результат', body: 'Готовую смету, предложение или план можно открыть и исправить напрямую.', unavailable: 'Результат ещё не создан или не открыт. Тур не переносит вас к нему автоматически.' },
      history: { title: 'Сравнивайте версии', body: 'История сохраняет прежние состояния и позволяет вернуть выбранное как новую версию.', unavailable: 'История доступна внутри открытого сохранённого результата.' },
      export: { title: 'Используйте готовую работу', body: 'Экспорт берёт выбранную сохранённую версию. Перед выгрузкой проверьте текст, расчёты и состав файлов.', unavailable: 'Экспорт доступен внутри готового результата. Отсутствующий шаг можно пропустить.' },
    },
  },
  en: {
    title: 'Your first result in Tirlik', intro: 'Six brief tips on the page where you are already working. The tour never moves you to another section or starts an action on its own.',
    start: 'Start', show: 'Show here', next: 'Next', back: 'Back', close: 'Continue later', skip: 'Skip the tour',
    resume: 'Continue from my step', replay: 'Start again', settings: 'Getting started', error: 'Could not save this step. Your work was not changed.', retry: 'Retry',
    saved: 'Your current step is saved to the account.', optional: 'Optional brief tour', skipStep: 'Skip unavailable step', openWork: 'Open Work',
    stepLabel: (step) => `Step ${TOUR_STEPS.indexOf(step) + 1} of ${TOUR_STEPS.length}`,
    steps: {
      start: { title: 'Describe the result', body: 'State the business task in your own words and add the files needed for the decision.', unavailable: 'The task field is in Work. You can skip this step and continue without navigation.' },
      task: { title: 'Follow the execution', body: 'The session shows the plan, current operation, material question and any useful parts already ready.', unavailable: 'Execution appears after a task starts. The tour stays on the current page.' },
      materials: { title: 'Check the evidence', body: 'Sources and facts stay beside the decision. An unknown value is never replaced with an invented one.', unavailable: 'Source context appears in a project when the task uses materials.' },
      edit: { title: 'Open the useful result', body: 'Open the resulting estimate, proposal or plan and edit it directly.', unavailable: 'A result is not ready or open yet. The tour will not take you there automatically.' },
      history: { title: 'Compare versions', body: 'History preserves earlier states and restores a chosen state as a new version.', unavailable: 'History is available inside an open, saved result.' },
      export: { title: 'Use the finished work', body: 'Export uses the selected saved version. Review wording, calculations and included files first.', unavailable: 'Export is available inside a finished result. You can skip this unavailable step.' },
    },
  },
  kk: {
    title: 'Tirlik-тегі алғашқы нәтиже', intro: 'Сіз жұмыс істеп отырған беттегі алты қысқа кеңес. Тур басқа бөлімге өткізбейді және әрекетті өзі бастамайды.',
    start: 'Бастау', show: 'Осы жерден көрсету', next: 'Әрі қарай', back: 'Артқа', close: 'Кейін жалғастыру', skip: 'Оқытуды өткізіп жіберу',
    resume: 'Өз қадамымнан жалғастыру', replay: 'Басынан бастау', settings: 'Бастау нұсқаулығы', error: 'Қадамды сақтау мүмкін болмады. Жұмыс өзгерген жоқ.', retry: 'Қайталау',
    saved: 'Ағымдағы қадам аккаунтта сақталды.', optional: 'Қысқа нұсқаулық, міндетті емес', skipStep: 'Жоқ қадамды өткізіп жіберу', openWork: 'Жұмысты ашу',
    stepLabel: (step) => `${TOUR_STEPS.length} қадамның ${TOUR_STEPS.indexOf(step) + 1}-қадамы`,
    steps: {
      start: { title: 'Нәтижені сипаттаңыз', body: 'Бизнес міндетін өз сөзіңізбен жазыңыз және шешімге керек файлдарды қосыңыз.', unavailable: 'Тапсырма өрісі «Жұмыс» бөлімінде. Бұл қадамды өтіп, бет ауыстырмай жалғастыруға болады.' },
      task: { title: 'Орындалуын бақылаңыз', body: 'Сессияда жоспар, ағымдағы әрекет, маңызды сұрақ және дайын пайдалы бөліктер көрінеді.', unavailable: 'Орындалу тапсырма басталғаннан кейін көрінеді. Тур ағымдағы бетте қалады.' },
      materials: { title: 'Негіздерді тексеріңіз', body: 'Дереккөздер мен фактілер шешімнің жанында қалады. Белгісіз мән ойдан шығарылмайды.', unavailable: 'Дереккөз контексті материал қолданылған жоба ішінде көрінеді.' },
      edit: { title: 'Пайдалы нәтижені ашыңыз', body: 'Дайын сметаны, ұсынысты немесе жоспарды ашып, тікелей өңдеңіз.', unavailable: 'Нәтиже әлі дайын емес немесе ашылмаған. Тур оған автоматты түрде апармайды.' },
      history: { title: 'Нұсқаларды салыстырыңыз', body: 'Тарих бұрынғы күйлерді сақтайды және таңдалған күйді жаңа нұсқа ретінде қайтарады.', unavailable: 'Тарих ашық сақталған нәтиженің ішінде қолжетімді.' },
      export: { title: 'Дайын жұмысты қолданыңыз', body: 'Экспорт таңдалған сақталған нұсқаны алады. Алдымен мәтінді, есепті және файлдар құрамын тексеріңіз.', unavailable: 'Экспорт дайын нәтиженің ішінде қолжетімді. Жоқ қадамды өткізуге болады.' },
    },
  },
};
