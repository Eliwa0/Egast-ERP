# مراجعة ما قبل النشر — receipt_from_production

## تحديث 21 أكتوبر 2026

**غير جاهز للنشر:** أُعيدت الفحوص على نفس النسخة؛ تبقى أخطاء Fast Refresh الثلاثة، وقياس SAP الحي متوقف لعدم إثبات TLS الموثوق. التفاصيل والأوامر والنتائج والاستثناءات في [تقرير الاستكمال](CURRENT_VERSION_FOLLOWUP_REVIEW_AR.md). لم يُنفذ نشر أو تعديل تشغيل أو SAP حي أو اختبارات ميزان. الأقسام التالية نتائج تاريخية محفوظة.

أحدث إعادة تحقق للنسخة الحالية: [تقرير التسليم والجودة والأداء والهوية البصرية](CURRENT_VERSION_HANDOVER_REVIEW_AR.md). أُعيدت الفحوص فعليًا على بصمة `6fd5b417…420e9a`: ‏74 Node و550 Backend، و4 scripts متصفح وlifecycle المورد، و108 حالات بصرية و28 للهيدر ناجحة؛ البناء والترجمة ناجحان، و**lint ما زال 3 أخطاء Fast Refresh**. أُضيف قياس معزول متكرر لخوارزميات القراءة والواجهة؛ لم يُستخدم SAP الحي لأن التحقق من TLS معطّل. لم تُعدّل ملفات التطبيق بهذه الجولة، ولم يحدث نشر أو إجراء تشغيلي؛ الحكم **غير جاهز للنشر**. التفاصيل والاستثناءات والأوامر وأكواد الخروج في التقرير الأحدث، والأرقام أدناه تاريخية.

تحديث الهيدر: أُصلح التفاف أزرار هيدر المبيعات بسبب طول breadcrumb في `sales-readiness.css`. الديسكتوب يحتفظ بالأزرار في صف واحد والمسار ينكمش داخل مساحة العلامة؛ التابلت يحتفظ بصفين محددين، والموبايل يحتفظ بقائمته الحالية. نجحت **28 حالة متصفح** لصفحتي عروض وأوامر البيع باللغتين، عند عروض 320/768/1024/1101/1280/1440/1920، مع إطالة نصوص المسار عمدًا، وثبات ارتفاع الهيدر من 769px فأعلى، وعدم تجاوز الصفحة أو القائمة. [القياسات وبصمة CSS](../scratch/header-layout/results.json)، [نطاق التغيير والأمر](../scratch/header-layout/scope.json). البناء ناجح exit 0: [السجل والنتيجة](../scratch/header-layout/build-result.json). لم تُعد المجموعات العامة لهذا التعديل المحدود في CSS؛ نتائج الجولة السابقة تبقى مرتبطة ببصمتها السابقة، والحكم العام لا يزال غير جاهز للنشر للأسباب الموضحة أدناه.

## آخر نتيجة: المبيعات والتسليم والتسكين — 20 أكتوبر 2026

**غير جاهز للنشر:** أُغلق تحذير مورد عرض الشراء، ووُحّدت بطاقات القوائم والفلاتر وملخصات الكميات ورموز صفحة التسكين. بقيت **3 أخطاء Fast Refresh دون تحذيرات** في نطاق ESLint المعلن؛ لم تُغيّر عقود الـcontexts على نحو غير متحقق منه.

على النسخة المثبتة الجديدة: **74 اختبار Node، و4 scripts متصفح، واختبار lifecycle المورد، و108 حالات بصرية، و550 اختبار PostgreSQL ناجحة**؛ الترجمة والبناء ناجحان وlint ما زال exit 1. أعداد طلبات API متطابقة في 72 حالة قبل/بعد قابلة للمقارنة. لم يحدث نشر أو migration تشغيلية أو كتابة أعمال إلى SAP، ولم يُعدّل نطاق الميزان أو ترجمته أو executable.

الأدلة والبصمة والملفات والصور والحدود في [التقرير التكميلي الأحدث](SALES_VISUAL_PREDEPLOY_REVIEW_AR.md). الأقسام التالية نتائج تاريخية ولا تُجمع أعدادها مع هذه الجولة.

## الجولة الأحدث: ESLint خارج الميزان — 20 أكتوبر 2026

**الحكم: غير جاهز للنشر.** أُغلق 43 بندًا من أصل 47 بندًا سابقًا خارج ترجمة الميزان: 36 خطأ و7 تحذيرات. تبقى **3 أخطاء Fast Refresh وتحذير dependencies واحد**. نتائج الأقسام اللاحقة تاريخية؛ لا تُجمع أعداد جولاتها مع هذه الجولة. لم يُنفذ نشر أو migration تشغيلية أو كتابة أعمال على SAP.

### ما أُصلح

- مراجعة الـbindings غير المستخدمة في صفحات الصرف والاستلام وقواعد الإنتاج ومسودات المشتريات ومكون التخصيص. أُبقي تقييم initializers ونداءات hooks، حتى عند إزالة اسم النتيجة، للحفاظ على ترتيب hooks والآثار الجانبية. مثال: `await approvePostPendingIssue(...)` بقي كما هو دون binding للرد غير المستعمل، وحُذفت معاملات catch غير المستعملة دون تغيير معالجة الخطأ. الدوال المحلية غير المرتبطة بأي مستهلك، مثل handler اعتماد GRPO غير الموصول بالواجهة، أُزيل تعريفها؛ لم يُحذف زر عامل أو مسار خدمة ولم تتغير الصلاحيات. بقيت الاستدعاءات الأخرى وتقييم شرط الصلاحية السابق دون تغيير نتيجة الواجهة.
- احتُفظ بموضع المعامل الثاني غير المستعمل في `getBatchFieldOptions` بواسطة rest tuple به موضع متروك؛ تظل قيمة fallback الثالثة وكل استدعاءات المكونات الحالية بنفس ترتيبها.
- `StatIcon` في إدارة المستخدمين **مستعمل بالفعل في JSX**؛ لم يُحذف. استُخدم `React.createElement(StatIcon, {size:17})` ليظل الرسم نفسه ويصبح الاستخدام واضحًا لقاعدة unused الخاصة بمعاملات الدالة.
- فصل `formatQuantity` و`formatMoney` من صفحة قائمة المبيعات إلى `src/utils/salesDocumentFormatting.js`، وتحديث مستهلك الكمية في تفاصيل المستند. الصفحة أصبحت تصدّر مكونًا فقط. الاختبار الجديد يغطي القيم الفارغة والصفر والنص غير الرقمي والأرقام واسم العملة، مع حفظ تنسيق الأرقام السابق.
- `useCostCenterOptions`: الحالة الأولية تظل loading=true والطلبان يبدأان من effect في الوقت نفسه دون setState متزامن مكرر. إعادة التحميل اليدوية وحدها تضبط loading=true قبل بدء الطلب. استُبدل طابع الساعة بمعرّف `Symbol` مستقل لكل طلب؛ الاختبار أثبت تجاهل الرد الأقدم حتى لو بدأت الطلبات عند القيمة الزمنية نفسها. لا تغيير لمدد المهلة أو retry أو مصدر البيانات.
- اعتمادات hooks: أُضيف `t` إلى callbacks المستخدمة من إجراءات المستخدم في قواعد الإنتاج واستلام الإنتاج؛ أُضيف `itemDescMap` إلى حساب صفوف التصدير؛ أُزيل `statusFilter` من memo لا يستعمله. effect قواعد المستخدم يراقب `user` مع الاحتفاظ بحارس التحميل مرة واحدة، فلا يطلق طلبًا إضافيًا بعد hydration. اشتراك موضع فلتر المراجعة يعتمد على حالة الفتح ومفتاح الفلتر بدل كائن تتغير إحداثياته مع scroll، لتجنب إعادة تركيب الاشتراك عند كل تحديث موضع.

[سجل البنود السبعة والأربعين](../scratch/lint-remediation/review-ledger.json) يبين الملف والسطر الأصلي والقاعدة والسبب والقرار والمستهلكين المباشرين في النطاق المسموح. البحث عن المستهلكين لم يشمل المصادر المحمية. [فرق هذه المهمة عن بدايتها](../scratch/lint-remediation/task-only.diff) يفصل التغييرات عن أعمال المستخدم السابقة؛ لم يُستخدم reset أو checkout أو clean أو staging شامل، ولم تتغير إعدادات ESLint أو تُعطل قواعده.

