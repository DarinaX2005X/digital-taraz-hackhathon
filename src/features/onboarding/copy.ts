import type { Locale } from '@/i18n';
import { TOUR_STEPS, type TourStep } from './contracts';

type StepCopy = { title: string; body: string };
type Copy = {
  title: string; intro: string; start: string; next: string; back: string; close: string; skip: string;
  resume: string; replay: string; settings: string; error: string; retry: string; saved: string;
  optional: string; openWork: string; stepLabel: (step: TourStep) => string;
  steps: Record<TourStep, StepCopy>;
};

export const tourCopy: Record<Locale, Copy> = {
  ru: {
    title: 'Первый результат в Tirlik', intro: 'Подсказка сразу покажет нужное место. Обучение продолжится по мере появления вашей работы, ничего не создавая и не запуская за вас.',
    start: 'Начать', next: 'Дальше', back: 'Назад', close: 'Продолжить позже', skip: 'Пропустить обучение',
    resume: 'Продолжить с моего шага', replay: 'Пройти сначала', settings: 'Обучение', error: 'Не удалось сохранить шаг. Работа не изменилась.', retry: 'Повторить',
    saved: 'Текущий шаг сохранён в аккаунте.', optional: 'Короткое обучение, по желанию', openWork: 'Открыть работу',
    stepLabel: (step) => `Шаг ${TOUR_STEPS.indexOf(step) + 1} из ${TOUR_STEPS.length}`,
    steps: {
      start: { title: 'Сформулируйте результат', body: 'Опишите деловую задачу своими словами и добавьте нужные файлы. После запуска обучение продолжится внутри созданной работы.' },
      task: { title: 'Следите за выполнением', body: 'В сессии видны план, текущая операция, существенный вопрос и уже готовые части результата.' },
      materials: { title: 'Проверяйте основания', body: 'Источники и факты остаются рядом с решением. Неизвестное не превращается в выдуманное значение.' },
      edit: { title: 'Откройте полезный результат', body: 'Готовую смету, предложение или план можно открыть и исправить напрямую.' },
      history: { title: 'Сравнивайте версии', body: 'История сохраняет прежние состояния и позволяет вернуть выбранное как новую версию.' },
      export: { title: 'Используйте готовую работу', body: 'Экспорт берёт выбранную сохранённую версию. Перед выгрузкой проверьте текст, расчёты и состав файлов.' },
    },
  },
  en: {
    title: 'Your first result in Tirlik', intro: 'Each tip immediately reveals the right control. The tour continues as your work becomes available, without creating or running anything for you.',
    start: 'Start', next: 'Next', back: 'Back', close: 'Continue later', skip: 'Skip the tour',
    resume: 'Continue from my step', replay: 'Start again', settings: 'Getting started', error: 'Could not save this step. Your work was not changed.', retry: 'Retry',
    saved: 'Your current step is saved to the account.', optional: 'Optional brief tour', openWork: 'Open Work',
    stepLabel: (step) => `Step ${TOUR_STEPS.indexOf(step) + 1} of ${TOUR_STEPS.length}`,
    steps: {
      start: { title: 'Describe the result', body: 'State the business task in your own words and add the files you need. After you start, the tour continues inside the created work.' },
      task: { title: 'Follow the execution', body: 'The session shows the plan, current operation, material question and any useful parts already ready.' },
      materials: { title: 'Check the evidence', body: 'Sources and facts stay beside the decision. An unknown value is never replaced with an invented one.' },
      edit: { title: 'Open the useful result', body: 'Open the resulting estimate, proposal or plan and edit it directly.' },
      history: { title: 'Compare versions', body: 'History preserves earlier states and restores a chosen state as a new version.' },
      export: { title: 'Use the finished work', body: 'Export uses the selected saved version. Review wording, calculations and included files first.' },
    },
  },
  kk: {
    title: 'Tirlik-тегі алғашқы нәтиже', intro: 'Әр кеңес қажетті орынды бірден көрсетеді. Нұсқаулық жұмысыңыз пайда болған сайын жалғасады және сіздің орныңызға ештеңе құрмайды не іске қоспайды.',
    start: 'Бастау', next: 'Әрі қарай', back: 'Артқа', close: 'Кейін жалғастыру', skip: 'Оқытуды өткізіп жіберу',
    resume: 'Өз қадамымнан жалғастыру', replay: 'Басынан бастау', settings: 'Бастау нұсқаулығы', error: 'Қадамды сақтау мүмкін болмады. Жұмыс өзгерген жоқ.', retry: 'Қайталау',
    saved: 'Ағымдағы қадам аккаунтта сақталды.', optional: 'Қысқа нұсқаулық, міндетті емес', openWork: 'Жұмысты ашу',
    stepLabel: (step) => `${TOUR_STEPS.length} қадамның ${TOUR_STEPS.indexOf(step) + 1}-қадамы`,
    steps: {
      start: { title: 'Нәтижені сипаттаңыз', body: 'Бизнес міндетін өз сөзіңізбен жазыңыз және керекті файлдарды қосыңыз. Іске қосылғаннан кейін нұсқаулық жасалған жұмыс ішінде жалғасады.' },
      task: { title: 'Орындалуын бақылаңыз', body: 'Сессияда жоспар, ағымдағы әрекет, маңызды сұрақ және дайын пайдалы бөліктер көрінеді.' },
      materials: { title: 'Негіздерді тексеріңіз', body: 'Дереккөздер мен фактілер шешімнің жанында қалады. Белгісіз мән ойдан шығарылмайды.' },
      edit: { title: 'Пайдалы нәтижені ашыңыз', body: 'Дайын сметаны, ұсынысты немесе жоспарды ашып, тікелей өңдеңіз.' },
      history: { title: 'Нұсқаларды салыстырыңыз', body: 'Тарих бұрынғы күйлерді сақтайды және таңдалған күйді жаңа нұсқа ретінде қайтарады.' },
      export: { title: 'Дайын жұмысты қолданыңыз', body: 'Экспорт таңдалған сақталған нұсқаны алады. Алдымен мәтінді, есепті және файлдар құрамын тексеріңіз.' },
    },
  },
};
