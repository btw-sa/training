/*
 * fixtures.js — fictional sample data for automated tests only.
 * Not part of the built site: the app starts empty and the owner creates the first Admin.
 */
const Core = require("../src/core.js");
const DAY = 86400000;
const DEMO_PASSWORD = "Demo2026";
const { makeAuthWith, mulberry32, humanDate } = Core._internals;
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function seedDemo(nowMs) {
  const T = nowMs || Date.now();
  const rnd = mulberry32(20261012);
  const d = n => new Date(T + n * DAY).toISOString();
  const day = n => d(n).slice(0, 10);
  const L = (en, ar) => ({ en, ar });

  const db = {
    meta: { schema: 5, seq: 1000, seededAt: new Date(T).toISOString() },
    settings: {
      business: L('By The Way', 'باي ذا واي'), certPrefix: 'BTW', defaultLang: 'ar', sequential: false, defaultDueDays: 14,  cardMinSeconds: 5,
      certificateLine: L('has successfully completed the training programme', 'أتمّ بنجاح البرنامج التدريبي'),
      kpi: { overdueDays: 7, failedAttempts: 2, lowAverage: 70, needsPracticeDays: 14, inactiveDays: 14, minSignals: 2 },
      retention: { inactiveUserYears: 3, auditYears: 5 },
      privacy: L(
        'We store your name, work email or phone, employee code, branch, team, role and job title, plus your training activity: sections completed, exam attempts and scores, practical sign-offs and certificates. We use it only to run and report on training. Your manager sees it only for the branches and teams they are responsible for. Records of people who leave are kept for the period set by your employer, then deleted. Ask your Admin to see or correct your data.',
        'نحفظ اسمك وبريد العمل أو الجوال والرقم الوظيفي والفرع والفريق والدور والمسمى الوظيفي، إضافة إلى نشاطك التدريبي: الأقسام المكتملة ومحاولات الاختبار والدرجات واعتمادات المهارات والشهادات. نستخدمها لإدارة التدريب وتقاريره فقط. لا يطّلع عليها مديرك إلا للفروع والفرق التي يتولاها. تُحفظ سجلات من يغادر العمل للمدة التي تحددها جهة العمل ثم تُحذف. تواصل مع مسؤول النظام لعرض بياناتك أو تصحيحها.')
    },
    locations: [
      { id: 'l1', name: L('Olaya', 'العليا'), city: L('Riyadh', 'الرياض'), active: true },
      { id: 'l2', name: L('Al Malqa', 'الملقا'), city: L('Riyadh', 'الرياض'), active: true },
      { id: 'l3', name: L('Khobar Corniche', 'كورنيش الخبر'), city: L('Al Khobar', 'الخبر'), active: true },
      { id: 'l4', name: L('Tahlia', 'التحلية'), city: L('Jeddah', 'جدة'), active: true }
    ],
    teams: [
      { id: 't1', locationId: 'l1', name: L('Olaya bar', 'بار العليا'), active: true },
      { id: 't2', locationId: 'l1', name: L('Olaya pastry', 'حلويات العليا'), active: true },
      { id: 't3', locationId: 'l2', name: L('Malqa bar', 'بار الملقا'), active: true },
      { id: 't4', locationId: 'l3', name: L('Khobar bar', 'بار الخبر'), active: true },
      { id: 't5', locationId: 'l4', name: L('Tahlia bar', 'بار التحلية'), active: true }
    ],
    users: [], grants: {}, loginAttempts: [], courses: [], versions: [], sections: [], files: [], exams: [], assignments: [], enrollments: [], progress: [], attempts: [],
    skills: [], signoffs: [], certs: [], notifications: [], rules: [], reminderLog: [], issues: [], faqs: [], corrections: [], exports: [],
    integrations: {
      drive: { connected: true, account: 'training@btw.example', by: 'u2', at: d(-40), reportsFolder: 'Training / Reports', backupsFolder: 'Training / Backups', scope: 'drive.file', token: 'vault://drive-refresh-token' },
      email: { provider: null }
    },
    audit: [], sim: { driveDown: false }
  };

  const U = (id, code, en, ar, email, role, loc, team, title, hire, status) => ({
    id, code, name: L(en, ar), email, phone: '', role, locationId: loc, teamId: team, title, hireDate: hire, lang: 'ar',
    status: status || 'active', createdBy: 'u1', createdAt: d(-120), updatedBy: 'u1', updatedAt: d(-120), deactivatedAt: status === 'inactive' ? d(-20) : null
  });
  db.users.push(
    U('u1', 'HQ-001', 'Huda Al-Qahtani', 'هدى القحطاني', 'huda@btw.example', 'admin', 'l1', null, 'Head of People', '2021-03-01'),
    U('u2', 'HQ-014', 'Omar Haddad', 'عمر حداد', 'omar@btw.example', 'it_manager', 'l1', null, 'IT Manager', '2022-06-12'),
    U('u3', 'HQ-020', 'Rakan Al-Shammari', 'راكان الشمري', 'rakan@btw.example', 'ops_manager', 'l1', null, 'Operations Manager', '2021-09-05'),
    U('u4', 'RY-101', 'Nora Al-Otaibi', 'نورة العتيبي', 'nora@btw.example', 'area_manager', 'l1', null, 'Area Manager, Riyadh', '2022-01-17'),
    U('u5', 'WE-201', 'Faisal Al-Ghamdi', 'فيصل الغامدي', 'faisal@btw.example', 'area_manager', 'l4', null, 'Area Manager, West & East', '2023-02-02'),
    U('s1', 'RY-1103', 'Sara Al-Harbi', 'سارة الحربي', 'sara@btw.example', 'staff', 'l1', 't1', 'Barista', '2026-08-20'),
    U('s2', 'RY-1104', 'Majed Al-Dossary', 'ماجد الدوسري', 'majed@btw.example', 'staff', 'l1', 't1', 'Senior barista', '2025-02-11'),
    U('s3', 'RY-1107', 'Lama Al-Zahrani', 'لمى الزهراني', 'lama@btw.example', 'staff', 'l1', 't2', 'Pastry assistant', '2026-05-03'),
    U('s4', 'RY-1210', 'Yousef Bakr', 'يوسف بكر', 'yousef@btw.example', 'staff', 'l2', 't3', 'Barista', '2026-07-01'),
    U('s5', 'RY-1211', 'Reem Al-Mutairi', 'ريم المطيري', 'reem@btw.example', 'staff', 'l2', 't3', 'Shift lead', '2024-10-15'),
    U('s6', 'RY-1214', 'Dana Al-Shehri', 'دانة الشهري', 'dana@btw.example', 'staff', 'l2', 't3', 'Barista', '2026-09-14'),
    U('s7', 'EP-3101', 'Abdulaziz Al-Anazi', 'عبدالعزيز العنزي', 'abdulaziz@btw.example', 'staff', 'l3', 't4', 'Barista', '2026-03-22'),
    U('s8', 'EP-3102', 'Tariq Saleh', 'طارق صالح', 'tariq@btw.example', 'staff', 'l3', 't4', 'Barista', '2025-11-30'),
    U('s9', 'WP-4101', 'Mona Fadel', 'منى فاضل', 'mona@btw.example', 'staff', 'l4', 't5', 'Barista', '2026-06-08'),
    U('s10', 'WP-4102', 'Khalid Nasser', 'خالد ناصر', 'khalid@btw.example', 'staff', 'l4', 't5', 'Barista', '2024-04-19'),
    U('s11', 'RY-1099', 'Hassan Ali', 'حسن علي', 'hassan@btw.example', 'staff', 'l1', 't1', 'Barista', '2023-01-09', 'inactive')
  );
  // Every demo account signs in with its employee code or email and the demo password.
  db.users.forEach(u => { u.auth = makeAuthWith(DEMO_PASSWORD, 'u1', false, rnd, d(-120)); });
  db.grants.u4 = {
    perms: ['users.view', 'users.edit', 'users.deactivate', 'users.import', 'assign.manage', 'progress.view', 'signoff.manage', 'reports.view', 'reports.export', 'certs.view', 'reminders.manage'],
    locations: ['l1', 'l2'], teams: [], users: [], courses: null, updatedBy: 'u1', updatedAt: d(-60)
  };
  db.grants.u5 = {
    perms: ['users.view', 'progress.view', 'signoff.manage', 'reports.view', 'certs.view', 'content.edit', 'files.manage', 'exams.manage'],
    locations: ['l4'], teams: ['t4'], users: [], courses: ['c4'], updatedBy: 'u1', updatedAt: d(-30)
  };

  /* ---- content ---- */
  let qn = 0, on = 0;
  const Q = (type, en, ar, choices, correct) => ({
    id: 'q' + (++qn), type, prompt: L(en, ar),
    choices: (type === 'tf' ? [['True', 'صح'], ['False', 'خطأ']] : choices).map(([ce, ca], i) => ({ id: 'o' + (++on), text: L(ce, ca), correct: i === correct }))
  });
  const course = (id, code, en, ar, den, dar, status, version, reviewDue, dueDays) => {
    db.courses.push({ id, code, title: L(en, ar), desc: L(den, dar), status, version, reviewDue, dueDays, createdBy: 'u3', updatedBy: 'u3', updatedAt: d(-50) });
    for (let v = 1; v <= version; v++) db.versions.push({ courseId: id, version: v, note: v === 1 ? 'First release' : 'Updated espresso recipe to 18 g in, 36 g out; new grind chart', retrain: v > 1 && id === 'c1' ? false : false, publishedBy: 'u3', publishedAt: d(-120 + v * 40) });
  };
  let sp = {};
  const section = (id, courseId, en, ar, ien, iar) => { sp[courseId] = (sp[courseId] || 0) + 1; db.sections.push({ id, courseId, pos: sp[courseId], title: L(en, ar), intro: L(ien, iar), required: true }); };
  let fp = {};
  const file = (sectionId, title, mime, size) => {
    fp[sectionId] = (fp[sectionId] || 0) + 1;
    const id = 'f' + (db.files.length + 1);
    db.files.push({ id, sectionId, pos: fp[sectionId], driveId: '1' + Math.floor(rnd() * 1e16).toString(36) + Math.floor(rnd() * 1e16).toString(36), title, mime, kind: /pdf/.test(mime) ? 'pdf' : /^video/.test(mime) ? 'video' : /^image/.test(mime) ? 'image' : 'doc', size, link: null, addedBy: 'u3', addedAt: d(-100) });
  };
  const exam = (id, courseId, sectionId, en, ar, passPct, timeLimitMin, maxAttempts, allowRetake, review, questions) =>
    db.exams.push({ id, courseId, sectionId, kind: sectionId ? 'section' : 'final', title: L(en, ar), passPct, timeLimitMin, maxAttempts, allowRetake, review, shuffle: !sectionId, questions });
  const skill = (id, courseId, en, ar, den, dar) => db.skills.push({ id, courseId, title: L(en, ar), desc: L(den, dar), requiresSignoff: true });

  course('c1', 'BAR-101', 'Barista Foundations', 'أساسيات الباريستا', 'Everything a new barista needs on the bar: coffee basics, espresso to recipe, milk, and bar hygiene.', 'كل ما يحتاجه الباريستا الجديد على البار: أساسيات القهوة، الإسبريسو حسب الوصفة، الحليب، ونظافة البار.', 'published', 2, day(95), 14);
  course('c2', 'FS-101', 'Food Safety Essentials', 'أساسيات سلامة الغذاء', 'Hygiene, temperature control and allergens for every team member.', 'النظافة الشخصية وضبط درجات الحرارة ومسببات الحساسية لكل أعضاء الفريق.', 'published', 1, day(20), 10);
  course('c3', 'OPS-110', 'Opening and Closing the Branch', 'فتح الفرع وإغلاقه', 'The checklists, cash routine and handover for opening and closing shifts.', 'قوائم التحقق وإجراءات النقد والتسليم في ورديات الفتح والإغلاق.', 'published', 1, day(-12), 21);
  course('c4', 'BAR-210', 'Cold Bar and Signature Drinks', 'البار البارد والمشروبات المميزة', 'Iced espresso drinks, cold brew and the seasonal menu.', 'مشروبات الإسبريسو المثلجة والكولد برو وقائمة الموسم.', 'draft', 0, null, 14);

  section('s_c1_1', 'c1', 'Welcome and coffee basics', 'الترحيب وأساسيات القهوة', 'Watch the welcome video, then read the coffee basics guide. About 15 minutes.', 'شاهد فيديو الترحيب ثم اقرأ دليل أساسيات القهوة. حوالي ١٥ دقيقة.');
  section('s_c1_2', 'c1', 'Espresso to recipe', 'الإسبريسو حسب الوصفة', 'Learn the house recipe and how to dial in the grinder at the start of every shift.', 'تعلّم وصفة المقهى وطريقة ضبط المطحنة في بداية كل وردية.');
  section('s_c1_3', 'c1', 'Milk steaming and texture', 'تبخير الحليب وقوامه', 'Temperature, texture and wand hygiene for every milk drink.', 'درجة الحرارة والقوام ونظافة ذراع البخار لكل مشروب بالحليب.');
  section('s_c1_4', 'c1', 'Bar hygiene and food safety', 'نظافة البار وسلامة الغذاء', 'The daily cleaning routine, fridge checks and allergen questions.', 'روتين التنظيف اليومي وفحص الثلاجات وأسئلة مسببات الحساسية.');
  file('s_c1_1', 'Welcome to the team', 'video/mp4', 48200000);
  file('s_c1_1', 'Coffee basics: origins and roast levels', 'application/pdf', 1840000);
  file('s_c1_2', 'Espresso recipe card', 'application/pdf', 420000);
  file('s_c1_2', 'Grinder dial-in walkthrough', 'video/mp4', 61500000);
  file('s_c1_2', 'Grind size chart', 'image/jpeg', 690000);
  file('s_c1_3', 'Milk texture guide', 'application/pdf', 980000);
  file('s_c1_3', 'Steaming demonstration', 'video/mp4', 39000000);
  file('s_c1_4', 'Daily cleaning checklist', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 64000);
  file('s_c1_4', 'Allergen chart', 'application/pdf', 310000);

  section('s_c2_1', 'c2', 'Personal hygiene', 'النظافة الشخصية', 'Handwashing, uniform and when to stay home.', 'غسل اليدين والزي ومتى تبقى في المنزل.');
  section('s_c2_2', 'c2', 'Temperature control', 'ضبط درجات الحرارة', 'Cold holding, hot holding and the temperature log.', 'الحفظ البارد والحفظ الساخن وسجل درجات الحرارة.');
  section('s_c2_3', 'c2', 'Allergens', 'مسببات الحساسية', 'How to answer guests accurately and avoid cross-contact.', 'كيف تجيب الضيف بدقة وتتجنب التلامس العرضي.');
  file('s_c2_1', 'Handwashing steps poster', 'image/png', 520000);
  file('s_c2_1', 'Personal hygiene policy', 'application/pdf', 260000);
  file('s_c2_2', 'Fridge and freezer temperature log', 'application/pdf', 150000);
  file('s_c2_2', 'Hot and cold holding explained', 'video/mp4', 22000000);
  file('s_c2_3', 'Allergen chart', 'application/pdf', 310000);

  section('s_c3_1', 'c3', 'Opening checklist', 'قائمة فتح الفرع', 'From unlocking to the first coffee: equipment, temperatures and stock.', 'من فتح الباب حتى أول قهوة: المعدات ودرجات الحرارة والمخزون.');
  section('s_c3_2', 'c3', 'Cash and point of sale', 'النقد ونقطة البيع', 'Float, refunds and the end-of-shift count.', 'العهدة النقدية والمرتجعات والجرد في نهاية الوردية.');
  section('s_c3_3', 'c3', 'Closing checklist', 'قائمة إغلاق الفرع', 'Cleaning, stock rotation, handover notes and alarm.', 'التنظيف وتدوير المخزون وملاحظات التسليم والإنذار.');
  file('s_c3_1', 'Opening checklist', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 58000);
  file('s_c3_2', 'Cash handling procedure', 'application/pdf', 330000);
  file('s_c3_3', 'Closing checklist', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 61000);
  file('s_c3_3', 'Closing walkthrough', 'video/mp4', 35500000);

  section('s_c4_1', 'c4', 'Iced espresso drinks', 'مشروبات الإسبريسو المثلجة', 'Builds, ice ratios and dilution.', 'طريقة التحضير ونسبة الثلج والتخفيف.');
  section('s_c4_2', 'c4', 'Cold brew', 'الكولد برو', 'Batch recipe, steeping time and storage.', 'وصفة الدفعة ومدة النقع والتخزين.');
  file('s_c4_1', 'Iced latte build card', 'application/pdf', 400000);

  exam('x1', 'c1', 's_c1_1', 'Coffee basics quiz', 'اختبار أساسيات القهوة', 75, 10, 3, true, 'after_submit', [
    Q('mc', 'Which two coffee species make up almost all coffee sold?', 'ما النوعان اللذان يشكلان معظم القهوة المباعة؟', [['Arabica and Robusta', 'أرابيكا وروبوستا'], ['Liberica and Excelsa', 'ليبيريكا وإكسلسا'], ['Arabica and Liberica', 'أرابيكا وليبيريكا'], ['Robusta and Excelsa', 'روبوستا وإكسلسا']], 0),
    Q('tf', 'A darker roast always has more caffeine than a lighter roast.', 'التحميص الداكن يحتوي دائمًا على كافيين أكثر من التحميص الفاتح.', null, 1),
    Q('mc', 'How should opened coffee beans be stored at the bar?', 'كيف تُحفظ حبوب القهوة المفتوحة على البار؟', [['Airtight, cool and away from light', 'في وعاء محكم بعيدًا عن الحرارة والضوء'], ['In the milk fridge', 'في ثلاجة الحليب'], ['Left in the hopper overnight', 'تُترك في خزان المطحنة طوال الليل'], ['Next to the oven to stay warm', 'بجانب الفرن لتبقى دافئة']], 0),
    Q('mc', 'When a guest reaches the counter, greet them:', 'عندما يصل الضيف إلى الكاونتر، رحّب به:', [['Within 10 seconds, even if you are busy', 'خلال ١٠ ثوانٍ حتى لو كنت مشغولًا'], ['After finishing the current drink', 'بعد إنهاء المشروب الحالي'], ['Only when they speak first', 'فقط عندما يبدأ هو الحديث'], ['When the manager asks you to', 'عندما يطلب المدير ذلك']], 0)
  ]);
  exam('x2', 'c1', 's_c1_2', 'Espresso quiz', 'اختبار الإسبريسو', 80, 10, 3, true, 'after_pass', [
    Q('mc', 'Our standard double shot recipe is:', 'وصفتنا القياسية للشوت المزدوج هي:', [['18 g in, 36 g out, 25–30 seconds', '١٨ غ قهوة، ٣٦ غ ناتج، ٢٥–٣٠ ثانية'], ['18 g in, 18 g out, 15 seconds', '١٨ غ قهوة، ١٨ غ ناتج، ١٥ ثانية'], ['14 g in, 60 g out, 40 seconds', '١٤ غ قهوة، ٦٠ غ ناتج، ٤٠ ثانية'], ['22 g in, 30 g out, 10 seconds', '٢٢ غ قهوة، ٣٠ غ ناتج، ١٠ ثوانٍ']], 0),
    Q('mc', 'The shot runs in 18 seconds and tastes sour. What do you change first?', 'الشوت استغرق ١٨ ثانية وطعمه حامض. ما أول ما تغيّره؟', [['Grind finer', 'طحن أنعم'], ['Grind coarser', 'طحن أخشن'], ['Add hot water to the cup', 'إضافة ماء ساخن للكوب'], ['Tamp more lightly', 'كبس أخف']], 0),
    Q('tf', 'Purge the group head before locking in the portafilter.', 'نظّف رأس المجموعة بدفعة ماء قبل تركيب حامل الفلتر.', null, 0),
    Q('mc', 'When is the grinder dialled in?', 'متى يتم ضبط المطحنة؟', [['At opening, and whenever time or taste drifts', 'عند الفتح وكلما تغيّر الوقت أو الطعم'], ['Once a week', 'مرة في الأسبوع'], ['Only after a complaint', 'فقط بعد شكوى'], ['Never, the supplier sets it', 'أبدًا، المورد يضبطها']], 0),
    Q('tf', 'Uneven tamping can cause channelling.', 'الكبس غير المستوي قد يسبب تسرب الماء من مسارات ضعيفة.', null, 0)
  ]);
  exam('x3', 'c1', 's_c1_3', 'Milk quiz', 'اختبار الحليب', 75, 10, 3, true, 'after_submit', [
    Q('mc', 'Target milk temperature for a latte:', 'درجة حرارة الحليب المستهدفة للاتيه:', [['60–65 °C', '٦٠–٦٥ °م'], ['40–45 °C', '٤٠–٤٥ °م'], ['75–80 °C', '٧٥–٨٠ °م'], ['Above 90 °C', 'أعلى من ٩٠ °م']], 0),
    Q('mc', 'Wipe and purge the steam wand:', 'امسح ذراع البخار ونظّفه بدفعة بخار:', [['Straight after every use', 'مباشرة بعد كل استخدام'], ['At closing only', 'عند الإغلاق فقط'], ['Once an hour', 'مرة كل ساعة'], ['When it looks dirty', 'عندما يبدو متسخًا']], 0),
    Q('tf', 'Re-steaming leftover milk is fine if it is still warm.', 'إعادة تبخير الحليب المتبقي مقبولة إذا كان لا يزال دافئًا.', null, 1),
    Q('mc', 'A cappuccino has:', 'الكابتشينو يحتوي على:', [['More foam than a latte', 'رغوة أكثر من اللاتيه'], ['No foam', 'بدون رغوة'], ['The same texture as a flat white', 'نفس قوام الفلات وايت'], ['Cold foam only', 'رغوة باردة فقط']], 0)
  ]);
  exam('x4', 'c1', 's_c1_4', 'Hygiene quiz', 'اختبار النظافة', 80, 10, 3, true, 'after_submit', [
    Q('mc', 'Wash your hands for at least:', 'اغسل يديك لمدة لا تقل عن:', [['20 seconds', '٢٠ ثانية'], ['5 seconds', '٥ ثوانٍ'], ['A quick rinse', 'شطف سريع'], ['2 minutes', 'دقيقتين']], 0),
    Q('tf', 'Use the allergen chart when a guest asks about allergens.', 'استخدم جدول مسببات الحساسية عندما يسأل الضيف عنها.', null, 0),
    Q('mc', 'The milk fridge must be at:', 'يجب أن تكون ثلاجة الحليب عند:', [['5 °C or below', '٥ °م أو أقل'], ['8–10 °C', '٨–١٠ °م'], ['12 °C', '١٢ °م'], ['Room temperature', 'حرارة الغرفة']], 0),
    Q('mc', 'Cloths for the bar and the floor are:', 'مناشف البار والأرضية:', [['Separate and colour-coded', 'منفصلة ومميزة بالألوان'], ['The same cloth', 'نفس المنشفة'], ['Whatever is nearest', 'أي منشفة قريبة'], ['Paper only', 'ورق فقط']], 0),
    Q('tf', 'Chemical spray bottles can be kept on the coffee bar.', 'يمكن إبقاء بخاخات المواد الكيميائية على بار القهوة.', null, 1)
  ]);
  exam('x5', 'c1', null, 'Barista Foundations final assessment', 'التقييم النهائي لأساسيات الباريستا', 80, 15, 3, true, 'after_pass', [
    Q('mc', 'Double shot recipe:', 'وصفة الشوت المزدوج:', [['18 g in, 36 g out, 25–30 s', '١٨ غ، ٣٦ غ، ٢٥–٣٠ ث'], ['18 g in, 50 g out, 45 s', '١٨ غ، ٥٠ غ، ٤٥ ث'], ['10 g in, 36 g out, 20 s', '١٠ غ، ٣٦ غ، ٢٠ ث'], ['25 g in, 25 g out, 15 s', '٢٥ غ، ٢٥ غ، ١٥ ث']], 0),
    Q('mc', 'A fast, sour shot needs:', 'الشوت السريع الحامض يحتاج:', [['A finer grind', 'طحنًا أنعم'], ['A coarser grind', 'طحنًا أخشن'], ['Less coffee', 'قهوة أقل'], ['Hotter milk', 'حليبًا أسخن']], 0),
    Q('mc', 'Latte milk temperature:', 'حرارة حليب اللاتيه:', [['60–65 °C', '٦٠–٦٥ °م'], ['45 °C', '٤٥ °م'], ['80 °C', '٨٠ °م'], ['95 °C', '٩٥ °م']], 0),
    Q('tf', 'Leftover steamed milk can be re-steamed for the next drink.', 'يمكن إعادة تبخير الحليب المتبقي للمشروب التالي.', null, 1),
    Q('mc', 'Minimum handwashing time:', 'أقل مدة لغسل اليدين:', [['20 seconds', '٢٠ ثانية'], ['10 seconds', '١٠ ثوانٍ'], ['5 seconds', '٥ ثوانٍ'], ['1 minute', 'دقيقة']], 0),
    Q('mc', 'Milk fridge temperature:', 'حرارة ثلاجة الحليب:', [['5 °C or below', '٥ °م أو أقل'], ['10 °C', '١٠ °م'], ['15 °C', '١٥ °م'], ['Any, if milk is sealed', 'أي درجة إذا كان مغلقًا']], 0),
    Q('tf', 'Purge the group head before every shot.', 'نظّف رأس المجموعة بدفعة ماء قبل كل شوت.', null, 0),
    Q('mc', 'A guest asks if a pastry contains nuts. You:', 'سأل ضيف هل المعجنات تحتوي مكسرات. أنت:', [['Check the allergen chart and answer exactly', 'تراجع جدول الحساسية وتجيب بدقة'], ['Say probably not', 'تقول غالبًا لا'], ['Ask a colleague to guess', 'تطلب من زميل التخمين'], ['Say all items are safe', 'تقول إن كل المنتجات آمنة']], 0)
  ]);
  exam('x6', 'c2', null, 'Food safety assessment', 'تقييم سلامة الغذاء', 80, 12, 3, true, 'after_submit', [
    Q('mc', 'Wash hands for at least:', 'اغسل يديك لمدة لا تقل عن:', [['20 seconds', '٢٠ ثانية'], ['5 seconds', '٥ ثوانٍ'], ['A quick rinse', 'شطف سريع'], ['1 second', 'ثانية']], 0),
    Q('mc', 'Chilled food is held at:', 'يُحفظ الطعام المبرّد عند:', [['5 °C or below', '٥ °م أو أقل'], ['10 °C', '١٠ °م'], ['15 °C', '١٥ °م'], ['Room temperature', 'حرارة الغرفة']], 0),
    Q('mc', 'Hot food on display is held at:', 'يُحفظ الطعام الساخن المعروض عند:', [['63 °C or above', '٦٣ °م أو أعلى'], ['40 °C', '٤٠ °م'], ['50 °C', '٥٠ °م'], ['Any warm temperature', 'أي حرارة دافئة']], 0),
    Q('tf', 'Ready-to-eat food is stored above raw food in the fridge.', 'يُحفظ الطعام الجاهز للأكل فوق الطعام النيء في الثلاجة.', null, 0),
    Q('mc', 'Stock rotation means:', 'تدوير المخزون يعني:', [['First in, first out', 'ما يدخل أولًا يُستخدم أولًا'], ['Newest first', 'الأحدث أولًا'], ['Whatever is on top', 'ما يكون في الأعلى'], ['Random', 'عشوائيًا']], 0),
    Q('tf', 'If you have vomiting or diarrhoea, tell your manager before your shift.', 'إذا كنت تعاني من القيء أو الإسهال، أبلغ مديرك قبل الوردية.', null, 0)
  ]);
  exam('x7', 'c3', null, 'Opening and closing assessment', 'تقييم الفتح والإغلاق', 80, 10, 2, true, 'after_submit', [
    Q('mc', 'First task after unlocking:', 'أول مهمة بعد فتح الباب:', [['Disarm the alarm and check fridge temperatures', 'إيقاف الإنذار وفحص حرارة الثلاجات'], ['Serve the first guest', 'خدمة أول ضيف'], ['Count the safe', 'جرد الخزنة'], ['Clean the windows', 'تنظيف النوافذ']], 0),
    Q('tf', 'The till float is counted at both opening and closing.', 'تُعدّ العهدة النقدية عند الفتح والإغلاق.', null, 0),
    Q('mc', 'Refunds above the limit need:', 'المرتجعات التي تتجاوز الحد تحتاج:', [['Shift lead approval', 'موافقة مشرف الوردية'], ['No approval', 'بدون موافقة'], ['The guest\'s signature only', 'توقيع الضيف فقط'], ['Head office by email', 'المكتب الرئيسي بالبريد']], 0),
    Q('mc', 'Before leaving at closing:', 'قبل المغادرة عند الإغلاق:', [['Complete the checklist and handover notes', 'إكمال قائمة التحقق وملاحظات التسليم'], ['Leave the grinder full', 'ترك المطحنة ممتلئة'], ['Switch off the fridges', 'إطفاء الثلاجات'], ['Take the keys home without logging', 'أخذ المفاتيح دون تسجيل']], 0),
    Q('tf', 'Group heads are backflushed every day at closing.', 'تُنظّف رؤوس المجموعات بالغسيل العكسي يوميًا عند الإغلاق.', null, 0)
  ]);
  exam('x8', 'c4', null, 'Cold bar assessment', 'تقييم البار البارد', 80, 10, 3, true, 'after_submit', [
    Q('mc', 'Cold brew concentrate is stored:', 'يُحفظ مركز الكولد برو:', [['Chilled, labelled and dated', 'مبردًا وعليه ملصق وتاريخ'], ['At room temperature', 'في حرارة الغرفة'], ['Unlabelled', 'دون ملصق'], ['In the freezer', 'في الفريزر']], 0)
  ]);

  skill('k1', 'c1', 'Pull a double shot to recipe', 'استخلاص شوت مزدوج حسب الوصفة', '18 g in, 36 g out, 25–30 seconds, three shots in a row.', '١٨ غ قهوة، ٣٦ غ ناتج، ٢٥–٣٠ ثانية، ثلاث مرات متتالية.');
  skill('k2', 'c1', 'Steam milk for a latte', 'تبخير الحليب للاتيه', '60–65 °C, glossy texture, wand wiped and purged.', '٦٠–٦٥ °م، قوام لامع، ومسح ذراع البخار وتنظيفه.');
  skill('k3', 'c1', 'Clean group heads at closing', 'تنظيف رؤوس المجموعات عند الإغلاق', 'Backflush, scrub gaskets and screens, log it.', 'غسيل عكسي، تنظيف الحلقات والمصافي، والتسجيل.');
  skill('k4', 'c2', 'Record fridge temperatures', 'تسجيل حرارة الثلاجات', 'Read, record and act on an out-of-range reading.', 'القراءة والتسجيل والتصرف عند خروج القراءة عن الحد.');
  skill('k5', 'c3', 'Run the opening checklist', 'تنفيذ قائمة الفتح', 'Complete every step on time with a manager present.', 'إكمال كل الخطوات في وقتها بحضور المدير.');
  skill('k6', 'c3', 'Close the till and branch', 'إغلاق الصندوق والفرع', 'Cash count matches, checklist and handover complete.', 'مطابقة الجرد النقدي وإكمال القائمة والتسليم.');

  /* ---- training history (deterministic) ---- */
  const exList = c => db.exams.filter(x => x.courseId === c);
  const enroll = (uid, cid, assignedDaysAgo, dueInDays) => {
    const c = db.courses.find(x => x.id === cid);
    const e = { id: 'e' + (db.enrollments.length + 1), userId: uid, courseId: cid, version: c.version, assignmentId: null, assignedAt: d(-assignedDaysAgo), dueOn: day(dueInDays), startedAt: null, completedAt: null, active: true };
    db.enrollments.push(e); return e;
  };
  let tn = 0;
  const attempt = (uid, examId, version, daysAgo, score, no) => {
    const ex = db.exams.find(x => x.id === examId);
    db.attempts.push({ id: 't' + (++tn), examId, userId: uid, version, no, startedAt: d(-daysAgo), expiresAt: null, submittedAt: d(-daysAgo + 0.01), answers: {}, scorePct: score, passed: score >= ex.passPct, order: ex.questions.map(q => q.id) });
  };
  const doSection = (uid, sid, version, daysAgo) => db.progress.push({ userId: uid, sectionId: sid, version, viewed: db.files.filter(f => f.sectionId === sid).map(f => f.id), completedAt: d(-daysAgo) });
  const sign = (uid, kid, status, daysAgo, by, notes) => db.signoffs.push({ id: 'so' + (db.signoffs.length + 1), skillId: kid, userId: uid, status, notes: notes || '', by, at: d(-daysAgo) });
  const certFor = (e, daysAgo) => {
    const u = db.users.find(x => x.id === e.userId); const c = db.courses.find(x => x.id === e.courseId);
    const al = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = '';
    for (let i = 0; i < 8; i++) s += al[Math.floor(rnd() * al.length)];
    e.completedAt = d(-daysAgo);
    db.certs.push({ id: 'c' + (db.certs.length + 1), no: `BTW-${new Date(T - daysAgo * DAY).getUTCFullYear()}-${s.slice(0, 4)}-${s.slice(4)}`, userId: u.id, courseId: c.id, version: e.version, holder: clone(u.name), business: clone(db.settings.business), courseTitle: clone(c.title), completedOn: day(-daysAgo), issuedAt: d(-daysAgo), issuedBy: 'system', status: 'valid', revokedAt: null, revokedBy: null, reason: null, replaces: null });
  };
  // Walk a learner through a course: n sections done, optional final, scores list for sections.
  const progress = (uid, cid, opts) => {
    const e = enroll(uid, cid, opts.assigned, opts.due);
    const secs = db.sections.filter(s => s.courseId === cid).sort((a, b) => a.pos - b.pos);
    let t = opts.assigned - 1;
    if (opts.sections > 0) e.startedAt = d(-t);
    secs.slice(0, opts.sections).forEach((s, i) => {
      const ex = exList(cid).find(x => x.sectionId === s.id);
      if (ex) {
        const sc = (opts.scores || [])[i] != null ? opts.scores[i] : 80 + Math.floor(rnd() * 21);
        const ar = Array.isArray(sc) ? sc : [sc];
        ar.forEach((v, j) => attempt(uid, ex.id, e.version, t - j * 0.2, v, j + 1));
      }
      doSection(uid, s.id, e.version, t - 0.5);
      t = Math.max(opts.lastActive || 0, t - (opts.pace || 2));
    });
    if (opts.partial) { const s = secs[opts.sections]; if (s) { const ex = exList(cid).find(x => x.sectionId === s.id); if (ex) opts.partial.forEach((v, j) => attempt(uid, ex.id, e.version, t - j * 0.3, v, j + 1)); db.progress.push({ userId: uid, sectionId: s.id, version: e.version, viewed: db.files.filter(f => f.sectionId === s.id).slice(0, 1).map(f => f.id), completedAt: null }); } }
    if (opts.final) {
      const fx = exList(cid).find(x => x.kind === 'final');
      const fs = Array.isArray(opts.final) ? opts.final : [opts.final];
      fs.forEach((v, j) => attempt(uid, fx.id, e.version, Math.max(0.2, t - 0.5 - j * 0.3), v, j + 1));
    }
    return e;
  };

  // Sara (demo learner): Barista in progress, Food Safety done with certificate, Opening/Closing overdue.
  const sara1 = progress('s1', 'c1', { assigned: 9, due: 5, sections: 1, scores: [100], pace: 2, partial: [] });
  db.progress.find(p => p.userId === 's1' && p.sectionId === 's_c1_2') || db.progress.push({ userId: 's1', sectionId: 's_c1_2', version: 2, viewed: ['f3'], completedAt: null });
  const sara2 = progress('s1', 'c2', { assigned: 30, due: -16, sections: 3, pace: 3, final: 92 });
  sign('s1', 'k4', 'passed', 22, 'u4', 'Logged both fridges correctly.');
  certFor(sara2, 21);
  progress('s1', 'c3', { assigned: 25, due: -4, sections: 0 });
  sign('s1', 'k1', 'needs_practice', 3, 'u4', 'Shots running fast; practise dosing.');

  // Majed: senior, all done.
  const m1 = progress('s2', 'c1', { assigned: 70, due: -56, sections: 4, scores: [100, 100, 75, 100], pace: 2, final: 88 });
  ['k1', 'k2', 'k3'].forEach((k, i) => sign('s2', k, 'passed', 60 - i, 'u4'));
  certFor(m1, 58);
  const m2 = progress('s2', 'c2', { assigned: 70, due: -60, sections: 3, pace: 1, final: 100 }); sign('s2', 'k4', 'passed', 63, 'u4'); certFor(m2, 62);
  const m3 = progress('s2', 'c3', { assigned: 40, due: -19, sections: 3, pace: 2, final: 80 }); sign('s2', 'k5', 'passed', 30, 'u4'); sign('s2', 'k6', 'passed', 29, 'u4'); certFor(m3, 29);

  // Lama: food safety in progress, struggling with final (two fails), inactive lately.
  progress('s3', 'c2', { assigned: 40, due: -26, sections: 3, pace: 3, final: [67, 50], lastActive: 18 });
  progress('s3', 'c3', { assigned: 25, due: -4, sections: 1, pace: 2, lastActive: 18 });

  // Yousef: barista, failed espresso quiz twice, low scores, overdue.
  progress('s4', 'c1', { assigned: 35, due: -21, sections: 1, scores: [[50, 75]], pace: 4, partial: [60, 60] });
  progress('s4', 'c2', { assigned: 35, due: -25, sections: 2, pace: 4 });
  sign('s4', 'k2', 'needs_practice', 25, 'u4', 'Milk too hot; use thermometer.');

  // Reem: shift lead, completed c1 and c3, c2 in progress.
  const r1 = progress('s5', 'c1', { assigned: 60, due: -46, sections: 4, scores: [100, 80, 100, 80], pace: 2, final: [75, 88] });
  ['k1', 'k2', 'k3'].forEach((k, i) => sign('s5', k, 'passed', 48 - i, 'u4')); certFor(r1, 47);
  const r3 = progress('s5', 'c3', { assigned: 50, due: -29, sections: 3, pace: 3, final: 100 }); sign('s5', 'k5', 'passed', 38, 'u3'); sign('s5', 'k6', 'passed', 38, 'u3'); certFor(r3, 37);
  progress('s5', 'c2', { assigned: 6, due: 4, sections: 2, pace: 1 });

  // Dana: new starter, just assigned.
  progress('s6', 'c1', { assigned: 2, due: 12, sections: 0 });
  progress('s6', 'c2', { assigned: 2, due: 8, sections: 0 });

  // Abdulaziz (Khobar): c1 sections done, final pending, awaiting sign-off.
  progress('s7', 'c1', { assigned: 28, due: -14, sections: 4, scores: [75, 80, 75, 80], pace: 3, final: [63] });
  progress('s7', 'c2', { assigned: 28, due: -18, sections: 3, pace: 2, final: 83 });
  sign('s7', 'k4', 'not_assessed', 10, 'u5');
  // Tariq (Khobar): done c2, c1 progressing.
  const tq = progress('s8', 'c2', { assigned: 45, due: -35, sections: 3, pace: 2, final: 100 }); sign('s8', 'k4', 'passed', 40, 'u5'); certFor(tq, 39);
  progress('s8', 'c1', { assigned: 12, due: 2, sections: 2, scores: [100, 80], pace: 2 });

  // Mona and Khalid (Jeddah).
  progress('s9', 'c1', { assigned: 20, due: -6, sections: 3, scores: [75, [60, 80], 75], pace: 3 });
  sign('s9', 'k1', 'passed', 8, 'u5'); sign('s9', 'k2', 'needs_practice', 20, 'u5', 'Texture too foamy for latte.');
  const k1 = progress('s10', 'c2', { assigned: 55, due: -45, sections: 3, pace: 2, final: 92 }); sign('s10', 'k4', 'passed', 49, 'u5'); certFor(k1, 48);
  const k3 = progress('s10', 'c1', { assigned: 55, due: -41, sections: 4, scores: [100, 100, 100, 80], pace: 2, final: 100 });
  ['k1', 'k2', 'k3'].forEach((k, i) => sign('s10', k, 'passed', 44 - i, 'u5')); certFor(k3, 43);

  // Hassan (inactive) kept for reporting history.
  const h1 = progress('s11', 'c2', { assigned: 200, due: -186, sections: 3, pace: 3, final: 83 }); sign('s11', 'k4', 'passed', 190, 'u4'); certFor(h1, 189);

  db.assignments.push({ id: 'g1', courseId: 'c1', target: { kind: 'role', role: 'staff' }, dueOn: null, assignedBy: 'u3', at: d(-70), scope: null });
  db.enrollments.forEach(e => { e.assignmentId = e.assignmentId || 'g1'; });

  db.rules.push(
    { id: 'rr1', trigger: 'assigned', days: 0, every: 0, max: 1, channels: ['in_app'], template: L('Hi {name}, {course} is waiting for you. Due {due}.', 'مرحبًا {name}، دورة {course} بانتظارك. الموعد النهائي {due}.'), active: true, createdBy: 'u3', scope: null },
    { id: 'rr2', trigger: 'due_soon', days: 3, every: 0, max: 1, channels: ['in_app'], template: L('{course} is due on {due}. You can finish it in one shift.', 'موعد إنهاء {course} هو {due}. يمكنك إنهاؤها في وردية واحدة.'), active: true, createdBy: 'u3', scope: null },
    { id: 'rr3', trigger: 'overdue', days: 1, every: 7, max: 3, channels: ['in_app'], template: L('{course} is overdue since {due}. Talk to your manager if you need time on shift.', 'دورة {course} متأخرة منذ {due}. تحدّث مع مديرك إن احتجت وقتًا خلال الوردية.'), active: true, createdBy: 'u3', scope: null }
  );

  db.notifications.push(
    { id: 'n1', userId: 's1', kind: 'reminder', title: L('Training reminder', 'تذكير بالتدريب'), body: L('Opening and Closing the Branch is overdue since ' + humanDate(day(-4), 'en') + '. Talk to your manager if you need time on shift.', 'دورة فتح الفرع وإغلاقه متأخرة منذ ' + humanDate(day(-4), 'ar') + '. تحدّث مع مديرك إن احتجت وقتًا خلال الوردية.'), link: 'course:c3', key: 'rem:rr3:seed', at: d(-2), readAt: null },
    { id: 'n2', userId: 's1', kind: 'certificate', title: L('Certificate ready', 'شهادتك جاهزة'), body: L('You completed Food Safety Essentials.', 'أكملت دورة أساسيات سلامة الغذاء.'), link: 'certs', key: 'cert:seed', at: d(-21), readAt: d(-20) }
  );
  db.reminderLog.push({ ruleId: 'rr3', enrollmentId: db.enrollments.find(e => e.userId === 's1' && e.courseId === 'c3').id, n: 1, at: d(-2), channels: ['in_app'] });

  db.issues.push({ id: 'i1', userId: 's9', courseId: 'c1', sectionId: 's_c1_2', fileId: 'f5', message: 'The grind chart still shows the old 20 g recipe.', status: 'open', at: d(-5), resolvedBy: null, note: null });

  db.faqs.push(
    { id: 'fq1', q: L('What is our espresso recipe?', 'ما وصفة الإسبريسو لدينا؟'), a: L('Double shot: 18 g in, 36 g out, 25–30 seconds. Dial in at opening and whenever time or taste drifts.', 'شوت مزدوج: ١٨ غ قهوة، ٣٦ غ ناتج، ٢٥–٣٠ ثانية. اضبط المطحنة عند الفتح وكلما تغيّر الوقت أو الطعم.'), tags: ['espresso', 'recipe', 'إسبريسو'] },
    { id: 'fq2', q: L('How hot should milk be?', 'ما درجة حرارة الحليب المناسبة؟'), a: L('60–65 °C for lattes and cappuccinos. Never re-steam milk. Wipe and purge the wand after every jug.', '٦٠–٦٥ °م للاتيه والكابتشينو. لا تعِد تبخير الحليب أبدًا. امسح ذراع البخار ونظّفه بعد كل إبريق.'), tags: ['milk', 'حليب'] },
    { id: 'fq3', q: L('The fridge reads above 5 °C. What do I do?', 'الثلاجة تقرأ أعلى من ٥ °م. ماذا أفعل؟'), a: L('Re-check after 15 minutes with the probe. If still above 5 °C, move stock to the back-up fridge, record it on the log and tell the shift lead.', 'أعد القياس بعد ١٥ دقيقة بالمجس. إذا بقيت أعلى من ٥ °م انقل المخزون إلى الثلاجة الاحتياطية وسجّل ذلك وأبلغ مشرف الوردية.'), tags: ['fridge', 'temperature', 'ثلاجة'] },
    { id: 'fq4', q: L('The grinder jammed. Can I open it?', 'المطحنة علقت. هل يمكنني فتحها؟'), a: L('Switch it off and unplug it first. Clear the chute with the brush only. Never put fingers near the burrs. Report repeated jams in the maintenance log.', 'أطفئها وافصل الكهرباء أولًا. نظّف المجرى بالفرشاة فقط. لا تقترب بأصابعك من الشفرات. سجّل تكرار المشكلة في سجل الصيانة.'), tags: ['grinder', 'مطحنة'] },
    { id: 'fq5', q: L('A guest asks about allergens.', 'ضيف يسأل عن مسببات الحساسية.'), a: L('Use the allergen chart at the till and answer exactly. If unsure, say so and ask the shift lead. Never guess.', 'استخدم جدول الحساسية عند الكاشير وأجب بدقة. إذا لم تكن متأكدًا قل ذلك واسأل مشرف الوردية. لا تخمّن أبدًا.'), tags: ['allergen', 'حساسية'] },
    { id: 'fq6', q: L('Can I retake a failed quiz?', 'هل يمكنني إعادة اختبار رسبت فيه؟'), a: L('Most quizzes allow up to 3 attempts. The exam page shows how many you have left. If you run out, ask your manager.', 'معظم الاختبارات تسمح بثلاث محاولات. تعرض صفحة الاختبار عدد المحاولات المتبقية. إذا انتهت اطلب من مديرك.'), tags: ['exam', 'retake', 'اختبار'] },
    { id: 'fq7', q: L('What time does opening start?', 'متى يبدأ الفتح؟'), a: L('Arrive 45 minutes before doors open. The opening checklist must be signed before the first order.', 'احضر قبل فتح الأبواب بـ ٤٥ دقيقة. يجب توقيع قائمة الفتح قبل أول طلب.'), tags: ['opening', 'فتح'] }
  );

  db.audit.push(
    { id: 'a3', at: d(-30), actorId: 'u1', actorRole: 'admin', action: 'access.grant', entity: 'user', entityId: 'u5', before: null, after: db.grants.u5, reason: null },
    { id: 'a2', at: d(-50), actorId: 'u3', actorRole: 'ops_manager', action: 'course.version', entity: 'course', entityId: 'c1', before: { version: 1 }, after: { version: 2, note: 'Updated espresso recipe to 18 g in, 36 g out; new grind chart', retrain: false }, reason: null },
    { id: 'a1', at: d(-60), actorId: 'u1', actorRole: 'admin', action: 'access.grant', entity: 'user', entityId: 'u4', before: null, after: db.grants.u4, reason: null }
  );
  db.audit.sort((a, b) => (a.at < b.at ? 1 : -1));
  db.exports.push({ id: 'x0', kind: 'backup', report: null, format: 'json', filters: null, by: 'u2', status: 'succeeded', destination: 'drive', rows: 16, error: null, attempts: 1, startedAt: d(-7), finishedAt: d(-7), driveFile: { name: 'backup-' + day(-7) + '.json', folder: 'Training / Backups' } });
  return db;
}

module.exports = { seedDemo, DEMO_PASSWORD };