### البنود الأربعة المفتوحة

| الملف / القاعدة | سبب الإبقاء مفتوحًا |
|---|---|
| `AuthContext.jsx:70` — Fast Refresh | الملف يصدّر provider وhook بعقد استيراد قائم. لم يُفصل العقد جزئيًا مع بقاء مستهلكين محميين لا يمكن فحصهم أو تعديلهم ضمن التفويض الحالي. |
| `I18nContext.jsx:47` — Fast Refresh | نفس مشكلة عقد provider/hook؛ لم تُنقل exports أو تُستبدل استيرادات المستهلكين على نحو غير متحقق منه. |
| `ToastProvider.jsx:78` — Fast Refresh | عقد مشترك بين provider وhook؛ الفصل الآمن يحتاج خطة تحافظ على المستهلكين جميعًا. لم تُضف facade أو استثناء lint لإخفاء الاختلاط. |
| `PurchaseQuotationDraftPage.jsx:537` — exhaustive-deps | `vendorCardCode` و`vendorName` يدخلان fallback داخل `loadDraftData`، وتستدعيه effect. إضافة القيم مباشرةً قد تعيد قراءة المسودة وتستبدل مدخلات المورد أثناء تحريرها؛ إزالة fallback أو تحويله إلى refs يحتاج اختبار دورة حياة أوسع. لم يُجر ذلك دون دليل تكافؤ. |

هذه البنود **لم تُحل**؛ سبب الإبقاء هو حدود التحقق والاعتمادات، وليس إثبات استحالة إصلاحها. لا توجد دعوى بأن lint أصبح ناجحًا أو أن كل callbacks جُرّبت تفاعليًا.

### النسخة ونتائج التحقق

البصمة التجميعية لبيان **497 ملفًا غير محمي**:

```text
8070e3575d2a3f4d6493aa42ddeb4b9b49b76a6a8e8f7193a5fd2703760bc4f2
```

[بيان الملفات](../scratch/lint-remediation/manifest.json)، [فحص سلامة النطاق](../scratch/lint-remediation/integrity.json). شُغلت الفحوص التالية من `scratch/lint-remediation/frozen/`، مع تحقق البصمات قبل التشغيل وبعد كل أمر: **صفر اختلاف في المدخلات المثبتة، وصفر اختلاف بينها وبين مساحة العمل عند فحص النهاية**. التغييرات المنفذة تخص 13 ملفًا سابقًا في الواجهة، مع ملفات formatter واختباره وعينة واختبار دورة حياة مراكز التكلفة وأدوات الأدلة. لم تُعدّل مصادر Backend أو migrations.

المصادر المحمية بقيت dependencies مشارًا إليها من النسخة الاختبارية، دون مراجعة محتواها أو أخذ بصمة محتوى جديدة لها، والاعتماديات من `node_modules` المحلي. لذلك البصمة المذكورة **ليست بصمة artifact إنتاجي مستقل أو إعادة إثبات سلامة الميزان**. تحميل Django والبناء العام يحتاجان تعريفات التطبيقات/المكونات التابعة؛ لا يعني ذلك تشغيل وظيفة أو حالة اختبار ميزان. لم يُفتح executable أو يُشغّل، ولم تتغير بصمته المتوقعة أو آلية تنزيله.

| التحقق | النتيجة الفعلية وكود الخروج |
|---|---|
| ESLint للنطاق المحدد أدناه | **فشل: 3 error و1 warning، exit 1**. [النتيجة](../scratch/lint-remediation/lint-final.json)، [الأمر](../scratch/lint-remediation/quality-results.json). |
| Node: القائمة السابقة غير التابعة للميزان + اختبار formatter | **74 ناجحًا، صفر فاشل أو skipped، exit 0**. [القائمة والأمر](../scratch/lint-remediation/node-results.json)، [السجل](../scratch/lint-remediation/node.log). |
| المتصفح: البحث المشترك، اختيار الصنف، استقلال أمر البيع، دورة حياة مراكز التكلفة | **4 scripts ناجحة، exit 0 لكل منها**. [الأوامر والأزمنة](../scratch/lint-remediation/browser-results.json). |
| PostgreSQL: نفس 550 case ID غير التابعة للميزان في الجولة السابقة، دون اكتشاف حالات محمية | **550 ناجحًا، صفر failure/error/skipped أو HTTP غير متوقع، exit 0**؛ 124.73 ثانية شاملة الإعداد والتنظيف. [تفاصيل الحالات](../scratch/lint-remediation/backend-final.json)، [الأمر](../scratch/lint-remediation/backend-results.json)، [السجل](../scratch/lint-remediation/backend.log). |
| فحص الترجمة المعتاد | **ناجح، exit 0**. [السجل](../scratch/lint-remediation/translations.log). ليس فحصًا جديدًا لمحتوى النطاق المحمي أو تصحيحًا لأخطائه التاريخية. |
| البناء العام | **ناجح، exit 0**. [السجل](../scratch/lint-remediation/build.log). لا يقوم مقام lint أو الاختبارات المحمية غير المنفذة. |

اختبار مراكز التكلفة يستخدم React والـhook الحقيقيين مع GET fixtures محددة، ويراقب عدم وجود أخطاء صفحة. تحقق من طلبين أوليين فقط، وعدم تكرارهما عند إعادة render، وظهور loading عند reload، ورفض الرد القديم عند تثبيت الساعة، وretry واحد محدود عند الفشل مع بقاء بيانات البعد الآخر. نجح أولًا منفصلًا ثم أُعيد بنجاح على النسخة المثبتة. لم يُختبر unmount/remount أو StrictMode لهذا الـhook في هذه الجولة.

أداة PostgreSQL تستعمل قاعدة اختبار محلية عشوائية ومنعًا يفشل الاختبار عند HTTP غير متوقع؛ الرسائل المطبوعة التي تتضمن payloads SAP تخص fixtures، وليست كتابات حية. توجد رسائل audit-log معروفة داخل اختبارات SimpleTestCase في السجل؛ لا توصف السجلات بأنها بلا كل التحذيرات لمجرد نجاح assertions.

### نطاق ESLint والاستثناءات المعلنة

لم تُفتح أو تُعدّل أجزاء `ar.scale` و`en.scale` أو اسم التنقل المحمي في هذه الجولة، ولم يُعد تشغيل أخطاء الترجمة الاثني عشر. لتجنب فحص المحتوى المحمي، **استُبعد ملف `src/i18n/translations.js` المشترك كله من تشغيل ESLint الحالي**، بالإضافة إلى `src/modules/scale/**` والملفات التي تحمل اسم Scale وعينة `responsive-harness.jsx` التابعة له. أُعيدت مجموعة الجودة بعد تدقيق قائمة استبعاد الملفات المحمية على المدخلات المثبتة نفسها. هذا تحديد نطاق للأمر، وليس تعديلًا لإعداد القواعد أو إسقاطًا للأخطاء من التقارير. ويعني أن أجزاء الترجمة غير المحمية داخل هذا الملف لم تخضع لإعادة lint في هذه الجولة أيضًا؛ الملف لم يُعدّل أصلًا. تبقى الأخطاء الاثنا عشر في السجل السابق بوصفها خارج النطاق، ولا يُقال إن العدد الكلي للمشروع أصبح 3 فقط.

لم تُنفذ أي حالات اختبار ميزان، بما فيها الحالات الموجودة في ملفات API مشتركة؛ استُخدمت قائمة IDs السابقة المعلنة مباشرةً. لم تُنفذ scripts الميزان أو ScaleAgent أو التوقيع أو تذكرته، ولا الرحلة الكاملة للمبيعات أو PDF والطباعة أو مصفوفة responsive أو أجهزة فعلية. لم تُختبر كتابة SAP أو قاعدة التشغيل أو خادم النشر أو استعادة backup. اختبارات الـhooks المعدّلة الأخرى تعتمد في هذه الجولة على مراجعة المستهلكين واختبارات المشروع القائمة؛ ليست كلها مغطاة برحلة متصفح مخصصة أو تبديل لغة أثناء كل callback.

الأوامر المنفذة من جذر المشروع بعد تجهيز النسخة، مع خادم Vite محلي على 5194 و`forwardConsole=false` كالجولة السابقة:

