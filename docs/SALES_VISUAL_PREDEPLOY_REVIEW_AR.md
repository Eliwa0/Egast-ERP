# إغلاق تحذير المورد وتوحيد عرض المبيعات والتسكين

التاريخ: 20 أكتوبر 2026. مكمل لـ[مراجعة ما قبل النشر](PREDEPLOY_REVIEW_AR.md)، مع الاحتفاظ بكل الأدلة السابقة.

**الحكم: غير جاهز للنشر.** أُغلق تحذير dependencies الخاص بعرض الشراء باختبار دورة حياة فعلي، ونُفذت تعديلات العرض واختباراتها. بقيت **3 أخطاء Fast Refresh** في وحدات Auth/I18n/Toast؛ لم تُغيّر عقودها جزئيًا أو تُخفَ أخطاؤها. لا نشر، ولا migrations تشغيلية، ولا كتابة أعمال إلى SAP.

## النطاق والنسخة

فُحصت حالة Git، وحُفظت مصادر الواجهة المسموح بها في `scratch/sales-unification/before.zip` وبصمات بداية المهمة؛ لم تُرجع أو تُستبدل أعمال المستخدم السابقة. يشمل ذلك تغييرات موجودة قبل هذه المهمة في App وLogin وغيرها، ولا تنسبها هذه الجولة لنفسها. لا staging شامل أو أوامر Git مدمرة.

البصمة التجميعية لـ**499 ملفًا غير محمي** في النسخة الاختبارية:

```text
b95a39ef3497ebaeff504850e17fcd05e732af0fb0c93b32a4201140fbe64715
```

[بيان الملفات](../scratch/sales-unification/manifest.json)، [فحص النهاية](../scratch/sales-unification/integrity.json)، [فرق المهمة فقط](../scratch/sales-unification/task-only.diff). تحقق مشغّل الاختبارات من البصمات قبل التشغيل وبعد كل subprocess؛ لم يتغير أي مدخل مثبت، ولم يختلف مصدر مساحة العمل عن نسخته المثبتة عند فحص النهاية.

هذه بصمة مدخلات النطاق المسموح، **وليست بصمة artifact إنتاجي مستقل**: مصادر النطاق المحمي بقيت dependencies مشارًا إليها دون مراجعة محتواها أو إعادة بصمتها، وnode_modules من التثبيت المحلي. البناء العام وتحميل Django يحتاجان تعريفات التطبيقات التابعة، لكن لم تُختَر أو تُشغّل وظائف أو حالات اختبار الميزان. لم تُعدّل مصادر Backend أو migrations أو ملف الترجمة المشترك أو Pricing Wizard أو ملف الميزان التنفيذي وآلية تنزيله.

## موانع الجودة

### تحذير مورد عرض الشراء: مغلق

في `PurchaseQuotationDraftPage.jsx` كان `loadDraftData` يقرأ state المورد في fallback، وكانت إضافة هذه القيم لاعتمادياته ستربط تحميل المسودة بإدخال المورد. كذلك كانت العملة ضمن الاعتماديات، مع إمكان تغييرها عند اختيار المورد.

أُبقي fallback إلى refs المتزامنة وsessionStorage المرتبط بالمسودة؛ حُذف اعتماد القراءة على state لا لزم له بعد إثبات السلوك. اختيار المورد كان يحدّث state وrefs معًا بالفعل. العملة المستخدمة في fallback تُقرأ من ref متزامن مع حالتها، وأصبح callback التحميل يعتمد على معرف المسودة فقط. توجد علامة طلب مستقل وحماية من الرد القديم، ومراجعة تحرير للمورد تمنع الرد الذي بدأ قبل تعديل المستخدم من استبدال المورد/عملته. غلاف بمفتاح `draftId` يفصل حالة كل مسودة عند التنقل بينها؛ لم يُضف تغيير لحقول المستند أو endpoint أو payload.

