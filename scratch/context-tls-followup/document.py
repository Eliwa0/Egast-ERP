from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
note='''## تحقيق إضافي موجّه: Fast Refresh وTLS — 21 أكتوبر 2026

**القرار: لا يزال غير جاهز للنشر. لم يُغلق أي مانع برمجي في هذه الجولة؛ أُضيف دليل تجريبي لحدود الحل وخطوات تجهيز TLS.** لم تتغير ملفات التطبيق الثلاثة أو عقودها أو قواعد ESLint أو `backend/.env`. تغيّرت هذه الوثيقة فقط، وأُضيفت أدوات وأدلة تحت `scratch/context-tls-followup/`. لم يُنفذ نشر أو migration أو اتصال SAP حي أو أي كتابة أعمال، ولم تُفحص مصادر الميزان أو اختباراته أو executable أو ترجمته.

### ماذا أضاف التحقيق إلى الحالة السابقة؟

اختُبرت البدائل باستخدام **ESLint المثبّت وإعداد المشروع الفعلي دون overrides**، عبر `lintText` على نصوص مستقلة في الذاكرة بأسماء الملفات الثلاثة، دون استبدال المصدر أو إنشاء صفحات وهمية:

| البديل | نتيجة كل واحد من Auth / I18n / Toast | القرار |
|---|---|---|
| Provider وHook في الوحدة نفسها | خطأ Fast Refresh | يطابق السبب الحالي |
| نقل Hook مع إعادة تصديره من المسار القديم | خطأ Fast Refresh | يحفظ الاسم لكنه لا يغلق المانع |
| نقل الاثنين وإعادة تصديرهما صراحةً من المسار القديم | خطأ Fast Refresh | facade لا يحل المشكلة |
| تصدير Provider وحده | يمرّ في التشخيص | يحتاج تحويل مستوردي Hook والتحقق منهم |
| تصدير Hook وحده | يمرّ في التشخيص | يحتاج تحويل مستوردي Provider والتحقق منهم |

**15 assertion تشخيصية ناجحة، exit 0** لا تعني نجاح lint التطبيق: نجاحها يثبت النتائج المتوقعة للبدائل أعلاه فقط. الفحص المباشر للملفات الحقيقية ما زال **3 errors و0 warnings، exit 1**: `AuthContext.jsx:70` و`I18nContext.jsx:47` و`ToastProvider.jsx:78`، كلها `react-refresh/only-export-components`.

لم تُستخدم إعادة تسمية شكلية أو تعطيل قاعدة أو نقل مختلط إلى امتداد لا تفحصه القاعدة. اختبارات النص لا تثبت توافق consumers أو حفظ الحالة أثناء HMR أو صحة Context identity؛ لذلك لم تتحول إلى مبرر لتغيير التطبيق.

### الدليل المطلوب لإصلاح آمن

استيرادات النطاق المسموح موثقة مسبقًا في [قائمة المستهلكين](../scratch/remaining-remediation-20261021/allowed-consumers.json)، وثبات مصادرها مقارنة بالبيان السابق مثبت مجددًا. `App.jsx` يستورد `AuthProvider/useAuth` و`I18nProvider/useI18n` و`ToastProvider` من المسارات الحالية، وعينات مثل `purchase-vendor-lifecycle.jsx` و`select-ux-harness.jsx` تستورد Providers، وبقية القائمة تستورد hooks.

العائق المتبقي محدد: **لا يوجد بيان استيرادات كامل موثوق للنطاق المحمي** يبين هل يستورد Provider أو Hook من هذه المسارات الثلاثة. لم أبحث داخل ذلك النطاق ولم أفترض إمكان تعديله. المطلوب قبل النقل: بيان يقدمه المسؤول عن هذا النطاق، يحتوي مسار المستهلك والمسار المحلول وأسماء الاستيراد/إعادة التصدير من الوحدات الثلاث، بما فيها dynamic imports وأي barrels. لا نحتاج كلمة مرور أو بيانات تشغيل لهذا البيان.

إذا أثبت البيان أن النطاق المحمي يستهلك hooks فقط، يمكن إبقاء hooks بمساراتها ونقل Providers وتعديل مستورديها المسموحين. إن أثبت العكس، يُدرس النقل المعاكس. وإذا كان يستهلك النوعين، يلزم تفويض منفصل لصيانة الاستيرادات المتأثرة أو بقاء المانع. يجب عند التنفيذ مشاركة **كائن Context واحد** لكل Provider/Hook، وعدم إنشاء نسخ Context متباينة، ثم اختبار الهوية ودورة mount/unmount والمصادقة واللغة والتنبيهات وHMR. هذه خطة مشروطة بالأدلة، وليست تعديلًا منفذًا أو طلبًا لإلغاء الحماية.

### TLS: الإعداد الآمن والخطوات اليدوية

الاسم المسؤول هو **`SAP_VERIFY_SSL`**. الفحص الحالي يؤكد أن مصدره `backend/.env` وأن التحقق معطل، دون طباعة الملف أو بيانات الاتصال. `receipt_project/settings.py:9` يستدعي `load_dotenv` دون override؛ لذلك متغير خدمة التشغيل إن وُجد يتقدم على الملف. `sap_service.py:73` يقرأ `_env_bool(..., True)`؛ والسطر 75 يخفي تحذير urllib3 عند التعطيل. الطلبات تمرر `verify=self.verify_ssl`، والناقل المشترك يرسل kwargs إلى `requests.Session.request` دون تصحيح التحقق أو تغييره. لم يُعدّل هذا السلوك في هذه الجولة.

**الإعداد الآمن المطلوب `SAP_VERIFY_SSL=true`**، وليس حذف التحذير أو زيادة المهلة. لم تُطبّق هذه القيمة على التشغيل أو البيئة المحلية؛ يلزم تجهيز الثقة أولًا. لا توجد قيمة REQUESTS_CA_BUNDLE أو CURL_CA_BUNDLE مهيأة في البيئة الحالية أو ملف dotenv المقروء. غياب المتغيرين لا يثبت أن مخزن CA الافتراضي غير كافٍ، ولا يثبت فساد شهادة الخادم؛ السلسلة الحية لم تُفحص.

على مسؤول السيرفر تنفيذ الآتي في بيئة الاختبار المعتمدة، وفق إجراء الإعدادات الخاص بها:

1. تأكيد اسم خادم SAP المعتمد وأن SAN في الشهادة يطابق الاسم المستخدم، مع صلاحية الشهادة وساعة الخادم/العميل.
2. تجهيز سلسلة خادم كاملة، والحصول على CA الجذرية/الوسيطة من مصدر مؤسسي موثوق والتحقق من مصدرها. عند استخدام PKI خاص، تجهيز ملف PEM للثقة بصلاحية قراءة لحساب الخدمة، دون مفاتيح خاصة. لا يُوثق أي ملف لمجرد وروده من endpoint غير متحقق.
3. إبقاء التحقق مفعّلًا بـ`SAP_VERIFY_SSL=true`، وتهيئة `REQUESTS_CA_BUNDLE` إلى **المسار الحقيقي المعتمد** عند الحاجة؛ لم أضع مسارًا تخمينيًا أو أثبت شهادة أو أغيّر مخزن الثقة. Requests يدعم هذا المتغير مع verify=True؛ اختُبر دمج الإعداد محليًا فقط.
4. فحص سلسلة الشهادة واسم المضيف تحت حساب الخدمة وإعداداته الفعلية دون إرسال بيانات اعتماد إلى خادم غير متحقق. بعد إثبات الثقة وتأكيد بيئة الاختبار المصرح بها، يمكن قياس GET المسموح بعينة ثابتة وتسجيل الطلبات وMedian وP95 والأخطاء والمهلات. لا تُشغّل أدوات قد تنشئ SQLQueries أو مستندات SAP بحجة أنها قراءة.

**القياس الحي متوقف:** صفر اتصالات حية؛ Median وP95 والأخطاء والمهلات غير مقاسة. اختبارات الإعداد الأربعة لا تتحقق من شهادة فعلية ولا تحل مشكلة الثقة. لم تُطلب أسرار أو تُحفظ في الأدلة.

### الأوامر والنتائج الجديدة

شُغّلت الأداة التالية من جذر المشروع؛ تحفظ command وcwd وكود الخروج الحقيقي لكل subprocess في [results.json](../scratch/context-tls-followup/results.json):

```powershell
.\\.venv\\Scripts\\python.exe scratch/context-tls-followup/run.py
```

وتشغّل فعليًا:

```powershell
node scratch/context-tls-followup/context-alternatives.mjs
.\\.venv\\Scripts\\python.exe scratch/context-tls-followup/tls-offline.py
# من frontend:
node node_modules/eslint/bin/eslint.js src/contexts/AuthContext.jsx src/contexts/I18nContext.jsx src/components/ui/ToastProvider.jsx
```

| الفحص | النتيجة الفعلية |
|---|---|
| البدائل باستخدام قاعدة المشروع | 15 assertion تشخيصية ناجحة؛ exit 0 |
| TLS دون شبكة | 4 اختبارات ناجحة؛ صفر failure/error/skipped؛ exit 0 |
| ESLint للملفات الثلاثة الحقيقية | 3 errors، صفر warnings؛ exit 1 |

اختبار TLS يستخرج دالة `_env_bool` الحالية من AST دون تحميل Django أو عميل SAP أو قاعدة بيانات، ويختبر default والقيمة الصريحة الآمنة. ويختبر أولوية dotenv ببيانات في الذاكرة ودمج REQUESTS_CA_BUNDLE عبر Requests دون فتح ملف شهادة أو شبكة. مُنع Session.request خلال الاختبارات. هذا نطاق ضيق معلن، وليس اختبار Login أو transport أو certificate chain كاملًا.

لم تُعد مجموعات Node العامة أو المتصفح أو Backend أو build أو الترجمة في هذه الجولة، **لعدم وجود تعديل تطبيق**؛ نتائجها في القسم السابق تاريخية وليست تشغيلات جديدة. لم تُنفذ اختبارات الميزان بأي صورة، أو TLS حي أو قياس SAP أو أجهزة أو نشر أو migration. لم يتغير أي واحد من المدخلات غير المحمية الـ499 عن البصمة السابقة أو أثناء التشغيل: `6fd5b4174d4cec8d504b927c3b31404436ae3e78d1ce294a65dab0a554420e9a`؛ لا يُفهم منها فحص النطاق المحمي أو artifact إنتاجي كامل.

[سلامة المصادر](../scratch/context-tls-followup/integrity.json)، [نتائج البدائل](../scratch/context-tls-followup/context-alternatives.json)، [lint الحقيقي](../scratch/context-tls-followup/context-findings.json)، [TLS دون أسرار](../scratch/context-tls-followup/tls-offline.json).

**القرار النهائي لهذه الجولة:** لم يُنفذ إصلاح غير مثبت. تمنع اعتماد النشر أخطاء Fast Refresh المفتوحة وعدم إثبات إعداد TLS موثوق، إلى جانب إجراءات الإصدار السابقة. إغلاق الأول يحتاج بيان استيرادات النطاق المحمي أو تفويض صيانة منفصل عند الضرورة؛ والثاني يحتاج مسؤول السيرفر لتجهيز/تأكيد سلسلة الثقة والإعداد الآمن. لا يوجد نشر أو موافقة نشر ضمن هذا التقرير.

---

'''
p=ROOT/'docs/CURRENT_VERSION_FOLLOWUP_REVIEW_AR.md';old=p.read_text(encoding='utf-8');head,tail=old.split('\n',1);p.write_text(head+'\n\n'+note+tail.lstrip('\n'),encoding='utf-8')
with (OUT/'git-after.txt').open('wb') as log:subprocess.run(['git','status','--short'],cwd=ROOT,stdout=log)
(OUT/'tools-sha256.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.suffix in {'.py','.mjs'}},indent=2))
print('Follow-up report updated; application files unchanged.')