```powershell
.\.venv\Scripts\python.exe scratch/lint-remediation/verify.py freeze
.\.venv\Scripts\python.exe scratch/lint-remediation/verify.py node
.\.venv\Scripts\python.exe scratch/lint-remediation/verify.py quality
$env:LINT_ROOT='scratch/lint-remediation/frozen/frontend'
node scratch/lint-remediation/serve.mjs
.\.venv\Scripts\python.exe scratch/lint-remediation/verify.py browser
.\.venv\Scripts\python.exe scratch/lint-remediation/verify.py backend
.\.venv\Scripts\python.exe scratch/lint-remediation/evidence.py
```

أوامر subprocess الدقيقة وcwd والبصمة وكود الخروج محفوظة في `*-results.json`. لم تُنفذ أي خطوة من خطة النشر أو الرجوع أدناه. يلزم إغلاق البنود الأربعة والتحقق منها، وحسم استثناء النطاق المشترك، ثم إعادة الاعتماد على إصدار قابل للتكرار قبل تعديل حكم الجاهزية.

## تحديث معالجة الموانع — 20 أكتوبر 2026

**الحكم الحالي: غير جاهز للنشر؛ أُصلحت أعطال الواجهة المحددة ونجحت اختبارات السلوك المطلوبة، لكن فحص ESLint ما زال فاشلًا.** لا يمثل هذا التحديث موافقة نشر. الأقسام التي تبدأ بـ«المراجعة السابقة» أدناه سجل تاريخي؛ نتائجها لا تُجمع مع أعداد الجولة الحالية ولا تصف حالة الملفات بعد الإصلاح.

### الإصلاحات وحدودها

- `DeliveryWorkflowPanel.jsx`: سحب `lang` من `useI18n` مع `t`. الاختبار الجديد يعرض المكون الحقيقي بمسودة DRAFT وبيانات حالة محلية معلنة، بالعربية والإنجليزية، ويتحقق من نص سياسة المستخدم. هذا عرض SSR معزول؛ ليس رحلة تسليم حية في المتصفح.
- `purchaseQuotationService.js`: إضافة import محلي لـ`loadCostCenters`؛ إعادة التصدير وحدها لا تنشئ binding. لم يظهر مستهلك حالي لـ`loadLocations` في مصادر الواجهة، فحُفظ عقد الدالة المصدرة بدل حذفها. الاختبار يتحقق من طلب GET واحد لمراكز التكلفة بالبعد 1 ومن النتيجة.
- `SearchableSelect.jsx`: استهلاك `selectedLabel` صراحة واستعماله عند وجود قيمة مختارة لا تتوفر ضمن خيارات البحث الحالية. الخيارات المطابقة الفعلية تظل مصدر الاسم عند توفرها. اختبار المتصفح يتحقق من بقاء الاسم المحفوظ ومن عدم وصول `selectedlabel` إلى DOM، إلى جانب الاختيار والبحث المعتادين.
- إضافة `grpo.openTimeoutRetrying` في اللغتين، مع اختبار وجود الرسالتين. أُزيلت التصريحات المكررة المغطاة بقيم لاحقة في **النطاقات غير التابعة للميزان فقط**، مع الاحتفاظ بالقيمة الفعلية الأخيرة. مصدر كتل `en.scale` و`ar.scale` واسم التنقل الخاص به مطابق حرفيًا للبداية: [دليل نطاق الترجمة](../scratch/frontend-remediation/scale-namespace-integrity.json).
- تحديث اختبار مراجعة التحويل للصفحة الحقيقية الحالية ومسارات إعادة التوجيه وطلب سجل الحركة الفعلية. بقيت تغطية بيانات المراحل والمستندات، واختيار bin ومنع الترحيل عند غيابه، وإظهار خطأ SAP، وأضيف فحص bin صحيح وإرجاع DocEntry عند غياب DocNum. جميع الطلبات هنا fixtures؛ لم يحدث ترحيل فعلي.
- إصلاحات lint المحددة: import لـ`process` في أداة Node، export لمكون عينة البحث، إزالة binding غير مستخدم في قالب التسليم واستيراد/متغير غير مستخدمين في مراجعة التحويل، وإزالة escape زائد مكافئ في تعبير البحث. لم تُعطّل قواعد ولم يُستخدم `--fix` شامل.

التغييرات في 13 ملفًا موجودًا، مع إضافة `frontend/scripts/test-predeploy-ui-regressions.mjs` وأدوات الأدلة والتقرير. لم تُغيّر مصادر Backend أو migrations. قائمة الملفات وفرق المهمة عن بدايتها، بما يشمل الملفات غير المتتبعة سابقًا: [سلامة النطاق](../scratch/frontend-remediation/final-integrity.json)، [فرق المهمة](../scratch/frontend-remediation/task-only.diff). فرق Git مع HEAD يحتوي أعمالًا سابقة كثيرة، ولا يمثل حجم هذه المهمة وحدها.

### أسباب اختبارات المتصفح الثلاثة

| الاختبار | السبب المثبت والتصحيح | نتيجة الجولة النهائية |
|---|---|---|
| `test-select-ux-browser.py` | التوقع القديم لنص «at least 2» لا يطابق `useRemoteOptions` الحالي؛ الحد المشترك حرف واحد، وfixture العملاء يرجع نتائج فارغة للحرف الواحد. مصدر بحث الأصناف يعلن browse ويرسل `initial=1`، بينما fixture القديم يرفضه. عُدّل الاختبار ليتحقق من عدم الطلب عند بحث العملاء الفارغ، وطلب الحرف الواحد، والتصفح والترقيم والاختيار والبيانات. لم يُغيّر سلوك البحث في التطبيق لإرضاء التوقع. | exit 0 |
| `test-master-search-workflow-ui.py` | locator يفترض أن اسم الصنف نص مستقل؛ المكون يعرض الأيقونة والاسم داخل `strong`. التحقق الآن داخل صف الكود 270001 نفسه، مع بقاء فحص الاسم والسعر 12.5 بعد الاختيار. | exit 0 |
| `test-sales-order-independent-ui.py` | fixture يفتقد GET `/shipping/deliveries/` الخاص بـ`ShippingDeliveryHandoff`؛ الخدمة تتوقع `operations` ومؤشر الصفحة مباشرة. الرد الناقص تسبب في ReferenceError/TypeError مخفي خلف ErrorBoundary، قبل الوصول للزر. أُضيف رد GET صريح `{operations: [], next_offset: null}`، وبقيت شروط استقلال أمر البيع وعدم إنشاء مسودة تسليم إلا بالإجراء الصريح وعدم الترحيل. | exit 0 |

تغيرت عناوين الخادم فقط لتقبل `TEST_FRONTEND_ORIGIN`؛ لا HTTP أعمال يمر خارج الاعتراض في هذه الاختبارات. قائمة الشحن الفارغة fixture مساعدة، ولم تُجرّب عمليات الميزان أو أي وزن.

### النسخة المجمدة والنتائج الفعلية

جُمّدت **554 مدخلًا** من مصادر وإعدادات وأصول Backend/Frontend، دون ملفات البيئة أو executable، في `scratch/frontend-remediation/frozen-final/`. البصمة التجميعية لبيان الملفات:

```text
f8c9b184202d3dc7f44adb5c31896f6fe64b7b2e7e3e331d5e9452f8e6ea60d4
```

[بيان البصمات الكامل](../scratch/frontend-remediation/frozen-final-manifest.json). تتحقق الأداة من البصمات قبل التشغيل وبعد كل subprocess؛ **صفر تغير في المدخلات المجمدة، وصفر اختلاف بين مصادرها ومصادر مساحة العمل عند فحص النهاية**. الاعتماديات مستعملة من `frontend/node_modules` المحلي عبر junction؛ هذه ليست شهادة بناء مستقل على جهاز آخر أو تثبيت اعتماديات جديد. توثيق النتائج نفسه خارج مدخلات الاختبار.

