import type { Locale } from '@/i18n';
import type { TourStep } from './contracts';

type Copy = { title: string; intro: string; start: string; show: string; next: string; skip: string; resume: string; replay: string; settings: string; error: string; retry: string; saved: string; continue: string; finish: string; steps: Record<TourStep, { title: string; body: string }> };
export const tourCopy: Record<Locale, Copy> = {
  ru: { title: 'Знакомство с Tirlik', intro: 'Короткие подсказки рядом с вашей работой. Их можно пропустить и открыть снова в настройках.', start: 'Показать, с чего начать', show: 'Показать на странице', next: 'Понятно, дальше', skip: 'Пропустить подсказки', resume: 'Продолжить знакомство', replay: 'Пройти сначала', settings: 'Обучение', error: 'Не удалось сохранить подсказки. Работа в проекте продолжается.', retry: 'Повторить', saved: 'Прогресс знакомства сохранён в вашем аккаунте.', continue: 'Следующие подсказки появятся, когда вы откроете проект или результат.', finish: 'Завершить знакомство', steps: {
    start: { title: 'Начните со своей задачи', body: 'Опишите, что нужно получить. Название проекта можно оставить предложенным и изменить позже.' },
    task: { title: 'Задача управляет результатом', body: 'Укажите, для кого готовите работу и что важно учесть. Кнопка «Подготовить результат» запускает вашу задачу.' },
    materials: { title: 'Добавьте свои материалы', body: 'Прайс, запрос клиента и другие файлы останутся рядом с результатом. Перед запуском выберите нужные исходники.' },
    edit: { title: 'Правьте сам результат', body: 'Меняйте текст, числа или объекты прямо в редакторе. Состояние сохранения видно рядом с названием.' },
    history: { title: 'Проверяйте версии', body: 'Здесь можно сравнить изменения, восстановить черновик и вернуться к выбранному состоянию.' },
    export: { title: 'Используйте готовую работу', body: 'Экспорт сохраняет текущую версию в файл. Сначала проверьте текст, расчёты и оформление.' },
  } },
  en: { title: 'Getting to know Tirlik', intro: 'Brief guidance beside your work. Skip it now and reopen it in settings at any time.', start: 'Show me where to start', show: 'Show on the page', next: 'Got it, next', skip: 'Skip guidance', resume: 'Continue the tour', replay: 'Start again', settings: 'Getting started', error: 'Could not save tour progress. You can keep working in your project.', retry: 'Retry', saved: 'Tour progress is saved in your account.', continue: 'More guidance appears when you open a project or a result.', finish: 'Finish the tour', steps: {
    start: { title: 'Start with your own task', body: 'Describe the result you need. Keep the suggested project name and change it later if needed.' },
    task: { title: 'Your task guides the result', body: 'Explain who the work is for and which requirements matter. Prepare the result starts your task.' },
    materials: { title: 'Add your materials', body: 'Your price list, client request and other files stay beside the result. Choose the sources to use before starting.' },
    edit: { title: 'Edit the actual result', body: 'Change text, numbers or objects directly in the editor. Save status appears beside the title.' },
    history: { title: 'Review versions', body: 'Compare changes, recover a draft and return to a chosen state here.' },
    export: { title: 'Use the finished work', body: 'Export saves the current version to a file. Check the wording, calculations and design first.' },
  } },
  kk: { title: 'Tirlik-пен танысу', intro: 'Жұмысыңыздың жанындағы қысқа кеңестер. Оларды өткізіп жіберіп, баптаулардан қайта ашуға болады.', start: 'Неден бастау керегін көрсету', show: 'Беттен көрсету', next: 'Түсінікті, әрі қарай', skip: 'Кеңестерді өткізу', resume: 'Танысуды жалғастыру', replay: 'Басынан бастау', settings: 'Бастау нұсқаулығы', error: 'Танысу барысын сақтау мүмкін болмады. Жобадағы жұмысты жалғастыра аласыз.', retry: 'Қайталау', saved: 'Танысу барысы аккаунтыңызда сақталды.', continue: 'Келесі кеңестер жобаны немесе нәтижені ашқанда пайда болады.', finish: 'Танысуды аяқтау', steps: {
    start: { title: 'Өз тапсырмаңыздан бастаңыз', body: 'Қажетті нәтижені сипаттаңыз. Ұсынылған жоба атауын қалдырып, кейін өзгертуге болады.' },
    task: { title: 'Тапсырма нәтижені бағыттайды', body: 'Жұмыстың кімге арналғанын және қандай талаптар маңызды екенін жазыңыз. «Нәтиже дайындау» тапсырмаңызды іске қосады.' },
    materials: { title: 'Өз материалдарыңызды қосыңыз', body: 'Бағалар тізімі, клиент сұрауы мен басқа файлдар нәтиженің жанында қалады. Бастамас бұрын қажетті материалдарды таңдаңыз.' },
    edit: { title: 'Нәтиженің өзін өңдеңіз', body: 'Мәтінді, сандарды немесе нысандарды тікелей редакторда өзгертіңіз. Сақталу күйі атаудың жанында көрсетіледі.' },
    history: { title: 'Нұсқаларды тексеріңіз', body: 'Мұнда өзгерістерді салыстыруға, нобайды қалпына келтіруге және таңдалған күйге оралуға болады.' },
    export: { title: 'Дайын жұмысты пайдаланыңыз', body: 'Экспорт ағымдағы нұсқаны файлға сақтайды. Алдымен мәтінді, есептеулерді және безендіруді тексеріңіз.' },
  } },
};
