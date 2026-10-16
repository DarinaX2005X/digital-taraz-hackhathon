"""Tirlik product pitch: original physical SVG objects, no fictional application UI."""


def build_scenes(Scene, W, H):
    dark = '081D18'; ink = '17332E'; white = 'F3F6F4'; quiet = 'B7CFC4'
    teal = '086A60'; mint = '9BD6BE'; coral = 'D78670'; pale = 'DFEEE5'

    def mark(s, x, y, z=1, color=white):
        # The established Tirlik silhouette, reconstructed with editable primitives.
        s.rect(x, y, 118*z, 36*z, color, 9*z)
        s.rect(x+39*z, y+27*z, 36*z, 81*z, color, 9*z)
        s.rect(x+90*z, y+50*z, 28*z, 28*z, coral, 6*z)
        s.rect(x+53*z, y, 7*z, 36*z, dark)

    def folio(s, x, y, w, h, fill=pale, depth=14, folded=True):
        # Opaque front, a side with thickness, and a folded corner. No fake controls.
        s.poly([(x+12,y+h+8),(x+w+depth+24,y+h+8),(x+w+depth+52,y+h+30),(x+40,y+h+30)], '04100D')
        s.poly([(x+w,y),(x+w+depth,y+depth),(x+w+depth,y+h+depth),(x+w,y+h)], '557C6D')
        s.poly([(x,y+h),(x+w,y+h),(x+w+depth,y+h+depth),(x+depth,y+h+depth)], '78998A')
        if folded:
            cut = min(45,w*.12)
            s.poly([(x,y),(x+w-cut,y),(x+w,y+cut),(x+w,y+h),(x,y+h)], fill)
            s.poly([(x+w-cut,y),(x+w-cut,y+cut),(x+w,y+cut)], 'B1CABC')
        else:
            s.rect(x,y,w,h,fill,12)
        return x+28,y+28,w-56,h-56

    def sleeve(s,x,y,w,h):
        s.poly([(x,y),(x+w-36,y),(x+w,y+30),(x+w,y+h),(x,y+h)], '0B4035')
        s.poly([(x+w,y+30),(x+w+16,y+40),(x+w+16,y+h+12),(x+w,y+h)], '062D26')
        s.poly([(x,y+h),(x+w,y+h),(x+w+16,y+h+12),(x+16,y+h+12)], '05251F')
        s.poly([(x+4,y+4),(x+w-40,y+4),(x+w-30,y+14),(x+14,y+14)], '2D6D5B')

    slides=[]

    s=Scene('Tirlik — Всё для вашего бизнеса',bg=dark,
        notes='Tirlik готовит рабочие материалы по данным и ограничениям бизнеса. Это продуктовая презентация без подробного учебного кейса. Растровый фон является специально созданной предметной иллюстрацией; он не является интерфейсом, фотографией клиента или свидетельством AI-запуска.',
        evidence=['src/features/public-site/copy.ts','src/features/agent-tools/server/business-work-adapter.ts'])
    s.add('image',path='assets/backgrounds/hero-paper.png',x=0,y=0,w=W,h=H)
    s.text('Tirlik',80,108,680,112,white,True)
    s.text('Всё для\nвашего бизнеса',80,278,690,71,white,True)
    s.text('Рабочие материалы по вашим\nданным и ограничениям.',84,544,640,30,quiet)
    slides.append(s)

    s=Scene('AI готовит материалы по вашим условиям',bg=dark,
        notes='Модель выбирает предметные действия, а среда проверяет права, единицы, источники, ограничения и сохранение результата. Не утверждается, что каждый реальный модельный запуск завершается успешно. Изображены символические бумажные результаты; это не UI и не поддельный ответ модели.',
        evidence=['src/features/runs/server/runtime.ts','src/features/agent-tools/server/business-work-adapter.ts','src/features/artifacts/server/service.ts'])
    s.text('AI готовит материалы\nпо вашим условиям',80,74,1280,60,white,True)
    s.text('Сопоставляет исходники,\nпроверяет сроки, суммы и условия,\nсобирает новые материалы.',80,300,600,29,quiet)
    s.text('Результат сохраняется\nв рабочем проекте.',80,554,580,31,white,True)
    sleeve(s,822,309,460,360)
    folio(s,745,251,376,355,'8DBAA7',10)
    s.text('План',775,279,300,31,ink,True)
    folio(s,820,332,376,338,'B5D3C4',10)
    s.text('Предложение',850,361,310,30,ink,True)
    folio(s,895,417,376,294,white,12)
    s.text('Смета',925,449,280,39,ink,True)
    s.text('По вашим\nисходным данным',925,535,280,27,'4E6C5F')
    slides.append(s)

    s=Scene('Документы и таблицы для дальнейшей работы',bg='102B26',
        notes='Документы, таблицы и формулы остаются типизированными материалами с историей, прямой правкой и основаниями. Объекты на слайде — предметная иллюстрация двух типов материалов. Надписи описывают их состав; это не скриншот и не числовой кейс.',
        evidence=['src/features/documents/ui/document-editor.tsx','src/features/sheets/ui','src/features/artifacts/server/service.ts','tests/project-packages/connected.integration.test.ts'])
    s.text('Документы и таблицы\nдля дальнейшей работы',80,65,1280,58,white,True)
    folio(s,80,278,538,385,white,14)
    s.text('Предложение',114,309,457,36,ink,True)
    s.text('Состав работ',114,397,440,29,ink)
    s.text('Сроки и условия',114,463,440,29,ink)
    s.text('Ваши формулировки',114,529,440,29,ink)
    folio(s,731,251,612,412,'C6E3D4',14)
    s.text('Смета',765,282,520,36,ink,True)
    s.rect(763,365,549,89,'B1D3BF',8)
    s.text('Количество × Цена',789,389,500,30,ink,True)
    s.text('Формулы и источники',765,492,520,29,ink)
    s.text('Связанные значения',765,550,520,29,ink)
    s.text('Редактируйте нужную часть. Версии и основания остаются рядом.',80,720,1280,27,quiet)
    slides.append(s)

    s=Scene('Сроки и деньги проверяются до решения',bg='09221D',
        notes='Продукт объединяет планирование по доступности ресурсов, сравнение полных условий закупки и финансовую модель, разделяющую факты, обязательства и допущения. Прогноз требует пригодной истории и исторической проверки. Изображение не содержит вымышленных результатов расчёта.',
        evidence=['src/features/operations/domain/propose-work-plan.ts','src/features/procurement/domain/compare-suppliers.ts','tests/finance/work-builder.integration.test.ts','tests/forecast/run-forecast.test.ts'])
    s.text('Сроки и деньги\nпроверяются\nдо решения',80,82,650,60,white,True)
    s.text('Загрузка ресурсов, полные условия\nпоставщиков и денежные обязательства\nучитываются в одной работе.',80,367,650,28,quiet)
    s.text('Прогноз опирается\nна пригодную историю.',80,608,570,27,quiet)
    folio(s,852,131,462,509,'B3D6C4',14)
    s.text('План работы',885,163,393,36,ink,True)
    s.text('Ресурсы и ограничения',885,246,393,25,ink)
    s.text('Рабочее время',885,317,393,31,ink,True)
    s.text('Загрузка',885,394,393,31,ink,True)
    s.text('Закрепления',885,471,393,31,ink,True)
    s.text('Доступность и сроки',885,558,393,25,ink)
    folio(s,733,603,362,128,'D68C77',10,False)
    s.text('Условия закупки',762,641,306,29,ink,True)
    slides.append(s)

    s=Scene('Кампания собирается из ваших материалов',bg=dark,
        notes='Проверенный campaign builder сохраняет документ, два послойных макета и план, связывая смысловые значения. Образцы на слайде являются собственной рекламной графикой Tirlik для объяснения форматов и слоёв; это не свидетельство генерации конкретной кампании моделью.',
        evidence=['tests/campaigns/build-work.integration.test.ts','src/features/campaigns/server/build-campaign-work.ts','src/features/designs/ui/design-editor.tsx'])
    s.add('image',path='assets/backgrounds/campaign-paper.png',x=0,y=0,w=W,h=H)
    s.text('Кампания собирается\nиз ваших материалов',80,63,1190,60,white,True)
    s.text('Макеты разных форматов, тексты\nи план публикаций используют\nобщие условия и стиль.',80,292,670,29,quiet)
    s.text('Текст, изображения и фигуры\nможно менять по отдельности.',80,590,670,28,white)
    folio(s,839,298,394,374,'125D4E',13,False)
    mark(s,875,330,1.3)
    s.text('Tirlik',875,509,315,53,white,True)
    s.text('Всё для вашего бизнеса',875,596,315,21,white)
    folio(s,1193,403,152,309,'BFE0D0',11,False)
    mark(s,1214,432,.85,ink)
    s.text('Tirlik',1213,620,119,33,ink,True)
    slides.append(s)

    s=Scene('Изменения сохраняют ваши решения',bg='102B26',
        notes='Связанный выпуск подтверждён сохранёнными версиями: адресное обновление затрагивает документ и таблицу, сохраняя ручную формулировку и формулу. Реальные DOCX/XLSX входят в ZIP и повторно читаются. Здесь показан символический объект, а не интерфейс или придуманный AI-результат.',
        evidence=['tests/project-packages/connected.integration.test.ts','src/features/dependencies/server/service.ts','src/features/change-review'])
    s.text('Изменения сохраняют\nваши решения',80,72,1280,62,white,True)
    s.text('Адресные правки проходят\nпо связанным материалам.\nЗакреплённый текст и формулы\nостаются на месте.',80,330,650,30,quiet)
    folio(s,837,289,484,382,white,14)
    s.text('Ваш текст',872,334,410,40,ink,True)
    s.rect(869,425,414,92,'B8DEC9',8)
    s.text('Ручная правка',898,452,355,30,ink,True)
    s.text('=SUM(B2:B6)',872,565,410,31,ink)
    s.rect(1045,267,100,24,coral,5)
    s.rect(1065,281,60,23,'BD6B57',5)
    slides.append(s)

    s=Scene('Команда продолжает с общего контекста',bg='0A251F',
        notes='Сохранённый бизнес-контекст, проектный доступ и комментарии к конкретной версии позволяют продолжать работу с коллегами. Повтор использует новые данные и создаёт новый черновик, не переписывая принятый результат. Участники и доказательства использования не выдумываются.',
        evidence=['src/features/business-context','tests/collaboration','tests/recurring-work','src/features/recurring-work/server/rules.ts'])
    s.text('Команда работает\nс одними условиями',80,66,1280,61,white,True)
    sleeve(s,102,332,574,378)
    folio(s,80,276,560,384,'98C7B0',13)
    s.text('Правила бизнеса',115,310,488,35,ink,True)
    folio(s,136,383,560,315,'C8E1D2',13)
    s.text('Комментарии к версии',171,416,488,31,ink,True)
    folio(s,192,496,560,224,white,13)
    s.text('Следующая работа',227,531,488,33,ink,True)
    s.text('Свежие данные',227,602,488,27,'4E6C5F')
    s.text('Коллеги обсуждают\nконкретную версию.',840,304,520,32,white,True)
    s.text('Новая задача использует\nваши правила и свежие данные.',840,459,520,29,quiet)
    slides.append(s)

    s=Scene('Готовый комплект можно использовать дальше',bg='16473C',
        notes='Материалы экспортируются в реальные форматы. Документ поддерживает DOCX/PDF, таблица XLSX/PDF/CSV, план ICS/XLSX/PDF, макет PNG/PDF, комплект ZIP. Слайд не обещает автоматическую отправку клиентам или внешнюю публикацию. Файловые объекты — оригинальная символическая иллюстрация, не поддельные выгрузки.',
        evidence=['src/features/exports/server/documents/index.ts','src/features/exports/server/sheets.ts','src/features/operations/server/exports.ts','src/features/design-export/server/render.ts','tests/project-packages/connected.integration.test.ts'])
    s.text('Готовый комплект\nможно использовать дальше',80,67,1280,60,white,True)
    s.text('Документы, расчёты, планы и макеты\nпереходят в привычные инструменты бизнеса.',80,265,1260,28,'C7DFD2')
    specs=[(80,458,214,253,'D7E9DD','DOCX'),(309,411,228,300,'E9F0E9','XLSX'),(552,374,242,337,'B2DCC6','PDF'),(809,415,224,296,'E6A18C','PNG'),(1048,460,145,251,'B7D6C5','ICS'),(1208,507,145,204,'DCE9DF','ZIP')]
    for x,y,w,h,fill,name in specs:
        folio(s,x,y,w,h,fill,8)
        s.text(name,x+22,y+h-84,w-44,34 if len(name)<=3 else 31,ink,True)
    slides.append(s)

    s=Scene('Попробуйте Tirlik',bg=dark,
        notes='Ссылки ведут на действительный публичный адрес и репозиторий проекта. Эта презентация не объявляет завершённой визуальную приёмку или успешность всех AI-сценариев. Пилотных бизнес-замеров нет; необоснованных численных обещаний в слайдах нет.',
        evidence=['README.md','src/features/public-site/copy.ts'])
    s.add('image',path='assets/backgrounds/hero-paper.png',x=0,y=0,w=W,h=H)
    s.text('Попробуйте\nTirlik',80,106,710,89,white,True)
    s.text('Начните со своей задачи\nили готового рабочего примера.',84,370,660,30,quiet)
    s.text('tirlik.vercel.app',80,550,710,49,white,True,link='https://tirlik.vercel.app')
    s.text('Код проекта и запуск',84,654,645,27,quiet,link='https://github.com/DarinaX2005X/digital-taraz-hackhathon')
    slides.append(s)
    return slides