| الفحص على هذه النسخة | النتيجة الفعلية |
|---|---|
| Node، 5 ملفات `.test.mjs` و18 script، بالتتابع | **73 ناجحًا، 0 فاشل، 0 skipped**؛ exit 0، وتشمل مراجعة التحويل واختبارات الإصلاح الجديدة. [الأمر والقائمة الكاملة](../scratch/frontend-remediation/node-results.json)، [السجل](../scratch/frontend-remediation/node.log). |
| اختبارات المتصفح الثلاثة المطلوبة | **3 scripts ناجحة**، exit 0 لكل منها؛ 10.77 و4.53 و6.02 ثانية. [الأوامر والأزمنة](../scratch/frontend-remediation/browser-results.json). هذه أعداد scripts وليست ثلاث حالات assertion فقط. |
| Backend API على PostgreSQL محلي مستقل | **550 ناجحًا، صفر failure/error/skipped، صفر HTTP غير متوقع**؛ exit 0، زمن الاختبارات 122.799 ثانية، ومع الإعداد والتنظيف 148.64 ثانية. [النتائج لكل اختبار](../scratch/frontend-remediation/backend-final.json)، [الأمر](../scratch/frontend-remediation/backend-results.json)، [السجل](../scratch/frontend-remediation/backend.log). |
| الترجمة | ناجح، exit 0. [السجل](../scratch/frontend-remediation/translations.log). |
| البناء | ناجح، exit 0. [السجل](../scratch/frontend-remediation/build.log). يشمل بناء التطبيق كاملًا واعتمادياته؛ ليس اختبارًا لوظائف الميزان. |
| ESLint، مع استبعاد `src/modules/scale/**` | **فشل: 51 error و8 warning، exit 1**. ملف الترجمة المشترك ما زال يتضمن 12 خطأ duplicate-key داخل نطاق الميزان المحمي؛ لم تُعدّل. [النتيجة الكاملة](../scratch/frontend-remediation/lint-final.json)، [مراجعة كل بند ومصدره](../scratch/frontend-remediation/lint-review-ledger.json). |

لا يوجد `npm test` موحد في المشروع. شُغّلت كل ملفات Node المكتشفة في النطاق المعزول باستثناء القائمة المعلنة: [استبعادات الواجهة](../scratch/frontend-remediation/node-exclusions.json). اكتشاف Django اقتصر على `api`، واستُبعدت اختبارات تعتمد على نطاق الميزان/الوزن أو fixtures الخاصة به، حتى داخل الملفات المشتركة: [كل الأسماء المستبعدة](../scratch/frontend-remediation/backend-exclusions.json). هذه **غير منفذة** وليست skipped أو نجاحات. إنشاء schema التطبيقات التابعة حدث في قاعدة الاختبار العشوائية فقط لتشغيل Django؛ لم تُشغّل حالات اختبار `scale` ولم تُطبق migrations على قاعدة التشغيل.

حُفظت المحاولات غير الناجحة أيضًا:

- أول snapshot: Node ‏72/73 بسبب مقارنة LF حرفيًا بملف CRLF في `test-transfer-stage2-destination-integrity.mjs`. تحقق المصدر أثبت وجود شرط مسح الموقع عند زوال الاختيار؛ أُضيف تطبيع CRLF عند قراءة الاختبار فقط. جُمّدت النسخة النهائية بعد ذلك وأُعيدت مجموعتا Node والجودة بالكامل. [السجل الأول](../scratch/frontend-remediation/first-snapshot-results/node.log).
- أول تشغيل متصفح على النسخة النهائية: نجح اثنان، وفشل اختبار البحث عند assertion الخاص بأخطاء الصفحة، بسبب `@vite/client` الذي يستدعي `ws.send` قبل جاهزية الاتصال عند ترحيل خطأ HTTP التجريبي المتوقع. أُعيد تشغيل خادم الاختبار مع `server.forwardConsole=false` فقط عبر [أداة الخادم](../scratch/frontend-remediation/serve-frozen.mjs)، وبقيت أخطاء الصفحة وconsole في المتصفح وشروط النجاح دون تعطيل. نجحت الثلاثة في الإعادة على **نفس بصمة الملفات**. [النتيجة غير الناجحة محفوظة](../scratch/frontend-remediation/first-snapshot-results/browser-results.json). لم يُغيّر إعداد Vite في التطبيق.

### lint المتبقي وحدود الجاهزية

يتضمن [سجل المراجعة](../scratch/frontend-remediation/lint-review-ledger.json) لكل واحد من البنود الـ59: الملف والسطر والقاعدة والرسالة وسياق المصدر وما بقي دون معالجة. لا يُعتبر السجل إغلاقًا لها:

- 12 مفتاحًا مكررًا في ترجمات الميزان: خارج التعديل صراحةً بطلب المستخدم.
- 5 أخطاء Fast Refresh في وحدات تصدّر المكونات وhooks/helpers معًا: تحتاج فصل عقود الوحدات والتحقق من المستهلكين؛ لم تُخفَ بتعطيل القاعدة.
- خطأ effect في `useCostCenterOptions` بسبب تحديث حالة التحميل المتزامن؛ لم يُثبت اختبار هذه الجولة حلقة render، ولم يُعد تصميم دورة الطلب لمجرد إرضاء lint.
- بقية الأخطاء bindings/handlers/parameters غير مستخدمة في صفحات الإنتاج والاستلام والمشتريات والإدارة. لم تُحذف وظائف أو حالات مستخدم موجودة لمجرد إسكات lint. لا يثبت unused وحده عطل runtime، لكنه يظل إخفاق فحص جودة مفتوحًا.
- 8 تحذيرات dependencies في hooks بصفحات الإنتاج والاستلام والمشتريات؛ تحتاج سيناريوهات دورة الحياة قبل إضافة dependencies قد تغيّر إعادة التحميل. لم تُسوَّ تلقائيًا.

إذن **لم تُعالج جميع بنود lint** في هذه الجولة. أُغلقت الأعطال المحددة واختبارات السلوك المطلوبة؛ يبقى استكمال هذه البنود والتحقق منها قبل أي حكم جاهزية، إلى جانب شروط الإصدار والنسخ الاحتياطي وخطة النشر السابقة. لا يجوز اعتبار نجاح 550 اختبار Backend أو البناء بديلًا عن lint الفاشل.

### أوامر الجولة وما لم ينفذ

من جذر المشروع، بعد تجهيز النسخة المجمدة وjunction الاعتماديات:

```powershell
.\.venv\Scripts\python.exe scratch/frontend-remediation/verify.py node
.\.venv\Scripts\python.exe scratch/frontend-remediation/verify.py quality
node scratch/frontend-remediation/serve-frozen.mjs
.\.venv\Scripts\python.exe scratch/frontend-remediation/verify.py browser
.\.venv\Scripts\python.exe scratch/frontend-remediation/verify.py backend
.\.venv\Scripts\python.exe scratch/frontend-remediation/final-evidence.py
```

كل subprocess له command وcwd وبصمة النسخة وكود الخروج الحقيقي في ملفات `*-results.json`. أداة Backend تستعمل اسم قاعدة PostgreSQL اختبارية عشوائيًا، وتمنع HTTP غير المتوقع بدل الرد عليه بنجاح مصطنع. لم تُجرَ اتصالات قياس SAP حية أو أي كتابة أعمال أو نشر أو تعديل حالة تشغيل.

لم يُنفذ في هذه المهمة: اختبارات الميزان وScaleAgent والتوقيع وتذكرة الميزان والتنزيل والبصمة؛ لم يُفتح executable أو يُستبدل أو تتغير آلية تنزيله. مصادر الميزان الـ56 التي شملها بيان البداية لم تتغير. لم تُعد اختبارات PDF والطباعة أو الرحلة الكاملة للمبيعات أو المصفوفة الشاملة للشاشات/الصلاحيات/اللغات؛ نجاح SSR في اللغتين لا يقوم مقامها. لم تُشغّل اختبارات live أو السياسات المحذوفة أو سكربتات CDP ذات الجلسة الثابتة. أسماء scripts Python غير المنفذة في [فحص النهاية](../scratch/frontend-remediation/final-integrity.json). لم تُختبر أجهزة حقيقية أو بيئة النشر أو استعادة backup. لا توجد دعوى نجاح تلك السيناريوهات في النسخة النهائية.

## المراجعة السابقة — محفوظة للتاريخ

التاريخ: 20 أكتوبر 2026. المرجعان: [تقرير الاستقرار](STABILITY_REMEDIATION_REPORT_AR.md)، و[سجل الإخفاقات الأصلية](STABILITY_FAILURE_ROOT_CAUSES_AR.md).

## الحكم: غير جاهز للنشر حاليًا

إصلاحات الاستقرار نجحت مجددًا على PostgreSQL، والـmigrations قابلة للتطبيق والرجوع في قاعدة اختبار. لكن فحص الواجهة الأوسع ليس ناجحًا: اختبار مراجعة التحويل يتوقف عند استيراد ملف محذوف، وESLint وفحص الترجمة يفشلان، وثبتت أخطاء ReferenceError إضافية في كود الواجهة. لذلك لا يكفي اعتماد نتائج Django والبناء وحدهما للسماح بالنشر.