اختبار Chrome يستخدم الصفحة والـproviders والـrouter الفعلية، مع observer يضيفه **خادم الاختبار فقط** للوصول للحالة والمعالجات القائمة. لا observer أو واجهة تشخيص مضافة إلى التطبيق. يحاكي PATCH الحفظ داخل fixture محلية، ولا يمرر HTTP إلى خدمات الأعمال. أثبت:

1. تحميل المسودة الطبيعي بطلب واحد داخل العينة المستقلة.
2. تعديل المورد والعملة وبقاء التعديل بعد إعادة العرض الناتجة عن الحفظ.
3. عدم زيادة GET للمسودة بسبب هذا التعديل.
4. إطلاق GET إضافي واحد عند Refresh الصريح، وبقاء المورد المحفوظ.
5. عدم استبدال تعديل أحدث برد تحميل سابق مؤجل.
6. الانتقال عبر router إلى مسودة أخرى فارغة دون تسرب مورد المسودة السابقة، مع طلب واحد للمسودة الجديدة.

[نتيجة الحالات والطلبات](../scratch/sales-unification/vendor-lifecycle.json)، [الأمر وكود الخروج](../scratch/sales-unification/vendor-results.json). العينة مستقلة دون StrictMode؛ المحاولة الأولى داخل App التطويري سجلت طلبين أوليين بسبب StrictMode، فلم تُعتمد كتوقع «طلب واحد». لا يدعي الاختبار إزالة التكرار التشخيصي في StrictMode؛ قياس صفحات التطبيق قبل/بعد منفصل ومعلن أدناه. لم تُخفَّض assertions عدد الطلبات لتمرير الاختبار.

### أخطاء Fast Refresh: مفتوحة

| الوحدة | السبب والحدود |
|---|---|
| `AuthContext.jsx` | provider وhook بعقد استيراد مشترك قائم. |
| `I18nContext.jsx` | provider وhook، مع الحفاظ على عقد الترجمة والمستهلكين الحاليين. |
| `ToastProvider.jsx` | provider وhook للإشعارات بعقد مشترك. |

المستهلكون المسموحون موثقون في [سجل الجولة السابقة](../scratch/lint-remediation/review-ledger.json). لا يمكن إثبات سلامة فصل كل المستهلكين ضمن هذا التفويض مع حظر فحص المصادر المحمية؛ لذلك لم يُنفذ فصل جزئي أو facade أو استثناء لقواعد ESLint. يلزم حل يحافظ على جميع المستهلكين واختبارهم قبل إغلاق هذه البنود. هذا مانع مفتوح، لا ادعاء استحالة الإصلاح.

تشغيل ESLint الحالي يستبعد مجلد الميزان وملفاته وعينته المحمية وملف `translations.js` المشترك كله، كما توضح الأوامر المسجلة. **الـ12 duplicate-key التاريخية في ترجمة الميزان لم تُعالج أو تُعد فحصها.** الأجزاء غير المحمية داخل الملف المشترك لم تُعد lint أيضًا؛ لم يُعدّل الملف في هذه المهمة. لم تُغيّر قواعد ESLint أو تُستخدم `--fix` شاملة.

## الهوية البصرية والمسارات

| الشاشة | المسار الأساسي |
|---|---|
| عروض البيع | `/customization-delivery/quotations` |
| أوامر البيع | `/customization-delivery/orders` |
| التسليم | `/customization-delivery/deliveries` |
| التسكين داخل الحاوية | `/shipping-loading`؛ ومسار `/transfer/shipping` يحوّل إليه |

المراجع المشاهدة فعليًا هي `/production` و`/quality`: PageHeader وcard-panel وأزرار app-button ورموز الألوان والحدود والأنصاف من `global.css`. راجعت كذلك أن تفاصيل أنواع المستندات تستعمل أصلًا `SalesDocumentDetailPage` وجدول `cd-table` المشترك؛ لم أستبدل جدولًا قائمًا أو أغيّر أعمدته أو بياناته لمجرد التشابه.

الفروق قبل/بعد:

- القوائم كانت تستخدم نفس رأس الصفحة، مع تكرار inline لتخطيط البطاقات ونصف قطر 12px، ومسافات متراكبة بين toolbar والبطاقات. أصبحت البطاقات الثلاث تستخدم `SalesDocumentCard` المبني على card-panel، مع الاحتفاظ بالحد المميز للأمر الذي لديه كمية متبقية، ونفس الأطفال والأزرار والبيانات. استُبدلت أنماط الفلاتر المكررة بفئات مشتركة داخل CSS الموجود.
- أصبح توزيع بطاقات القوائم واحدًا، وتلتف ملخصات الكميات إلى أعمدة تناسب المساحة. صورة 320px السابقة كانت تقسم كلمات Delivered/Remaining داخل أعمدة ضيقة؛ الصورة اللاحقة تعرضها دون تقسيم مماثل إلى حروف متفرقة. الكميات وحساب نسبة الإنجاز لم تتغير.
- صفحة التسكين كانت تستخدم `--color-surface` و`--color-primary` مع fallbacks ثابتة، وألوان تنبيه وخلفيات فاتحة مستقلة. أُعدلت القواعد نفسها لاستخدام `--bg-elevated` و`--border` و`--primary` ودرجات الحالة القائمة و`--radius-*`، وتقييد الشبكة بالحاوية، وإزالة الهوامش الداخلية المزدوجة للصفحة. لم تُضف طبقة overrides في نهاية الملفات، ولم يتغير JS صفحة التسكين أو خطواتها أو منطق الحفظ والتحميل.
- ظلت عناوين المراحل ونصوص التشغيل والحالات وأزرارها محفوظة. لم تُضف قوائم داخل Pricing Wizard أو تُعدّل مصادره.

[مقارنة AST للقوائم](../scratch/sales-unification/presentation-equivalence.json) تؤكد بقاء المصادر مكافئة خارج خصائص العرض واسم غلاف البطاقة والاستيراد الخاص به. هذا دليل محدود على نطاق التغيير، وليس بديلًا عن اختبارات التفاعل أو دليلًا مستقلًا على صحة قواعد الأعمال كلها.

## الملفات التي تغيرت

| الملف داخل frontend | السبب |
|---|---|
| `src/pages/PurchaseQuotationDraftPage.jsx` | lifecycle المورد وحماية الردود القديمة وفصل حالة المسودات. |
| `src/pages/SalesQuotationsPage.jsx` | غلاف البطاقة والشبكة والفلاتر المشتركة؛ دون تغيير handlers. |
| `src/pages/SalesOrdersPage.jsx` | نفس الغلاف والفلاتر وملخص كميات مرن. |
| `src/pages/DeliveriesPage.jsx` | نفس العرض لكل من بطاقات الأوامر ومسودات التسليم. |
| `src/components/ui/SalesDocumentCard.jsx` — جديد | غلاف عرض مشترك يستخدم card-panel؛ بلا state أو HTTP. |
| `src/styles/pages/customization-delivery.css` | قواعد موحدة للقوائم داخل الملف القائم. |
| `src/styles/pages/shipping-loading.css` | استعمال رموز الهوية القائمة وتقييد تخطيط التسكين. |
| `scripts/fixtures/purchase-vendor-lifecycle.jsx` — جديد | عينة اختبار مستقلة للصفحة والـproviders الفعلية؛ ليست مستوردة من التطبيق. |

أدوات المراجعة وصورها وسجلاتها في `scratch/sales-unification/`. لم تُعدّل استيرادات المستهلكين المحميين أو عقود الـcontexts لإسكات lint.

## الاختبارات الفعلية على النسخة المثبتة

