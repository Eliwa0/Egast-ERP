import hashlib,json,os,subprocess
from pathlib import Path
from collections import Counter
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
mapping=json.loads((OUT/'import-map.json').read_text())
assert not mapping['parse_failures']
assert all(b['uses'] for r in mapping['related'] for b in r['bindings'])
counts=Counter(b['imported'] for r in mapping['related'] for b in r['bindings'])
manifest=json.loads((ROOT/'scratch/remaining-remediation-20261021/manifest.json').read_text())
scan=json.loads((OUT/'source-hashes.json').read_text());scan_drift=[k for k,h in scan.items() if sha(ROOT/k)!=h]
drift=[k for k,h in manifest['files'].items() if k in scan and (not (ROOT/k).exists() or sha(ROOT/k)!=h)]
assert not drift and not scan_drift
boundary=[r for r in mapping['protected_boundary_references'] if '/modules/scale/' in r['specifier']]
request={'status':'required-before-contract-change','known_entry_points_from_allowed_imports_only':boundary,
 'coverage_required':'All protected sources and tests that directly or transitively import/reexport the three target modules, including dynamic/computed imports and import aliases. Entry list is a lower bound, not a complete protected file inventory.',
 'requested_record_fields':['consumer resolved path','consumer revision/hash supplied by project owner','import source and resolved path','imported names including namespace/default','reexport chains','dynamic import members','provider/hook uses','analysis tool and version','unresolved edges and explicit no-consumer results'],
 'target_modules':mapping['targets'],'protected_files_read':False}