هذه **مراجعة وتحقق فقط**. لم أعدّل كود التطبيق أو الموديلات أو الاختبارات الأصلية أو migrations أو الملف التنفيذي. لم تُطبق migrations على قاعدة التشغيل، ولم يحدث نشر أو اعتماد أو ترحيل أو كتابة أعمال إلى SAP. أضفت أدوات وأدلة المراجعة داخل `scratch/predeploy/` وهذا التقرير فقط، مع استخدام قواعد اختبار مستقلة. رُصدت تعديلات متزامنة أخرى في الواجهة أثناء المراجعة؛ فُصلت أدناه ولم تُرجَع أو تُنسب إلى مهمة الاستقرار.

## نطاق تغييرات مهمة الاستقرار

قورنت حالة Git الحالية ببيان تسليم الاستقرار وبصماته؛ **كل ملفات البيان الثلاثين مطابقة**. راجعت الحالة غير المجهزة والمجهزة في Git، وفرق المهمة عن snapshot بدايتها. الاعتماد على `git diff HEAD` وحده لا يكفي: ملفات التطبيق والـmigrations المطلوبة كثيرة منها غير متتبعة أصلًا، وهي موجودة على القرص ولكن لن تدخل إصدارًا مبنيًا من Git ما لم تُضمَّن عمدًا. لم أعمل staging أو commit أو reset أو checkout أو حذف لتعديلات المستخدم.

تتوزع ملفات الاستقرار إلى **4 ملفات تطبيق/موديل، و2 migration، و18 ملف اختبار، و3 أدوات، و3 تقارير**. القائمة الكاملة أدناه؛ «موجود» يعني أنه كان موجودًا في snapshot بداية الاستقرار، حتى لو كان Git يعتبره untracked.

| File | Category | Existed at stability start |
|---|---|---|
| `backend/api/models_delivery.py` | application/model | yes |
| `backend/api/services/delivery_posting_service.py` | application/model | yes |
| `backend/scale/release.py` | application/model | new |
| `backend/scale/services/deployment_service.py` | application/model | yes |
| `docs/APPLICATION_PERFORMANCE_IMPLEMENTATION_AR.md` | documentation | yes |
| `docs/STABILITY_FAILURE_ROOT_CAUSES_AR.md` | documentation | new |
| `docs/STABILITY_REMEDIATION_REPORT_AR.md` | documentation | new |
| `backend/api/migrations/0065_delivery_one_active_order.py` | migration | new |
| `backend/api/migrations/0066_alter_transferwarehouserule_stage.py` | migration | new |
| `backend/audit_stability_failures.py` | review tool | new |
| `backend/measure_sap_readonly.py` | review tool | new |
| `backend/run_stability_tests.py` | review tool | new |
| `backend/api/tests.py` | test | yes |
| `backend/api/tests_cold_storage_outbound_api.py` | test | yes |
| `backend/api/tests_cold_storage_outbound_e2e.py` | test | yes |
| `backend/api/tests_delivery_creation_concurrency.py` | test | new |
| `backend/api/tests_delivery_workflow.py` | test | yes |
| `backend/api/tests_pending_transfer_posting_concurrency.py` | test | yes |
| `backend/api/tests_persisted_transfer_policy.py` | test | yes |
| `backend/api/tests_physical_transfer.py` | test | yes |
| `backend/api/tests_production_issue.py` | test | yes |
| `backend/api/tests_sales_quotation_currency.py` | test | yes |
| `backend/api/tests_sales_scope_regressions.py` | test | yes |
| `backend/api/tests_stage2_policy_positions.py` | test | yes |
| `backend/api/tests_transfer_policy.py` | test | yes |
| `backend/api/tests_transfer_policy_authority.py` | test | yes |
| `backend/api/tests_transfer_policy_migration.py` | test | yes |
| `backend/scale/tests.py` | test | yes |
| `backend/scale/tests_deployment.py` | test | yes |
| `backend/scale/tests_release_deployment.py` | test | yes |

الدليل: [مقارنة بيان التسليم](../scratch/predeploy/stability-delivery-check.json)، [حالة Git عند بداية المراجعة](../scratch/predeploy/git-status-before.txt)، [فرق الملفات المجهزة](../scratch/predeploy/git-staged-stat.txt)، [فرق المهمة بعد توحيد نهايات الأسطر للعرض فقط](../scratch/predeploy/stability-normalized.diff). لم تُوحَّد نهايات الأسطر في ملفات المصدر.

**تغييرات متزامنة خارج بيان الاستقرار:** فحص نهاية المراجعة رصد تغير `frontend/src/App.jsx` و`frontend/src/contexts/I18nContext.jsx` و`frontend/src/modules/transfer/components/ColdStorageMap.jsx` و`frontend/src/modules/transfer/pages/TransferPage.jsx`، وإضافة `frontend/src/components/common/ErrorBoundary.jsx`. تشمل إضافة ErrorBoundary حول المسارات، وحراسة لقيمة مسار الترجمة، وحراسات بيانات خريطة التخزين، واستيراد MapPin. لم تنتج من أوامر تعديل هذه المراجعة، ولم ألمسها. بقيت ملفات تسليم الاستقرار الثلاثون مطابقة لبصماتها. [فروق التغييرات المتزامنة](../scratch/predeploy/concurrent-changes.diff)، [فحص البصمات المؤرخ](../scratch/predeploy/final-integrity.json).

أُعيد **البناء فقط** بعد اكتشاف هذه التغييرات ونجح، exit 0؛ [السجل](../scratch/predeploy/build-current.log). الاختبارات الوظيفية السابقة لا تُعتمد تلقائيًا للتغييرات التي وصلت بعدها، ولم تُعد كل مجموعات الاختبارات على snapshot مجمدة من هذه الحالة الأحدث. يلزم تثبيت الإصدار وإعادة التحقق، وبخاصة التحويل والترجمة والمسارات والتعامل مع أخطاء العرض؛ وجود ErrorBoundary لا يغني عن التأكد من ظهور المحتوى الصحيح.

## migrations وبيانات قاعدة التشغيل المتاحة

الفحص اتصل بقاعدة PostgreSQL المكوّنة للمشروع في هذه البيئة، داخل transaction ينفذ `SET TRANSACTION READ ONLY`، وأكد الخادم `transaction_read_only=on`. هذه نتيجة القاعدة المتاحة هنا، وليست تأكيدًا على أي خادم نشر آخر لم يُحدد أو يُفحص.

- PostgreSQL **16.13**؛ آخر migration مطبق للتطبيق `api` هو `0064_quality_grade_category`.
- الخطة غير المطبقة تحتوي **0065 ثم 0066 فقط**؛ لا فروع متعارضة في graph.
- المسودات النشطة وقت الفحص: **0**؛ مجموعات الأوامر ذات أكثر من مسودة نشطة: **0**. لم تُحذف بيانات ولم تتغير حالات مسودات. يجب إعادة الفحص داخل نافذة النشر بعد إيقاف الكتابات لمنع سباق بين الفحص وإنشاء القيد.
- index الخاص بالقيد الجديد غير موجود حاليًا، كما يُتوقع قبل تطبيق 0065. وجود الكود الجديد وحده لا يفعّل الحماية الذرية في قاعدة التشغيل.

[نتائج الفحص للقراءة فقط](../scratch/predeploy/database-readonly.json).

| migration | الاعتماد | SQL على PostgreSQL | الأثر والرجوع |
|---|---|---|---|
| `0065_delivery_one_active_order` | `api.0064_quality_grade_category` | `CREATE UNIQUE INDEX delivery_one_active_order` على `sales_order_doc_entry` بشرط حالات DRAFT/PENDING_REVIEW/APPROVED/POSTING | يفرض قاعدة منع التكرار الموجودة بالخدمة. يرفض بيانات مكررة بدل تغييرها. الرجوع يزيل index فقط. |
| `0066_alter_transferwarehouserule_stage` | `api.0065_delivery_one_active_order` | **no-op** | يحدّث حالة choices التاريخية لتوافق Stage 4/5 الموجودة بالفعل في الموديل؛ لا SQL يغير الصفوف أو الصلاحيات على PostgreSQL. الرجوع يعيد حالة migration السابقة فقط. |