| التحقق | النتيجة وكود الخروج |
|---|---|
| Node | **74 ناجحًا، صفر فاشل أو skipped؛ exit 0**. [القائمة والأمر](../scratch/sales-unification/node-results.json). |
| المتصفح: scripts البحث والاختيار واستقلال أمر البيع ومراكز التكلفة | **4 scripts ناجحة؛ exit 0 لكل منها**. [الأوامر](../scratch/sales-unification/browser-results.json). يشمل اختبار أمر البيع نافذة النجاح وعدم إنشاء تسليم إلا بالإجراء الصريح، ضمن fixtures. |
| lifecycle المورد الجديد | **ناجح؛ exit 0**. [النتائج](../scratch/sales-unification/vendor-results.json). |
| المصفوفة البصرية/التفاعلية | **108 حالات مكتملة؛ exit 0**، دون خطأ صفحة أو console warning/error أو تجاوز أفقي في الحالات النهائية. [كل الحالات والصور والطلبات](../scratch/sales-unification/after-visual.json)، [الأمر](../scratch/sales-unification/visual-results.json). |
| Backend PostgreSQL مستقل | **550 ناجحًا، صفر failure/error/skipped، وصفر HTTP غير متوقع؛ exit 0**. [الحالات](../scratch/sales-unification/backend-final.json)، [الأمر](../scratch/sales-unification/backend-results.json). نفس IDs غير التابعة للميزان، دون اكتشاف حالات محمية. |
| ESLint للنطاق المعلن | **3 error و0 warning؛ exit 1**. [النتيجة](../scratch/sales-unification/lint-final.json). |
| الترجمة | **ناجح؛ exit 0**. [السجل](../scratch/sales-unification/translations.log). |
| البناء العام | **ناجح؛ exit 0**. [السجل](../scratch/sales-unification/build.log). |

[أوامر الجودة وأكواد الخروج](../scratch/sales-unification/quality-results.json). كل أمر له cwd وبصمة النسخة وكود subprocess الفعلي، ولا يُستنتج النجاح من رسائل PowerShell. الرسائل التي تطبعها اختبارات Backend عن payloads تخص mocks/fixtures، ولا تعني مرور عمليات إلى SAP. بقيت رسائل audit-log الخاصة بإعداد بعض SimpleTestCase في السجل؛ لا يُوصف السجل كله بأنه خالٍ من التحذيرات.

المصفوفة النهائية: **العربية والإنجليزية × الفاتح والداكن × 320×640 و768×900 و1440×900**، لكل من المسارات الأربعة والمراجع الاثنين، إضافة إلى:

- `/customization-delivery/quotations/documents/1001`
- `/customization-delivery/orders/documents/2002`
- `/customization-delivery/delivery/documents/2002`

أي 48 حالة للمسارات الأربعة، و24 للمراجع، و36 للتفاصيل. داخل الحالات المقابلة اختُبر فتح تبويب مسودة التسليم، والانتقال في التسكين من اختيار الأمر إلى اختيار العربية ثم ظهور الحاوية المحفوظة ومدخل المسح؛ لا حفظ بيان أو إرسال أو تجربة وزن. تحققت جداول التفاصيل من ظهور الصنف التجريبي؛ التمرير المقصود داخل الجدول لا يُعد تجاوزًا للصفحة.

قبل التعديل اكتملت **72 حالة** للمسارات الأربعة والمراجع فقط: [النتائج](../scratch/sales-unification/before-visual.json)، [السجل](../scratch/sales-unification/before-visual.log). التفاصيل لها لقطات بعد فقط. عُرضت صور مختارة يدويًا للمقارنة؛ بقية المصفوفة خضعت للـassertions والتقاط الصور، وليس ادعاء مشاهدة يدوية لكل صورة.

أمثلة:

- [أمر بيع قبل، 320 إنجليزي فاتح](../scratch/sales-unification/images/before-en-light-320-customization-delivery_orders.png)، [بعد](../scratch/sales-unification/images/after-en-light-320-customization-delivery_orders.png).
- [التسكين قبل، 320 إنجليزي داكن](../scratch/sales-unification/images/before-en-dark-320-shipping-loading.png)، [بعد اختيار الحاوية](../scratch/sales-unification/images/after-en-dark-320-shipping-loading-container.png). الثانية خطوة مختلفة لتوضيح التخطيط، وليست مقارنة محتوى متطابق؛ [نفس خطوة البداية بعد](../scratch/sales-unification/images/after-en-dark-320-shipping-loading.png).
- [التسليم عربي 320](../scratch/sales-unification/images/after-ar-light-320-customization-delivery_deliveries.png)، [عرض بيع إنجليزي 1440](../scratch/sales-unification/images/after-en-light-1440-customization-delivery_quotations.png).

