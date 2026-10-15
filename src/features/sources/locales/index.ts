import type { Locale } from '@/i18n';

const ru = {
  map: 'Сопоставить',
  add: 'Добавить материал', back: 'В проект', file: 'Файл', paste: 'Текст', title: 'Название', text: 'Текст материала', choose: 'Выбрать файл', drop: 'Перетащите файл сюда', formats: 'CSV, TSV, XLSX, DOCX, PDF, PNG, JPEG, WebP, TXT. До 20 МБ.',
  addAction: 'Сохранить материал', uploading: 'Загружаем оригинал', processing: 'Читаем содержимое', preparing: 'Подготавливаем загрузку', cancel: 'Отменить', retry: 'Повторить', replace: 'Новая версия', original: 'Скачать оригинал', preview: 'Содержимое', versions: 'Версии', project: 'Проект', chooseProject: 'Выберите проект', noProject: 'Сначала создайте проект', work: 'Моя работа',
  encoding: 'Кодировка', delimiter: 'Разделитель', automatic: 'Определить автоматически', comma: 'Запятая', semicolon: 'Точка с запятой', tab: 'Табуляция', options: 'Параметры таблицы', confidential: 'Ограничить доступ к чувствительным данным', confidentialHint: 'Материал увидят участники с доступом к конфиденциальным данным проекта.',
  ready: 'Готово', pending: 'Ожидает загрузки', uploaded: 'Оригинал сохранён', partial: 'Нужна проверка', failed: 'Не обработан', cancelled: 'Отменён',
  loading: 'Открываем материал', rows: 'Строки', fragments: 'Фрагменты', pages: 'Страницы', previous: 'Предыдущая часть', next: 'Следующая часть', part: 'Часть', of: 'из', row: 'Строка', page: 'Страница', sheet: 'Лист', column: 'Колонка', raw: 'Исходное значение',
  empty: 'В файле нет доступного текста', noPreview: 'Содержимое ещё не прочитано', vision: 'На этих страницах нет текстового слоя. Для чтения текста требуется распознавание.', recognize: 'Распознать текст', review: 'Проверьте распознанные числа по оригиналу.',
  error: 'Не удалось выполнить действие. Введённые данные сохранены. Попробуйте ещё раз.', tooLarge: 'Файл превышает 20 МБ. Разделите его на несколько файлов.', unsupported: 'Выберите файл в одном из указанных форматов.', required: 'Добавьте файл или текст и укажите название.', encodingError: 'Не удалось прочитать текст. Проверьте выбранную кодировку.', formatError: 'Содержимое файла не соответствует выбранному формату.', archiveError: 'В документе есть небезопасные или неподдерживаемые вложения. Сохраните обычную копию XLSX или DOCX без макросов и внешних связей.',
  limit: 'Файл превышает допустимый объём: CSV до 100 000 строк, XLSX до 20 000 строк на лист, 100 колонок, PDF до 100 страниц, фото до 20 Мп.', conflict: 'Материал изменился или обработка уже началась. Откройте сохранённое состояние и повторите действие.', unavailable: 'Материал не найден или доступ к нему изменился.', session: 'Войдите, чтобы продолжить с этим материалом.', missing: 'Не удалось открыть проект. Вернитесь к списку своей работы.',
  uneven: 'В строках разное число колонок. Все исходные значения сохранены.', formulas: 'Формулы сохранены как текст вместе с исходными значениями. Они не вычислялись.', rawValues: 'Числа и даты сохранены в исходной записи. Проверьте формат перед расчётом.', documentText: 'Из документа извлечён текст. Оформление и изображения остаются в оригинале.', emptyContent: 'В исходнике не найден текст.',
  readOnly: 'Доступ только для просмотра', saved: 'Материал сохранён в проекте', open: 'Открыть материал', fileSize: 'Размер файла', created: 'Добавлен', extracted: 'Прочитано', newVersion: 'Загрузить новую версию', createDocument: 'Создать документ', createTable: 'Открыть как таблицу', creating: 'Создаём материал', materialized: 'Открыть результат',
};
type Copy = { [K in keyof typeof ru]: string };
const kk: Copy = {
  map: 'Сәйкестендіру',
  add: 'Материал қосу', back: 'Жобаға', file: 'Файл', paste: 'Мәтін', title: 'Атауы', text: 'Материал мәтіні', choose: 'Файл таңдау', drop: 'Файлды осында сүйреңіз', formats: 'CSV, TSV, XLSX, DOCX, PDF, PNG, JPEG, WebP, TXT. 20 МБ дейін.',
  addAction: 'Материалды сақтау', uploading: 'Түпнұсқа жүктелуде', processing: 'Мазмұны оқылуда', preparing: 'Жүктеу дайындалуда', cancel: 'Бас тарту', retry: 'Қайталау', replace: 'Жаңа нұсқа', original: 'Түпнұсқаны жүктеп алу', preview: 'Мазмұны', versions: 'Нұсқалар', project: 'Жоба', chooseProject: 'Жобаны таңдаңыз', noProject: 'Алдымен жоба құрыңыз', work: 'Менің жұмысым',
  encoding: 'Кодтау', delimiter: 'Бөлгіш', automatic: 'Автоматты анықтау', comma: 'Үтір', semicolon: 'Нүктелі үтір', tab: 'Табуляция', options: 'Кесте параметрлері', confidential: 'Құпия деректерге қолжетімділікті шектеу', confidentialHint: 'Материалды жобаның құпия деректеріне рұқсаты бар қатысушылар көреді.',
  ready: 'Дайын', pending: 'Жүктеу күтілуде', uploaded: 'Түпнұсқа сақталды', partial: 'Тексеру қажет', failed: 'Өңделмеді', cancelled: 'Бас тартылды',
  loading: 'Материал ашылуда', rows: 'Жолдар', fragments: 'Үзінділер', pages: 'Беттер', previous: 'Алдыңғы бөлік', next: 'Келесі бөлік', part: 'Бөлік', of: '/', row: 'Жол', page: 'Бет', sheet: 'Парақ', column: 'Баған', raw: 'Бастапқы мән',
  empty: 'Файлда қолжетімді мәтін жоқ', noPreview: 'Мазмұны әлі оқылмады', vision: 'Бұл беттерде мәтін қабаты жоқ. Мәтінді оқу үшін тану қажет.', recognize: 'Мәтінді тану', review: 'Танылған сандарды түпнұсқамен салыстырыңыз.',
  error: 'Әрекет орындалмады. Енгізілген деректер сақталды. Қайта көріңіз.', tooLarge: 'Файл 20 МБ-тан асады. Оны бірнеше файлға бөліңіз.', unsupported: 'Көрсетілген пішімдердің біріндегі файлды таңдаңыз.', required: 'Файл не мәтін қосып, атауын енгізіңіз.', encodingError: 'Мәтін оқылмады. Таңдалған кодтауды тексеріңіз.', formatError: 'Файл мазмұны таңдалған пішімге сәйкес емес.', archiveError: 'Құжатта қауіпті немесе қолдау көрсетілмейтін тіркемелер бар. Макростарсыз және сыртқы байланыстарсыз кәдімгі XLSX не DOCX көшірмесін сақтаңыз.',
  limit: 'Файл шектен асады: CSV 100 000 жолға дейін, XLSX бір парақта 20 000 жолға дейін, 100 баған, PDF 100 бетке дейін, сурет 20 Мп дейін.', conflict: 'Материал өзгерді немесе өңдеу басталды. Сақталған күйін ашып, әрекетті қайталаңыз.', unavailable: 'Материал табылмады немесе оған қолжетімділік өзгерді.', session: 'Материалмен жұмысты жалғастыру үшін кіріңіз.', missing: 'Жоба ашылмады. Жұмыстар тізіміне оралыңыз.',
  uneven: 'Жолдардағы баған саны әртүрлі. Барлық бастапқы мән сақталды.', formulas: 'Формулалар бастапқы мәндермен бірге мәтін ретінде сақталды. Олар есептелмеді.', rawValues: 'Сандар мен күндер бастапқы жазбада сақталды. Есептемес бұрын пішімін тексеріңіз.', documentText: 'Құжаттан мәтін алынды. Безендіру мен суреттер түпнұсқада қалды.', emptyContent: 'Түпнұсқадан мәтін табылмады.',
  readOnly: 'Тек көру рұқсаты', saved: 'Материал жобаға сақталды', open: 'Материалды ашу', fileSize: 'Файл өлшемі', created: 'Қосылды', extracted: 'Оқылды', newVersion: 'Жаңа нұсқа жүктеу', createDocument: 'Құжат жасау', createTable: 'Кесте ретінде ашу', creating: 'Материал жасалуда', materialized: 'Нәтижені ашу',
};
const en: Copy = {
  map: 'Map fields',
  add: 'Add material', back: 'Back to project', file: 'File', paste: 'Text', title: 'Title', text: 'Material text', choose: 'Choose file', drop: 'Drop a file here', formats: 'CSV, TSV, XLSX, DOCX, PDF, PNG, JPEG, WebP, TXT. Up to 20 MB.',
  addAction: 'Save material', uploading: 'Uploading original', processing: 'Reading content', preparing: 'Preparing upload', cancel: 'Cancel', retry: 'Retry', replace: 'New version', original: 'Download original', preview: 'Content', versions: 'Versions', project: 'Project', chooseProject: 'Choose a project', noProject: 'Create a project first', work: 'My work',
  encoding: 'Encoding', delimiter: 'Delimiter', automatic: 'Detect automatically', comma: 'Comma', semicolon: 'Semicolon', tab: 'Tab', options: 'Table options', confidential: 'Restrict access to sensitive data', confidentialHint: 'Only project members with access to confidential data can view this material.',
  ready: 'Ready', pending: 'Awaiting upload', uploaded: 'Original saved', partial: 'Review needed', failed: 'Not processed', cancelled: 'Cancelled',
  loading: 'Opening material', rows: 'Rows', fragments: 'Fragments', pages: 'Pages', previous: 'Previous part', next: 'Next part', part: 'Part', of: 'of', row: 'Row', page: 'Page', sheet: 'Sheet', column: 'Column', raw: 'Original value',
  empty: 'No readable text in this file', noPreview: 'Content has not been read yet', vision: 'These pages have no text layer. Text recognition is needed to read them.', recognize: 'Recognize text', review: 'Check recognized numbers against the original.',
  error: 'The action could not be completed. Your input is preserved. Try again.', tooLarge: 'The file exceeds 20 MB. Split it into smaller files.', unsupported: 'Choose one of the supported file formats.', required: 'Add a file or text and enter a title.', encodingError: 'Text could not be read. Check the selected encoding.', formatError: 'File content does not match its selected format.', archiveError: 'The document contains unsafe or unsupported attachments. Save a standard XLSX or DOCX copy without macros or external references.',
  limit: 'File limits: CSV 100,000 rows, XLSX 20,000 rows per sheet, 100 columns, PDF 100 pages, image 20 MP.', conflict: 'The material changed or processing has started. Open the saved state and try again.', unavailable: 'This material was not found or your access changed.', session: 'Sign in to continue with this material.', missing: 'The project could not be opened. Return to your work.',
  uneven: 'Rows have different column counts. All original values are preserved.', formulas: 'Formulas are stored as text with their original values. They have not been calculated.', rawValues: 'Numbers and dates keep their original notation. Check their format before calculating.', documentText: 'Text was extracted from the document. Formatting and images remain in the original.', emptyContent: 'No text was found in the original.',
  readOnly: 'View-only access', saved: 'Material saved to project', open: 'Open material', fileSize: 'File size', created: 'Added', extracted: 'Read', newVersion: 'Upload new version', createDocument: 'Create document', createTable: 'Open as table', creating: 'Creating material', materialized: 'Open result',
};
export const sourceCopies: Record<Locale, Copy> = { ru, kk, en };
export type SourceCopy = Copy;
export function sourceError(copy: Copy, error: unknown) {
  const key = error && typeof error === 'object' && 'messageKey' in error ? String(error.messageKey).split('.').at(-1) : '';
  if (key === 'tooLarge') return copy.tooLarge;
  if (key === 'encoding') return copy.encodingError;
  if (key === 'format' || key === 'pdf' || key === 'csv' || key === 'image') return copy.formatError;
  if (key === 'archive') return copy.archiveError;
  if (['rowLimit', 'columnLimit', 'pageLimit'].includes(key ?? '')) return copy.limit;
  if (['conflict', 'processing', 'uploadExpired'].includes(key ?? '')) return copy.conflict;
  if (['notFound', 'forbidden'].includes(key ?? '')) return copy.unavailable;
  if (key === 'unauthenticated') return copy.session;
  return copy.error;
}