0065 يستخدم إنشاء index عاديًا داخل transaction، **وليس CONCURRENTLY**؛ إنشاء الفهرس قد يحجب INSERT/UPDATE/DELETE أثناء التنفيذ. لا يوجد تقدير زمني لنشره تحت حمل حقيقي. يلزم إيقاف الكتابات وميزانية انتظار أقفال معتمدة ومراقبتها، لا تشغيله عشوائيًا أثناء العمل.

أُنشئت قاعدة PostgreSQL محلية مستقلة باسم عشوائي `test_predeploy_*`، وجُرّبت الحالات التالية فعليًا:

1. الرجوع إلى 0064، وإنشاء صفين اختباريين نشطين لنفس الأمر: فشل 0065 بـIntegrityError، وبقي الصفان ولم تسجل migration كأنها نجحت.
2. معالجة **صف الاختبار فقط**، ثم تطبيق 0065 و0066: نجحا ورفض القيد إضافة مسودة نشطة منافسة.
3. الرجوع إلى 0064: أُزيل القيد دون تغيير صفوف الاختبار أو حالاتها؛ ثم أُعيد تطبيق 0065 و0066 بنجاح.
4. `makemigrations --check --dry-run`: `No changes detected`. أُزيلت قاعدة الاختبار بعد الانتهاء.

[سجل التجربة](../scratch/predeploy/migration-rehearsal.log)، [الخطوات المثبتة](../scratch/predeploy/migration-rehearsal.json)، [SQL 0065](../scratch/predeploy/0065_delivery_one_active_order.sql)، [رجوع 0065](../scratch/predeploy/0065_delivery_one_active_order-reverse.sql)، [SQL 0066](../scratch/predeploy/0066_alter_transferwarehouserule_stage.sql).

المحاولة الأولى لأداة التجربة توقفت قبل الاتصال بسبب تحميل متغيرات البيئة بعد قراءة بيانات الاتصال؛ صُححت أداة المراجعة فقط ثم أُعيدت التجربة بنجاح. [السجل الأول محفوظ](../scratch/predeploy/migration-rehearsal-initial.log)، ولا يُحسب اختبار migration ناجحًا.

## المشكلات المؤكدة والمتبقية

| الأولوية | المشكلة المثبتة | الأثر والتوصية قبل النشر |
|---|---|---|
| مانع | `frontend/src/components/delivery/DeliveryWorkflowPanel.jsx:531` يستخدم `lang` بينما hook في السطر 124 يسحب `t` فقط | أُعيد إنتاج **ReferenceError: lang is not defined** عند عرض مسودة DRAFT في المكون الحقيقي، بحالة محلية معلنة دون HTTP. المكون متصل بمسار تفاصيل التسليم. يلزم إصلاح محدد واختبار حالة المسودة في اللغتين؛ لم أعدّل التطبيق هنا. |
| متوسطة | `frontend/src/services/purchaseQuotationService.js:52`: `loadLocations()` يستدعي `loadCostCenters` دون binding محلي؛ إعادة التصدير في نهاية الملف ليست import | أُعيد إنتاج **ReferenceError: loadCostCenters is not defined** عند استدعائها. لم أجد مستهلكًا حاليًا لـ`loadLocations` في `frontend/src`؛ الأثر التشغيلي الفوري غير مثبت، لكن الدالة المصدرة معطلة ويجب معالجة العقد أو حذفها وفق قرار مستقل. |
| مانع تحقق | `frontend/scripts/test-transfer-review.mjs:47` يستورد `TransferReviewOperationsPage.jsx` غير الموجود | مجموعة Node تنتهي بكود 1. `App.jsx` يربط `/transfer-review` مباشرة بالصفحة الحالية، والمساران الفرعيان يحولان إليها. يلزم تحديث الاختبار للعقد الحالي مع الاحتفاظ بتغطية المراجعة، دون إنشاء صفحة وهمية. |
| مانع تحقق | ثلاثة اختبارات متصفح إضافية فشلت عند assertions | التفاصيل أدناه. يجب حسم توافق التوقعات والـfixtures مع الكود، والتحقق من سيناريو فقد ظهور الصنف والوصول لإجراء التسليم، قبل اعتبارها قديمة أو اعتبار الواجهة سليمة. لم تُغيّر توقعاتها لإنجاحها. |
| متوسطة | `npm run lint`: **76 error و12 warning** | ليست كلها أعطال runtime؛ منها إعداد Node globals وunused وReact hooks، ومنها خطآ الواجهة المثبتان أعلاه. التفاصيل كاملة في السجل، ولم يُستخدم `--fix` أو يُخفَ أي بند. |
| متوسطة | `npm run i18n:check` يفشل للمفتاح `grpo.openTimeoutRetrying` في اللغتين؛ استدعاؤه في `GRPOPage.jsx:106` | الدالة `t` الحالية لا تطبق النص الثاني كـfallback للمفتاح المفقود، فتُرجع اسم المفتاح. يلزم ترجمة صريحة واختبار رسالة مهلة GRPO. |
| منخفضة | `SalesQuotationCreatePage.jsx:868` يمرر `selectedLabel`؛ `SearchableSelect.jsx:88,368` لا يستهلكه وينشر `...rest` إلى MUI/DOM | يفسر تحذير React المثبت في الجولة السابقة وفي سجل Vite. التوصية إصلاح عقد الخصائص أو الاستدعاء مع الحفاظ على عرض الاختيار؛ لا يوجد دليل أنه يوقف العملية وحده. لم يُخفَ التحذير. |
| شرط إصدار | ملفات أساسية، منها ملفات الاستقرار، غير متتبعة في Git | يجب تجميد artifact كامل ومراجع يتضمن تعديلات المشروع السابقة اللازمة. لا تنشر HEAD أو patch الاستقرار وحده بافتراض احتوائه على التطبيق الحالي، ولا تستخدم `git add .` عشوائيًا مع ملفات البيئة والـscratch. |
| مانع اعتماد الحالة الأحدث | تغيرت ملفات واجهة أثناء المراجعة بعد بعض تشغيلات الاختبار | البناء الأحدث ناجح، لكن لا توجد إعادة كاملة على نسخة مجمدة تشمل تلك التغييرات. تُحفظ النتائج حسب توقيت وبصمة النسخة، لا تُقدّم كاعتماد شامل للكود المتغير. |

[إعادة إنتاج خطأي runtime](../scratch/predeploy/source-reproductions.json) تستخدم كود المكونات والخدمات نفسه، مع state وAuth/I18n fixtures معلنة، وتمنع أي HTTP. هذه إعادة إنتاج معزولة وليست ادعاء تجربة المسار كاملًا مع بيانات SAP.

عند مراجعة مسار Docker الموجود: `docker-compose.yml` و`backend/Dockerfile` يشغّلان Django بـ`runserver`، وسياق البناء هو `./backend`، ولا يوجد `backend/.dockerignore` بينما Dockerfile ينفذ `COPY . .`. لذلك تجاهل `backend/.env` الموجود في `.dockerignore` بجذر المشروع لا يحمي هذا السياق؛ ملف البيئة قد يدخل الصورة إذا بُنيت بهذه الملفات. كذلك ملف ScaleAgent خارج سياق backend ولا يوجد له mount في compose؛ يجب توفير مسار الملف المعتمد صراحة في artifact/التشغيل إذا اختير Docker. **لم تُبنَ صورة Docker أو تُختبر هذه التهيئة كنشر إنتاجي**؛ هذه ملاحظات على المسار الموجود، وليست افتراضًا أن خادم النشر يستخدمه.

## الاختبارات المنفذة ونتائجها

لا يوجد `npm test` في `frontend/package.json`، ولا runner واحد يجمع كل اختبارات المتصفح القديمة. اكتُشفت اختبارات Django في `api` و`scale`، واختبارات Node `.test.mjs` وscripts، وسكربتات متصفح مستقلة. فُصلت تلك الفئات بدل اعتبار البناء أو 75 حالة Node تغطية لكل الواجهة.