(OUT/'required-owner-evidence.json').write_text(json.dumps(request,indent=2))
values=dotenv_values(ROOT/'backend/.env');key='SAP_VERIFY_SSL';value=os.environ.get(key,values.get(key,'true'))
safe={'flag':key,'source':'process environment' if key in os.environ else 'backend/.env' if key in values else 'default true','verification_enabled':str(value).strip().lower() in {'true','1','yes','on'},'live_connections':0,'server_certificate_verified':False}
(OUT/'tls-state.json').write_text(json.dumps(safe,indent=2))
integrity={'baseline_sha256_reference_only':manifest['sha256'],'baseline_source_drift':drift,'scan_source_drift':scan_drift,'baseline_comparison_scope':'Intersection of final allowed frontend scan and previous manifest only','initial_scope_error':'Five previously excluded mixed test scripts read during initial static collection; not executed or changed. Initial artifacts retained. Final collection excludes prior exclusion list before reading.','application_modified':False,'general_tests_rerun':False}
(OUT/'integrity.json').write_text(json.dumps(integrity,indent=2))
known='\n'.join(f"- `{r['specifier']}` — مرجع فقط في `App.jsx:{r['line']}`." for r in boundary)
note='''## مرحلة جمع أدلة الاستيراد وتجهيز TLS — 21 أكتوبر 2026

**النتيجة: اكتملت خريطة المصادر المسموح بها، ولم تكفِ لإثبات سلامة تغيير عقد الوحدات الثلاث خارج ذلك النطاق. لم يُعدّل التطبيق؛ ولا يزال غير جاهز للنشر.** لم تُكرر الاختبارات العامة، ولم يُنفذ اتصال SAP أو نشر أو migration. تغير التقرير فقط، وأُضيفت أدوات وأدلة إلى `scratch/context-import-evidence/`.

### 1. الخريطة الفعلية ودرجة اكتمالها

فُحص **180 ملف مصدر/اختبار Frontend مسموحًا**، مع استبعاد المسارات المحمية قبل دخول المجلد أو قراءة محتواه، واستبعاد ملف الترجمة المشترك. استُخدم AST ونطاق المتغيرات عبر ESLint لجمع مسار الاستيراد المحلول والاسم المستورد والـalias ومواضع المرجع ومواضع العرض في JSX، وليس مجرد البحث عن أسماء الملفات. حُلّت الامتدادات ضمن قائمة الملفات المسموحة فقط؛ لم يُختبر وجود الملفات المحمية أو يُفتح محتواها.

النتيجة: **124 static import في 72 ملفًا، و126 binding مستعملًا**، وصفر أخطاء parse. التفاصيل القابلة للمراجعة لكل ملف وسطر واستخدام في [الخريطة العربية](../scratch/context-import-evidence/IMPORT_MAP_AR.md) و[البيانات الكاملة](../scratch/context-import-evidence/import-map.json):

| الاسم المستورد | عدد bindings |
|---|---:|
| AuthProvider | 3 |
| I18nProvider | 3 |
| ToastProvider | 2 |
| useAuth | 30 |
| useI18n | 68 |
| useToast | 20 |

مستوردو Providers المثبتون: `App.jsx:9–11`، و`purchase-vendor-lifecycle.jsx:4–6`، و`select-ux-harness.jsx:5–6`. مواقع الاستخدام الفعلية موثقة في الخريطة. لم تُوجد reexports للوحدات الثلاث في الملفات المسموحة، أو imports باسم namespace/default لها. جُمعت أيضًا **463 إشارة نصية**، مصنفة كأدلة مساعدة قد تشمل تعليقات ونصوص fixtures، حتى لا يُخلط النص المنسوخ داخل اختبار باستيراد runtime. مراجع Python محفوظة في قسم مستقل؛ لم تُنفذ هذه الاختبارات.

يوجد computed import اثنان في النطاق المفحوص: `scripts/check-i18n.js:96` لوحدة الترجمة المشتركة، و`services/performanceMetrics.test.mjs:9` لنص وحدة performanceMetrics المحمّل محليًا. روجع مصدر تعبيريهما، ولم يثبت أنهما يوجهان إلى الوحدات الثلاث. هذا ليس ضمانًا ضد توليد شيفرة أو اعتماد خارجي غير ممثل في المصادر المفحوصة.

استُخدمت كذلك قائمة المستهلكين السابقة وبيانات أوامر/نتائج Node وتشخيص البدائل الموجودة في `scratch/remaining-remediation-20261021/` و`scratch/context-tls-followup/`. تلك سجلات اختبارات وليست تقرير dependency graph كاملًا للنطاق المحمي. لم تُقرأ bundles أو sourcemaps قد تحتوي شيفرته، ولم يُنفذ اكتشاف لاختباراته.

### 2. أقل تعديل مرشح وما ينقص لاعتماده

المسار الأقل أثرًا على المستهلكين **الظاهرين** هو إبقاء hooks بمساراتها الحالية، وفصل Providers، وتحديث مستوردي Providers الثلاثة أعلاه. يفصل التنفيذ كائنات Context في وحدة مشتركة واحدة لكل سياق، حتى لا ينشئ Provider وHook كائنين مختلفين؛ وتبقى آثار المصادقة واللغة والتنبيهات ودورة حياتها كما هي. تفاصيل عدد الملفات الجديدة تعتمد على تصميم الفصل، ولم يُختَر تصميم نهائي دون إثبات التوافق.

هذا المرشح يزيل export الـProvider من مساره القديم، ولذلك **ليس حافظًا لكل عقد الاستيراد السابق تلقائيًا**. إبقاء تصدير Provider وHook معًا للتوافق يعيد خطأ Fast Refresh المثبت في التشخيص السابق. لا توجد في الأدلة الحالية طريقة مثبتة تُبقي العقد المختلط نفسه وتغلق القاعدة دون التفاف. لذلك لم يُنفذ تغيير جزئي أو إعادة تسمية أو facade أو استثناء ESLint.

### 3. قائمة الأدلة المطلوبة من مسؤول المشروع

مداخل النطاق المحمي التالية معروفة من **نص الاستيراد في الملف المسموح App.jsx فقط**؛ هي أسماء modules وليست تأكيدًا لامتداد الملفات أو قائمة كاملة بمحتويات النطاق:

'''+known+'''

المطلوب تقرير يولده صاحب الوصول المصرح به، وليس فتح هذه الملفات هنا: المسار الفعلي والنسخة/البصمة لكل consumer مباشر أو غير مباشر للوحدات الثلاث، وأسماء imports/reexports والـaliases ومسارات حلها واستخدام Provider/Hook، مع تتبع barrels وdynamic imports والملفات المشتركة والاختبارات وأي edges غير محسومة. يجب أن يغطي **الإغلاق الانتقالي لهذه المداخل وبقية النطاق المحمي**، لا الملفات العشرة فقط. عند عدم وجود مستهلك، يلزم نتيجة سلبية صريحة مع الأداة والإصدار ونطاق البحث. [طلب الأدلة المنظم](../scratch/context-import-evidence/required-owner-evidence.json).

إن أثبت التقرير عدم استيراد أي Provider من المسارات القديمة داخل النطاق المحمي، يمكن تنفيذ مرشح نقل Providers في المشروع واختبار Context identity ودورة الحياة وHMR والمستهلكين المسموحين. إن وُجدت استيرادات Provider محمية، يلزم تقييم النقل المعاكس أو تفويض صيانة منفصل من المسؤول؛ لا يمكن افتراض جواز تعديلها. لا تكفي اختبارات الواجهة السابقة لإثبات غياب اعتماد غير مفحوص.

### 4. TLS دون اتصال

أُعيد فحص مصدر قراءة الإعداد فقط: `receipt_project/settings.py:9` يحمّل dotenv دون override، فيتقدم متغير العملية على الملف. `_env_bool` في `sap_service.py:42` يقرأ قيمة من البيئة، وconstructor في السطر 73 يستخدم `SAP_VERIFY_SSL` مع default آمن true. يُمرر الناتج إلى `verify` في الطلبات (مثل 141 و161)، ويصل عبر `_http_request:176` إلى الناقل المشترك. إخفاء تحذير urllib3 عند التعطيل لا يجعل الاتصال موثوقًا.

الفحص الآمن الحالي يؤكد أن مصدر `SAP_VERIFY_SSL` هو `backend/.env` وأن التحقق معطل؛ لم تُطبع أي بيانات اعتماد أو endpoint أو ملف البيئة. لم يتغير الإعداد. المطلوب بعد تجهيز الثقة هو **`SAP_VERIFY_SSL=true`**؛ ليست قيمة تُطبّق الآن قبل الإجراء المعتمد. [دليل الحالة دون أسرار](../scratch/context-import-evidence/tls-state.json).

متطلبات مسؤول السيرفر قبل أي اتصال SAP هنا:

1. CA موثوقة مصدرها PKI المؤسسي أو جهة موثوقة معتمدة؛ تجهيز الثقة تحت حساب خدمة التطبيق. عند الحاجة إلى PKI خاص يُهيأ REQUESTS_CA_BUNDLE بمسار PEM حقيقي معتمد وصلاحية قراءة، دون مفاتيح خاصة أو مسارات تخمينية.
2. سلسلة خادم كاملة مع الوسيطات اللازمة وسلسلة تنتهي بجذر موثوق؛ لا يُوثق ملف CA لمجرد تنزيله من اتصال غير متحقق.
3. تطابق hostname المستخدم مع SAN، وصلاحية الشهادة من حيث البداية والانتهاء وساعة النظام. صلاحية ملف CA وحدها ليست إثباتًا لهوية الخادم.
4. دليل تحقق لسلسلة الخادم والاسم، في بيئة الاختبار المصرح بها وبإعدادات حساب الخدمة الفعلية، مع التحقق الإلزامي وعدم أي verify=False أو تجاهل خطأ. لا تُرسل بيانات اعتماد قبل إثبات الثقة.

لم يُنفذ اتصال SAP: القياس الحي وعدد طلباته وMedian وP95 وأخطاؤه **غير مقاسة**؛ لا تُعرض كأصفار نجاح. بعد ورود إثبات الثقة وتصريح البيئة يُعد قياس قراءة فقط بعينة ثابتة، دون إنشاء SQLQueries أو مستندات أو أي كتابة SAP.

### 5. الأوامر وسلامة النطاق والاختبارات

```powershell
node scratch/context-import-evidence/map.mjs
.\\.venv\\Scripts\\python.exe scratch/context-import-evidence/finish.py
```

أداة الخريطة انتهت بكود **0**: 180 ملفًا، صفر أخطاء parse، و124 edge للوحدات الثلاث. تحققت أداة التسليم من عدم وجود binding مستورد من الوحدات الثلاث بلا موقع استعمال مرصود، ومن ثبات بصمات المصادر المفحوصة وبصمات الـ499 مدخلًا غير محمي في البيان السابق. هذه فحوص اكتمال وسلامة أدلة ساكنة، **وليست اختبارات سلوك جديدة** أو اعتمادًا للنطاق المحمي. بصمة البيان السابقة ما زالت `6fd5b4174d4cec8d504b927c3b31404436ae3e78d1ce294a65dab0a554420e9a`، دون drift. [سلامة النطاق](../scratch/context-import-evidence/integrity.json).

حُفظت حالة Git قبل المرحلة وبعدها. لم تُعدّل مصادر التطبيق أو ملف البيئة أو migrations أو إعدادات ESLint. لذلك لم تُكرر Node أو المتصفح أو Backend أو build أو الترجمة أو تشخيص TLS السابق؛ نتائجها السابقة تبقى تاريخية ولا تُنسب لهذه المرحلة. لم يُفحص الميزان أو ScaleAgent أو تُشغّل اختباراتهما أو مصادرهما أو الترجمة المحمية، ولم تُنفذ عمليات تشغيل أو SAP.

### تقسيم العوائق والقرار

| الجهة | العائق / الإجراء |
|---|---|
| داخل المشروع | فصل Providers/hooks واختبارات توافقها ممكنان بعد حسم تبعيات الاستيراد؛ لا يوجد تعديل تطبيق معتمد أو مانع Fast Refresh مغلق في هذه المرحلة. |
| مسؤول السيرفر | تجهيز/تأكيد CA وسلسلة الخادم وSAN والصلاحية وإعداد التحقق الآمن، وتوفير دليل نجاح التحقق في بيئة مصرح بها. |
| وصول موثوق للنطاق المحمي | توفير بيان الاستيرادات الكامل المطلوب أو نتيجة نفي موثقة، ثم اعتماد أي صيانة لازمة بعقد واضح. لم يُستخدم وصول غير مصرح به هنا. |

**لا جاهزية نشر:** تبقى أخطاء Fast Refresh الثلاثة وعدم إثبات TLS الآمن، مع شروط الإصدار السابقة. اكتملت مهمة جمع الأدلة المسموحة وتحديد طلبات التدخل اليدوي، ولم يُدّعَ إغلاق العوائق.

---

'''
note=note.replace('180',str(mapping['files_scanned'])).replace('124',str(len(mapping['related']))).replace('126',str(sum(counts.values()))).replace('72 ملفًا',str(len(set(r['file'] for r in mapping['related'])))+' ملفًا').replace('463',str(len(mapping['lexical_mentions'])))
note=note.replace('فُحص **','تصحيح نطاق معلن: شمل المسح الأول بالخطأ خمسة سكربتات مختلطة من قائمة الاستبعاد السابقة؛ قُرئت ساكنًا فقط دون تشغيل أو تعديل. حُفظت مخرجات المحاولة في `initial-scope/` وأُعيد الجمع بعد تطبيق قائمة الاستبعاد قبل القراءة. الأرقام والخريطة التالية من المسح المصحح فقط. لا يصح الادعاء بأن المحاولة الأولى تجنبت جميع الملفات المحمية.\n\nفُحص **',1)
note=note.replace('وبصمات الـ499 مدخلًا غير محمي في البيان السابق','وبصمات تقاطع ملفات المسح النهائي المسموح مع البيان السابق فقط')
note=note.replace('بصمة البيان السابقة ما زالت','بصمة البيان السابقة للمرجعية فقط؛ لم يُعد فحص مدخلاته كلها في هذه المرحلة:')
note=note.replace('لم يُفحص الميزان أو ScaleAgent أو تُشغّل اختباراتهما أو مصادرهما أو الترجمة المحمية','مع خطأ القراءة الساكنة الأولي المعلن أعلاه، لم تُشغّل اختبارات الميزان أو ScaleAgent أو تُعدّل مصادرهما أو الترجمة المحمية')
for key in ['AuthProvider','I18nProvider','ToastProvider','useAuth','useI18n','useToast']:
 import re
 note=re.sub(r'(\| '+key+r' \| )\d+( \|)',lambda m:m[1]+str(counts[key])+m[2],note)
p=ROOT/'docs/CURRENT_VERSION_FOLLOWUP_REVIEW_AR.md';text=p.read_text(encoding='utf-8');head,tail=text.split('\n',1)
if tail.lstrip().startswith('## مرحلة جمع أدلة الاستيراد وتجهيز TLS'):
 tail=tail.split('\n---\n\n',1)[1]
p.write_text(head+'\n\n'+note+tail.lstrip('\n'),encoding='utf-8')
with (OUT/'git-after.txt').open('wb') as log:subprocess.run(['git','status','--short'],cwd=ROOT,stdout=log)
(OUT/'tools-sha256.json').write_text(json.dumps({p.name:sha(p) for p in OUT.iterdir() if p.suffix in {'.py','.mjs'}},indent=2))
print(json.dumps({'source_drift':len(drift),'map_source_drift':len(scan_drift),'bindings':dict(counts),'report_updated':True}))