أول محاولة لفحص التفاصيل توقفت لأن locator `.cd-table` يطابق جدول المسودة وجدول المستند معًا؛ صُحح لتحديد الجدول المحتوي على الصنف. ثم أظهرت عينة مسودة التسليم تحذير key لأن fixture افتقد `line.id` الذي يستعمله المكون الحقيقي، فأُضيف المعرف إلى fixture. لم يُعدّل التطبيق أو تُخفَ console warnings لهذه الأسباب؛ المصفوفة الكاملة النهائية أُعيدت بعد التصحيح. السجلات التشخيصية موجودة في `after-focused-visual.log` و`details-focused.log`.

## الطلبات والأداء

في **72 حالة قابلة للمقارنة** تطابقت أعداد أزواج method/path لطلبات الأعمال الأولية تمامًا قبل/بعد: [المقارنة الكاملة](../scratch/sales-unification/api-comparison.json). طلب اكتشاف الشحن POST له رد fixture صريح ولا يمر إلى Backend؛ باقي الفحص البصري GET فقط، ولا يختبر ترحيلًا. طلبات التفاعلات اللاحقة مسجلة منفصلة عن القراءة الأولية.

هذا قياس عدد طلبات ببيانات معزولة، **وليس قياس سرعة SAP أو زمن شبكة إنتاجي أو برهان تكافؤ محتوى كل رد**. لم تُجر قياسات SAP حية أو تحسينات أداء جديدة. لا تُنسب الأزمنة المتأثرة بتشغيل المصفوفة والاختبارات بالتوازي إلى تحسن التطبيق.

## أوامر الجولة وحدود الاعتماد

من جذر المشروع، بعد تجهيز النسخة والاعتماديات المحلية:

```powershell
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py freeze
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py node
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py quality
$env:REVIEW_ROOT='scratch/sales-unification/frozen/frontend'
node scratch/sales-unification/serve.mjs
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py browser
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py vendor
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py visual
.\.venv\Scripts\python.exe scratch/sales-unification/verify.py backend
.\.venv\Scripts\python.exe scratch/sales-unification/evidence.py
```

قبل التعديل شُغّل `visual.py before` على خادم مساحة العمل. خادم الاختبار النهائي يستعمل `forwardConsole=false` لمنع مشكلة ترحيل console الخاصة بـVite، مع بقاء أخطاء الصفحة وconsole assertions في المصفوفة؛ لم تُعدّل إعدادات التطبيق.

لم يُختبر صراحةً: الميزان وScaleAgent واختباراتهما أو التوقيع أو تذكرته أو التنزيل والبصمة؛ خطوات الوزن/خصومات الوزن/إرسال بيان الحاوية أو حفظه؛ كل حالات المستندات والصلاحيات والحوارات؛ كل خطوات Pricing Wizard؛ الطباعة وPDF والطابعة الفعلية؛ القياسات الحية والكتابة على SAP؛ الأجهزة الحقيقية والباركود؛ بيئة النشر أو backup واستعادته. fixture قائمة عروض البيع ليست اختبار تكافؤ حساباتها المالية مع SAP، وبيانات الوزن في لقطات التسكين لا تمثل قراءة جهاز أو تحقق وزن. المصفوفة ليست اعتمادًا لكل المقاسات أو لكل رحلة أعمال.

إغلاق تحذير المورد ونجاح الاختبارات والتوحيد البصري في الحالات المعلنة لا يغلق أخطاء Fast Refresh الثلاثة أو فجوة إعادة lint للملف المشترك المحمي. تبقى النسخة **غير جاهزة للنشر** إلى أن تُحسم هذه الموانع ويُعتمد إصدار كامل قابل للتكرار. لم يُنفذ أي إجراء تشغيلي.