| التحقق | النتيجة الفعلية والدليل |
|---|---|
| Django: `backend/run_stability_tests.py --postgres`، مع اختبار Chrome مفعّل | **786 ناجحًا، صفر failure/error/skipped، وصفر HTTP غير متوقع**، exit 0، في 159.06 ثانية شاملة إعداد القاعدة وتنظيفها. [النتائج](../scratch/predeploy-backend-postgres.json)، [الأمر وكود الخروج](../scratch/predeploy/backend-command.json)، [السجل](../scratch/predeploy/backend.log). |
| Node: 5 ملفات `.test.mjs` و20 script معزولًا، بالتتابع | **75 حالة: 74 ناجحة وواحدة فاشلة، صفر skipped**، exit 1. [الأمر بكل الملفات](../scratch/predeploy/frontend-command.json)، [السجل](../scratch/predeploy/frontend.log). الفشل هو استيراد صفحة مراجعة التحويل المحذوفة، ولم تُلغَ assertions لتحويله إلى نجاح. |
| التوقيع والأزرار وتذكرة الميزان | **8 مجموعات ناجحة في الفاتح و8 في الداكن**، exit 0 لكل منهما؛ تشمل الاستعادة والمسح والتدوير/DPR ومقاسات اللمس ومعاينة قالب التذكرة الحقيقي ببيانات مصطنعة. [فاتح](../scratch/predeploy/signature-light/responsive-browser-regressions.json)، [داكن](../scratch/predeploy/signature-dark/responsive-browser-regressions.json). |
| طباعة المستندات | **36 PDF ناجحًا**: عروض البيع وأوامر البيع والتسليم × لغتين × 1/10/55 صفًا × طولي/عرضي A4. فُحصت الصفوف والإجماليات والمخزن وأرقام المستند المتكررة وخط Cairo داخل PDF. [النتائج](../scratch/predeploy/print/results.json)، [السجل](../scratch/predeploy/print.log). ليست تجربة طابعة فعلية. |
| تفاعلات متصفح مع APIs معزولة | **100 حالة ناجحة، صفر سيناريو فاشل**: اللغتان والوضعان، 390×320 و1440×900؛ التنقل وبطاقات مسودات الميزان وحوار أجهزته وأوامر البيع والتسليم وخطوات التحميل الأساسية ومعاينة الطباعة. [التفاصيل](../scratch/predeploy/interactions/predeploy-interactions.json). الكتابات خارج fixtures مرفوضة؛ اكتشاف الشحن له رد تجريبي فقط. |
| البناء `npm.cmd run build` | نجح، exit 0. [السجل](../scratch/predeploy/build.log). لا يحل محل أي اختبار فاشل. |
| `npm.cmd run lint` | فشل، exit 1، **88 بندًا: 76 error و12 warning**. [السجل](../scratch/predeploy/lint.log). |
| `npm.cmd run i18n:check` | فشل، exit 1، مفتاح واحد مفقود في العربية والإنجليزية. [السجل](../scratch/predeploy/i18n.log). |
| تجربة migrations والرجوع | 5 خطوات تحقق ناجحة، exit 0؛ التفاصيل في قسم migrations. |

**اختبارات المتصفح الإضافية: ثلاثة منفذة، صفر ناجح، ولا skipped.** [نتائج الخروج](../scratch/predeploy/extra-browser-results.json):

| الاختبار | التوقف الفعلي | التفسير وحدود الاستنتاج |
|---|---|---|
| `test-select-ux-browser.py:131` | يتوقع `at least 2` بينما المعروض `Search by name, description or code` | اختلاف نص مثبت. لا يثبت هذا assertion وحده أن الحد الأدنى للبحث لا يعمل؛ بقية السيناريو لم يكتمل. [السجل](../scratch/predeploy/test-select-ux-browser.py.log). |
| `test-master-search-workflow-ui.py:74` | لم يظهر `Fixture Fruit` بعد خطوة إضافة الصنف | فشل تفاعل حقيقي في الاختبار. السبب بين بيانات fixture/عقد الواجهة وسلوك اختيار الصنف **لم يُحسم** في المراجعة؛ لا يُصنف نجاحًا ولا يُرفض باعتباره قديمًا تلقائيًا. [السجل](../scratch/predeploy/test-master-search-workflow-ui.py.log). |
| `test-sales-order-independent-ui.py:81` | لم يظهر زر `Create Delivery Note in SAP` المتوقع | يحتاج مراجعة عقد سير التسليم والـfixture والوصول للإجراء. لم يُضغط زر ترحيل حقيقي ولم يحدث اتصال أعمال. [السجل](../scratch/predeploy/test-sales-order-independent-ui.py.log). |

المحاولة الأولى لهذه الثلاثة لم تصل إلى assertions بسبب عنوان محلي ثابت 5189؛ صُححت **نسخ أدوات المراجعة** إلى 5188، ثم أعيدت وظهرت الإخفاقات أعلاه. [المحاولة الأولى محفوظة](../scratch/predeploy/extra-initial/extra-browser-results.json). لم تتغير scripts الأصلية أو شروط النجاح.

الجولتان الأوليان لـDjango شغّلتا 786 اختبارًا: **785 ناجحًا واختبار متصفح واحد error**، دون skipped أو HTTP غير متوقع. لم تُهملا: [الأولى](../scratch/predeploy/backend-first.log)، [الثانية](../scratch/predeploy/backend-second.log). تشخيص المتصفح أثبت أن Vite يعيد `504 Outdated Optimize Dep` لملفات React ويترك body فارغًا؛ [الدليل](../scratch/predeploy/browser-bootstrap-diagnostic.json). أُعيد تشغيل Vite مع `--force` دون تعديل مصدر، ثم نجحت المجموعة الكاملة. لم يُعدّل اختبار الانتظار لإخفاء الخطأ، ولم يُعتبر تشغيل توقيع عالق نجاحًا.

### الاستلام والتحويل والميزان: ما الذي تغطيه النتائج؟

المجموعة النهائية تشمل 50 حالة في `api.tests` (الاستلام وGRPO وغيرها)، و41 لصرف الإنتاج، و14 للتحويل الفعلي، و5 لتزامن ترحيل التحويل و6 لتزامن إنشائه، و7 لسلامة وجهة المرحلة الثانية، و9 لـdestination bins، و15 للمرحلة الخامسة، و92 في `scale.tests` و37 للتغليف و4 لبصمة التنزيل. هذه الأعداد أجزاء من الـ786 وليست مجموعات إضافية تُجمع معها. [كل المجموعات وأعدادها](../scratch/predeploy/backend-module-counts.json).

اختبارات Node شملت GRPO navigation وخدمات صرف الإنتاج والتحويل الفيزيائي وbin ومواقع التخزين والمرحلة الخامسة ومراقب الميزان. لا تعني اختبارات الخدمة أو SSR تجربة كل خطوة لمس في معالج الاستلام، ولا يغطي نجاح تذكرة الميزان كل قوالب الطباعة الأخرى.

## ScaleAgent

أُعيد فحص الملف الموجود دون تشغيله أو استبداله أو تغيير expected hash:

```text
SHA-256: DF4A8921C03CAA8C52D4F10D50863ED5B4EA2B56DA7EC5B45DE716F2787B1163
FileVersion / ProductVersion: 1.0.1
Bytes: 20,580,447
Authenticode: NotSigned
```

يطابق pin المعتمد سابقًا من المستخدم، وتغطي اختبارات Django بصمة الملف الفعلي داخل ZIP ورفض الملف المختلف أو pin غير الصالح. [نتائج بيانات الملف](../scratch/predeploy/scaleagent.json). اعتماد البصمة ليس شهادة توقيع أو تدقيقًا أمنيًا لمحتوى executable، ولم تُجرب قراءات جهاز أو TCP/COM فعلي.

## أوامر التحقق التي شُغلت

من جذر المشروع، الأدوات التالية موجودة ضمن أدلة هذه المراجعة:

```powershell
.\.venv\Scripts\python.exe scratch/predeploy/inspect_database.py
.\.venv\Scripts\python.exe scratch/predeploy/rehearse_migrations.py
.\.venv\Scripts\python.exe scratch/predeploy/run_checks.py frontend
.\.venv\Scripts\python.exe scratch/predeploy/run_checks.py backend
```

