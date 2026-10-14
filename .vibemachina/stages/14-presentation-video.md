# 14 Презентация и предметное продуктовое видео
Status: todo

Материалы для жюри создаём после стабильного продукта и README. Они должны показать реальную работу и управление результатом, а не обещать функции, которых нет.

Уточнение2026-10-14: после независимого review/исправлений12 и проверенного локального README/clean start13.1 можно выполнять media14. Публикация13.2 отложена пользователем до выбора сервера и не блокирует готовые локальные материалы. Не выдумывать live URL/QR или cloud доказательства; локальная поставка и будущая публикация отдельны.

Общий договор исполнения, локализации, передачи и проверок: [PLAN](../PLAN.md). Полные предметные контракты: [PROJECT](../PROJECT.md). Это запланированные задачи, не разрешение начать до approval.

## 14.1 Подготовить презентацию о проблеме, механизме и результате
Status: todo
Requirements: R01, R02, R04, R12, R13, R64, R78, R80, R90, R99, R101
Depends on: 13.1
Owner: SUBAGENT to assign
Paths: delivery/presentation/

**Контракт и результат.** C13; скилл «вайбпреза» читается только здесь. Read actual installed presentation skill now; full original BRIEF remarks preserved to worker, no summary substitution. Russian storyline audience fragmented work -> ownmaterials -> agenttools -> directediting -> linkedchanges -> usableoutput -> verifiedeffect/limits -> scalability. Concrete implemented case across differentbusiness models, no fabricated interviews/financialuplift. Architecture distinguishes deterministic engines fromAI and human approval. Editable source and PDF plus actual live/repo links/QR if appropriate.

**Вход в работу и состояния.** Audience zero context can explain who uses Tirlik and why no customer migration. Readable hierarchy, screenshots only user supplied or explicit product diagrams, visualidentity matched. User owns presentation visual review; no browser rendering workaround.

### 14.1.1 Содержание и дизайн презентации
Status: todo

Verify every claim against release/evidence, Russian names/amounts, actual URLs. Apply presentation skill with user restriction precedence; produce editable source.

### 14.1.2 Комплект и проверка файлов
Status: todo

Parse deck/PDF text/fonts/pages/links, no clipped-text claim without userlook. Final user comments incorporated and exported revision pinned to product.

## 14.2 Изучить видеореференсы и спроектировать историю движения
Status: todo
Requirements: R61, R67, R68, R69, R70, R71, R72, R73, R87
Depends on: 13.1
Owner: SUBAGENT to assign
Paths: delivery/video/research/, delivery/video/story/

**Контракт и результат.** C13; media/INDEX и media/reference-study читаются здесь. Read full original BRIEF including detailed user video observations and all later statements, plus existing study; locate all three original MP4 named there, verify actual file titles. Study complete motion using dense6-8fps sequences overview and sourcefps consecutiveframes for selected transitions with timecodes; metadata/sparse frames not full study. Only provided videos/images allowed, not capture product browser. Explain reusable timing/focus/composition lessons without copying brands/palette/music. Story actual input->tools->edit->versiondiff->export->return, multiple active layers and meaningful scene changes.

**Вход в работу и состояния.** No product UI inspection task. For footage use user recordings/images when available; else explicitly labelled motion diagrams built from validated product data, not fake screen recording. Plan legible narration/text/camera/object/sound together, no monotonous cornerzoom or card-click-card.

Новые обязательные первоисточники2026-10-14: два полных пользовательских сообщения из Arkiv_Hackathon/arkiv/.vibemachina/BRIEF, разделы11October «полная исходная обратная связь» и13October «новый подробный разбор движения полного видео», уже сохранены verbatim в BRIEF Tirlik. Читать полностью вместе с полезными F003/F004 из original TESTING. MAIN не открывал код чужого сайта; будущему worker это также запрещено. Разрешён при необходимости только renderer последней версии ролика. Принципы: camera-led focus, одновременные слои, связные morph/flight transitions, быстрые осмысленные взаимодействия, разнообразный звук без жёсткой зависимости движения от SFX; не scaled slideshow/fade-grid. Не копировать буквальный чужой сценарий или называть его preview approval приёмкой Tirlik. После достаточных проверок завершить цельный результат, не расходовать бесконечно циклы на те же кадры.

### 14.2.1 Честное исследование всех референсов
Status: todo

Coverage table filenames/duration/time ranges/fps and specific consecutive transition frames, no claim of watched footage outside recorded scope. Licenses/music sources planned.

### 14.2.2 Сценарий по реальной поставке
Status: todo

Shot list timing/mainfocus/backgroundmotion/transition/audio tied to provenfeatures and sourceassets. Feasible nonbrowser production route chosen before render, user restrictions maintained.

## 14.3 Собрать видео, исходники и встроить его в сайт
Status: todo
Requirements: R61, R64, R67, R68, R71, R72, R73, R95, R101
Depends on: 14.2, 14.1
Owner: SUBAGENT to assign
Paths: delivery/video/source/, delivery/video/output/, src/features/public-site/video/, tests/product-video/

**Контракт и результат.** C13; утверждённый storyboard14.2. Produce actual playable video with nonbrowser media pipeline (FFmpeg/native composition) from allowed bitmap/vector/text/userfootage. Do not use headless browser/Remotion browsercapture or reconstruct UI screenshot as false proof. Animate multiple layers/readablefocus, scenechanges and audio intentionally; keep source/render instructions/assetslicenses. Final MP4 webcodec/subtitles/poster derived from produced video, not product screenshot. Integrate video component in existing landing only after stable README, MAIN loans parent publicsite entry for embed; no source largebinary spam in Git if hosting artifactstorage needed.

**Вход в работу и состояния.** Player controls captions/poster/keyboard/reduced-motion, no autoplay sound, lazy load. Video explains audience/job/directedit/diff/export without claims of actual orders or clients onTirlik. User reviews motion/sound/readability, missingfootage not excuse for fake functionality.

### 14.3.1 Готовый ролик и редактируемый исходник
Status: todo

ffprobe codec/duration/framerate/audio/blackgap checks and subtitle timings, inspect allowed produced frames not UIautomation. Export files/source manifest and reproduce render. Visual quality user-approved separately.

### 14.3.2 Встраивание и комплект для жюри
Status: todo

HTTP range/MIME/videoasset/captions/player markup and stable link checks, landing build and deploy exact revision. Reconcile presentation/README/video name/slogan/capabilities; preserve actual files/download links.

