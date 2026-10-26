import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((OUT/'manifest.json').read_text());before=json.loads((OUT/'start-hashes.json').read_text())
visual=json.loads((OUT/'after-visual.json').read_text(encoding='utf-8'))
assert len(visual)==108 and all(not r['horizontal_overflow'] and not r['errors'] and not r['console'] for r in visual)
backend=json.loads((OUT/'backend-final.json').read_text())
assert backend['run']==550 and not any(backend[k] for k in ['failures','errors','skipped','unexpected_http'])
(OUT/'tool-manifest.json').write_text(json.dumps({p.name:sha(p) for p in OUT.iterdir() if p.suffix in {'.py','.mjs'}},indent=2))
integrity={'snapshot_sha256':manifest['sha256'],'frozen_drift':[k for k,h in manifest['files'].items() if sha(OUT/'frozen'/k)!=h], 'workspace_drift':[k for k,h in manifest['files'].items() if not (ROOT/k).exists() or sha(ROOT/k)!=h], 'task_source_changes':[k for k,h in before.items() if not (ROOT/k).exists() or sha(ROOT/k)!=h], 'protected_sources_reviewed':False,'live_sap_connections':0}
(OUT/'integrity.json').write_text(json.dumps(integrity,indent=2))
with (OUT/'git-after.txt').open('wb') as log:subprocess.run(['git','status','--short'],cwd=ROOT,stdout=log)
lint=json.loads((OUT/'lint-final.json').read_text());findings=[{'file':r['filePath'].replace(str(OUT/'frozen')+'\\',''),'line':m['line'],'rule':m['ruleId'],'message':m['message'],'severity':m['severity']} for r in lint for m in r['messages']]
(OUT/'remaining-findings.json').write_text(json.dumps(findings,indent=2))
rows=[]
for phase in ['node','quality','browser','vendor','header','visual','backend']:
 for r in json.loads((OUT/(phase+'-results.json')).read_text()):rows.append(f"| `{r['name']}` | {r['exit_code']} | {r['seconds']} |")