الأداة الأخيرة تضبط قاعدة PostgreSQL اختبارية عشوائية و`QUOTATION_CURRENCY_BROWSER_URL=http://127.0.0.1:5188` وتشغّل `backend/run_stability_tests.py --postgres`. أداة Frontend تشغّل `node --test --test-concurrency=1` بالقائمة الكاملة المحفوظة في JSON، مع فصل اختبارات CDP عن Node runner. يُسجل exit code الحقيقي للـsubprocess، لا تُستنتج النتيجة من رسائل PowerShell stderr.

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5188 --strictPort --force
npm.cmd run build
npm.cmd run lint
npm.cmd run i18n:check
```

بدأ Chrome مع profile جديد ومنفذ Debugging مستقل 9899، وتحققت جاهزيته من `/json/version` قبل اختبارات CDP. شُغلت نسخ مراجعة من scripts الموجودة؛ التغيير فيها محصور في **منفذ الخادم أو مسار إخراج الأدلة** دون تغيير assertions أو كود التطبيق. [بيان النسخ](../scratch/predeploy/browser-adapters.json).

```powershell
$env:AUDIT_ORIGIN='http://127.0.0.1:5188'
$env:AUDIT_CHROME_PORT='9899'
$env:AUDIT_THEME='light'
node scratch/predeploy/signature-light.mjs
$env:AUDIT_THEME='dark'
node scratch/predeploy/signature-dark.mjs
.\.venv\Scripts\python.exe scratch/predeploy/print-check.py
$env:VERIFY_ORIGIN='http://127.0.0.1:5188'
$env:VERIFY_SIZES='390x320,1440x900'
$env:VERIFY_OUTPUT='predeploy-interactions'
.\.venv\Scripts\python.exe scratch/predeploy/interactions-check.py
node scratch/predeploy/reproduce-source-findings.mjs
.\.venv\Scripts\python.exe scratch/predeploy/extra_browser_checks.py
```

## خطة نشر قابلة للرجوع — لم تُنفذ

1. **إغلاق الموانع أولًا:** إصلاح ReferenceError في شاشة التسليم، ومعالجة الدالة المعطلة واختبار التحويل القديم وفحص الترجمة وبنود lint، ثم إعادة الاختبارات المتأثرة والمجموعات العامة. توثيق أي استثناء معتمد بدل وصف فحص فاشل بأنه ناجح. معالجة `selectedLabel` مع اختبار بقاء الاختيار ظاهرًا.
2. **تجميد إصدار قابل للتكرار:** تحديد خادم وطريقة النشر ومسؤول القرار. إعداد artifact كامل ببصمة/معرّف إصدار، يشمل تعديلات المشروع السابقة المطلوبة والـmigrations والواجهة وملف ScaleAgent المعتمد. الاحتفاظ بالإصدار السابق وملف إعداداته الآمن منفصلًا. لا ترفع `.env` أو profiles أو سجلات `scratch` التي قد تحتوي بيانات اختبار إلى حزمة التشغيل.
3. **نسخة احتياطية وتجربة الاستعادة:** قبل النافذة، إعداد PostgreSQL backup معتمد، والتحقق من استعادته على قاعدة منفصلة؛ لم تُجرّب استعادة backup التشغيل في هذه المراجعة. حفظ نسخة إعدادات وملفات التشغيل اللازمة وفق سياسة المؤسسة. لا يكفي نجاح rollback لقيد تجريبي بدل تحقق الاستعادة.
4. **نافذة صيانة وموافقة صريحة:** إيقاف قبول كتابات التطبيق وكل worker يمكنه إنشاء/تغيير مسودات التسليم، وانتظار اكتمال المعاملات الجارية. إعادة فحص duplicates بالقراءة فقط على **قاعدة النشر المحددة**. إن ظهرت مجموعة مكررة، التوقف وإحالتها للمراجعة؛ لا حذف ولا تغيير حالات تلقائيًا. مراجعة `migrate --plan`، وموارد/أقفال PostgreSQL وحدود انتظار معتمدة.
5. **بعد الموافقة والإجراء المعتمد فقط:** تشغيل migrations بإصدار الكود الجديد في نافذة الصيانة؛ الأمر المخطط `python manage.py migrate api 0066_alter_transferwarehouserule_stage --noinput`. الخطة يجب أن تتضمن 0065 ثم 0066 فقط كما جرى فحصها، وإلا يُعاد تقييمها. **لم يُشغَّل هذا الأمر على التشغيل في المراجعة**.
6. **تحقق قبل فتح الكتابات:** تأكيد وجود index وشرطه وسجل migrations، ثم تشغيل artifact الجديد وإخراج فحوص قراءة للتنقل والمصادقة/الصلاحيات وقوائم التسليم والطباعة وتنزيل ZIP الميزان وبصمته. تبقى معاملات SAP الحقيقية خارج اختبار الشكل؛ أي UAT كتابة لاحق يحتاج إجراءً واعتمادًا مستقلين. فتح الخدمة تدريجيًا بعد قبول المسؤول.

### الرجوع

- عند فشل migration أو smoke test، تبقى الكتابات متوقفة. 0065 atomic: لا يُفترض تطبيقه من نجاح بدء الأمر؛ تُراجع نتيجة الأمر وسجل migrations ووجود index. لا استخدام `--fake` أو تعديل الصفوف لإجبار النجاح.
- الرجوع المفضل عند مشكلة كود فقط هو استعادة artifact السابق **مع إبقاء قيد منع التكرار إن ثبت توافق الإصدار السابق معه**. تظل الخدمة في الصيانة حتى التأكد من تعامل الإصدار السابق مع التعارضات؛ لا تُفتح الكتابات اعتمادًا على التخمين.
- إذا تقرر رجوع schema أيضًا، وبعد موافقة مستقلة ومراجعة graph الفعلي: الأمر المخطط `python manage.py migrate api 0064_quality_grade_category --noinput` يرجع 0066 ثم 0065. جُرّب ترتيب الرجوع في قاعدة الاختبار ولم يغير صفوفها، لكنه **يزيل حماية السباق**؛ لا يُعدّ إصدارًا تشغيليًا آمنًا تلقائيًا. تُراجع الحاجة لإصلاح أو استمرار الصيانة قبل فتح الكتابات.
- عند الحاجة لاستعادة backup: لا استعادة تلقائية بعد وجود عمليات تشغيل جديدة، خصوصًا إن قابلتها معاملات SAP؛ يلزم حصرها ومطابقتها واعتماد الاستعادة. لم تُنفذ restore أو rollback تشغيلي هنا.

## ما لم يُختبر صراحةً

- خادم النشر النهائي وإعداد خدمته ونسخة backup التشغيل واستعادتها، ونشر Docker أو reverse proxy/TLS أو حمل الأقفال تحت مستخدمين فعليين.
- ميزان فعلي، ملف ScaleAgent أثناء التشغيل، TCP/COM، هاند هيلد وباركود ولوحة مفاتيح وطابعة فعلية.
- كتابة مستندات أو اعتماد/ترحيل أو تغيير بيانات SAP؛ لم تُشغّل أدوات UAT الحية أو scratch scripts التي يمكن أن تنفذها.
- جميع الشاشات وكل خطوات الأعمال وكل الصلاحيات مع بيانات SAP الحقيقية. تفاعلات هذه المراجعة عينات محددة وfixtures؛ ليست إعادة لمصفوفة responsive الكاملة السابقة.
- كل قوالب استلام الإنتاج والباتشات والإيصالات والطباعة الحرارية أو مقاسات الورق؛ المنفذ هو تذكرة الميزان بالعينة و36 PDF للمستندات المذكورة.
- السكربتات القديمة `test-click-traceability.mjs` و`test-print-render.mjs` و`test_modal.mjs`: تعتمد عنوانًا/جلسة ثابتين ولا تضمن عزل الشبكة. استخدمت بدائل الطباعة والتفاعلات المعزولة دون الادعاء بتشغيل تلك الملفات.
- `test-transfer-policy-ui.py` يفترض وحدة/واجهة السياسات المحذوفة، و`test-master-search-live.py` و`test-sales-direct-pagination.py` غير معتمدة هنا كتجارب معزولة؛ لم تُشغّل. `test-master-search-backend.py` runner بديل لمجموعة فرعية مغطاة بالمجموعة النهائية، ولم يُشغّل منفصلًا. `test-sales-journey-browser.py` لم يُنفذ في هذه الجولة؛ نجاح 100 تفاعل لا يقوم مقام رحلته الكاملة.

فحص النهاية حفظ بصمات البداية والتغييرات المتزامنة وحالة Git اللاحقة؛ [دليل سلامة النطاق](../scratch/predeploy/final-integrity.json). لم يطرأ تعديل على ملفات تسليم الاستقرار الثلاثين، ولم تُحذف تعديلات موجودة. يتطلب الانتقال من هذا الحكم إلى السماح بالنشر معالجة الموانع وتجميد نسخة وإعادة فحوصها ثم موافقة النشر؛ التقرير نفسه ليس موافقة أو تنفيذًا للنشر.