assert not any(integrity[k] for k in ['frozen_drift','workspace_drift','task_source_changes'])
report='''# استكمال مراجعة النسخة الحالية — 21 أكتوبر 2026

**الحكم: غير جاهز للنشر.** نجحت الفحوص السلوكية المعاد تنفيذها، لكن أخطاء Fast Refresh الثلاثة باقية، واتصال SAP الآمن غير مثبت. لم يُنفذ نشر أو migration على التشغيل أو اتصال SAP حي أو كتابة أعمال. لم يُعد تنفيذ تحسين أداء أو تغيير تصميم سابق.

## الملفات والقرار

لم يتغير أي ملف تطبيق أو إعداد أو اختبار أصلي في هذه الجولة. الإضافات أدوات وأدلة داخل `scratch/remaining-remediation-20261021/` وهذا التحديث للتقارير. حُفظت حالة Git قبل العمل وبعده، بما فيها أسماء الملفات غير المتتبعة؛ لم يُستخدم reset أو checkout أو clean أو staging. مقارنة 499 مدخلًا غير محمي ببداية المهمة وبالنسخة المختبرة لم تُظهر اختلافًا. لا تمثل هذه المقارنة فحص محتوى النطاق المحظور أو كل ملف شخصي خارج البيان.

## Fast Refresh: سبب بقاء البنود مفتوحة

| الملف | العقد الحالي والسبب المثبت |
|---|---|
| `AuthContext.jsx:70` | يصدّر AuthProvider وuseAuth، والأخير ليس مكونًا. |
| `I18nContext.jsx:47` | يصدّر I18nProvider وuseI18n، والأخير ليس مكونًا. |
| `ToastProvider.jsx:78` | يصدّر ToastProvider وuseToast، والأخير ليس مكونًا. |

قاعدة `react-refresh/only-export-components` مفعّلة بإعداد Vite الحالي. روجعت استيرادات المستهلكين المتاحة فقط: App يستورد Providers وhooks من المسارات الحالية، وعينات الاختبار تستورد Providers، وصفحات ومكونات أخرى تستورد hooks. القائمة ذات الملف والسطر محفوظة في [allowed-consumers.json](../scratch/remaining-remediation-20261021/allowed-consumers.json).

نقل hook مع تغيير مستورديه يحتاج مراجعة المستهلكين المحميين الممنوع فحصهم؛ والإبقاء على إعادة تصديره من ملف Provider يُبقي العقد المختلط سبب الخطأ. نقل Provider بدلًا منه يتطلب إثبات عدم وجود مستهلك Provider ضمن النطاق غير المفحوص. لا توجد قائمة تبعيات كاملة مستقلة تثبت ذلك. لذلك لم يُنفذ فصل جزئي أو إعادة تصدير للتحايل على الفحص، ولم تتغير القواعد أو أسماء الصادرات. هذا عائق توافق غير محسوم، وليس عطل runtime مثبتًا أو ادعاء استحالة الإصلاح. إغلاقه يحتاج اعتماد فحص تبعيات الاستيراد المحمية أو بيانًا موثوقًا شاملًا لها؛ لم يُفحص هذا النطاق هنا.

## TLS وقياس SAP

الإعداد الفعّال `SAP_VERIFY_SSL` مصدره **backend/.env** وقيمته تعطّل التحقق؛ لا override موروث في العملية الحالية. `receipt_project/settings.py:9` يحمّل dotenv دون override، و`api/services/sap_service.py:73` يقرأ القيمة مع default آمن true. عند التعطيل يخفي السطر 75 تحذير InsecureRequestWarning، وتُمرر القيمة إلى طلبات Login والقراءة وغيرها عبر الناقل المشترك. إعادة استخدام الاتصال لا تصلح الثقة في الشهادة.

لم يوجد إعداد REQUESTS_CA_BUNDLE أو CURL_CA_BUNDLE في العملية أو ملف البيئة المقروء. هذا **لا يثبت وحده فساد شهادة الخادم أو غياب CA عن مخزن الثقة الافتراضي**؛ سلسلة الخادم نفسها لم تُجلب ولم تُتحقق. لم تُعرض URL أو شركة أو اسم مستخدم أو كلمة مرور أو token أو بيانات شهادة حساسة. لم يتغير ملف البيئة أو إعداد الإنتاج، ولم يُضف verify=False أو بديل له.

المطلوب من مسؤول SAP: تأكيد endpoint المعتمد، شهادة صالحة تطابق hostname/SAN، وتقديم سلسلة الخادم الكاملة وCA الجذرية/الوسيطة الموثوقة وطريقة توزيعها المعتمدة. بعد تجهيز الثقة، يُفعّل التحقق في بيئة الاختبار بإجراء معتمد، ثم تُختبر السلسلة واسم الخادم مع التحقق الإلزامي قبل جلسة قياس مصادق عليها. لا يجوز استعمال مجرد إخفاء التحذير أو نجاح الطلب غير المتحقق كإثبات.

**قياسات SAP الحقيقية غير منفذة:** عدد الاتصالات الحية في هذه الجولة صفر؛ Median وP95 والأخطاء والـTimeouts غير مقاسة، وليست صفرًا. لم تُكرر fixtures أو benchmarks المحلية باعتبارها بديلًا. تصريح القراءة السابق لا يلغي شرط سلامة TLS الجديد. [الدليل الآمن](../scratch/remaining-remediation-20261021/tls-safety.json).

## النسخة والفحوص المعاد تنفيذها

البصمة التجميعية للـ499 مدخلًا غير محمي:

`''' + manifest['sha256'] + '''`

هي نفسها البصمة السابقة: لا فرق تطبيق مثبت يستلزم إعادة تحسين. تُفحص البصمات قبل التشغيل وبعد كل subprocess. النطاق المحمي والاعتماديات المشتركة مراجع تشغيل موجودة دون مراجعة محتواها أو بصمات جديدة؛ لذلك هذه **ليست بصمة artifact إنتاجي مستقل كامل**. البناء العام وتحميل Django يستخدمان تعريفات التبعيات؛ لم تُختَر أو تُشغّل حالات اختبار الميزان أو ScaleAgent.

| الأمر الفرعي الفعلي | كود الخروج | الزمن بالثواني |
|---|---:|---:|
'''+'\n'.join(rows)+'''

الأوامر الكاملة وcwd وأزمنة التشغيل والبصمة محفوظة في ملفات `*-results.json` داخل [مجلد الأدلة](../scratch/remaining-remediation-20261021/). لا يكفي exit البناء بدل نجاح اختبار آخر.

- Node: 74 ناجحًا، صفر فاشل أو skipped؛ نفس القائمة المسموحة السابقة.
- المتصفح: 4 scripts ناجحة للبحث والاختيار واستقلال أمر البيع وlifecycle مراكز التكلفة، بالإضافة إلى script المورد: التحميل والتعديل دون GET زائد وRefresh ورفض الرد القديم وتبديل المسودة.
- التصميم: 108 حالات على 9 مسارات، لغتان ووضعان وعروض 320/768/1440 وارتفاع 640/900؛ والهيدر 28 حالة باللغتين على عرض 320/768/1024/1101/1280/1440/1920 مع مسار طويل. النتائج تخص fixtures والمسارات المحددة، ولا تعني اختبار كل الشاشات.
- Backend: 550 حالة API محددة على PostgreSQL اختبارية معزولة؛ لا اكتشاف لحالات الميزان. النتائج التفصيلية في backend-final.json؛ لا كتابة SAP، وHTTP غير المتوقع يجعل التشغيل يفشل.
- ESLint: 3 errors، صفر warnings؛ لا تحسن عددي عن الجولة السابقة، ولم تُخفَ النتائج.
- الترجمة: 1772 مفتاحًا مسموحًا في اللغتين، ناجح. استُخدمت نسخة أداة خارج التطبيق تُبقي شروط missing/empty/raw كما هي، وتستبدل مسح المجلد العام بقائمة البيان المسموحة وتستبعد مفاتيح الميزان. لم يُشغّل الماسح العام على مصادر محمية. تحميل وحدة الترجمة المشتركة لحل المفاتيح المسموحة تبعية تنفيذ فقط؛ لم تُراجع كتل ar.scale/en.scale أو تُعدّل. هذا نطاق أضيق من الفحص العام السابق، فلا يُسوّى به دون ذكر الفرق.

## ما لم يُنفذ وشروط التسليم

لم يُفحص أو يُعدّل executable أو كود الميزان الخاص، ولم تُنفذ اختباراته أو التوقيع أو تذكرته أو التنزيل أو البصمة أو الوزن أو أجهزته. بقي ملف الترجمة المشترك دون تعديل، واستُبعد كله من ESLint. أخطاء الترجمة المحمية الاثنا عشر التاريخية خارج نطاق هذه الجولة، وليست ضمن الأخطاء الثلاثة.

لم تُنفذ طباعة/PDF جديدة أو رحلة مبيعات كاملة أو كل الصلاحيات والشاشات أو StrictMode/unmount-remount لكل hook أو أجهزة حقيقية أو تحميل إنتاجي أو استعادة backup أو نشر. فحوص المتصفح ببيانات مصطنعة محجوبة عن SAP؛ ليست UAT حيًا. لا توجد دعوى قياس SAP أو إغلاق أخطاء Fast Refresh أو جاهزية نشر. يلزم حسم عقد الاستيرادات الثلاثة وإعادة فحصه، وتجهيز TLS الموثوق، ثم استكمال إجراء الإصدار والنسخ الاحتياطي والموافقة المعلن سابقًا.

[سلامة النسخة](../scratch/remaining-remediation-20261021/integrity.json)، [بيان الملفات](../scratch/remaining-remediation-20261021/manifest.json)، [الأخطاء الباقية](../scratch/remaining-remediation-20261021/remaining-findings.json).
'''
(ROOT/'docs/CURRENT_VERSION_FOLLOWUP_REVIEW_AR.md').write_text(report,encoding='utf-8')
notice='''## تحديث 21 أكتوبر 2026

**غير جاهز للنشر:** أُعيدت الفحوص على نفس النسخة؛ تبقى أخطاء Fast Refresh الثلاثة، وقياس SAP الحي متوقف لعدم إثبات TLS الموثوق. التفاصيل والأوامر والنتائج والاستثناءات في [تقرير الاستكمال](CURRENT_VERSION_FOLLOWUP_REVIEW_AR.md). لم يُنفذ نشر أو تعديل تشغيل أو SAP حي أو اختبارات ميزان. الأقسام التالية نتائج تاريخية محفوظة.

'''
for name in ['CURRENT_VERSION_HANDOVER_REVIEW_AR.md','PREDEPLOY_REVIEW_AR.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');head,tail=old.split('\n',1);p.write_text(head+'\n\n'+notice+tail.lstrip('\n'),encoding='utf-8')
print(json.dumps(integrity))
