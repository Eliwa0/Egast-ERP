"""Extract every original failure/subtest with source attribution and evidence."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    raw = (ROOT / 'scratch/performance-backend-final.txt').read_bytes()
    text = raw.decode('utf-16' if raw.startswith(b'\xff\xfe') else 'utf-8-sig').replace('\r\n', '\n')
    before = json.loads((ROOT / 'scratch/performance-baseline-hashes.json').read_text())
    at_start = json.loads((ROOT / 'scratch/stability-start-hashes.json').read_text())
    rows = []
    for block in re.split(r'\n={25,}\n', text):
        if not block.startswith(('ERROR:', 'FAIL:')):
            continue
        header = block.split('\nTraceback', 1)[0]
        flattened = re.sub(r'\s+', '', header)
        match = re.search(r'\((api\.[\w.]+|scale\.[\w.]+)\)', flattened)
        if not match:
            raise ValueError('Unparsed failure header: ' + header)
        test_id = match[1]
        module, cls, method = test_id.rsplit('.', 2)
        source = 'backend/' + module.replace('.', '/') + '.py'
        path = ROOT / source
        frames = re.findall(r'File "([^"]+)", line (\d+), in\s*([^\n]+)', block)
        line = next((int(number) for name, number, fn in frames if Path(name.replace('\n', '')).name == path.name), None)
        suffix = flattened[match.end():].split('-' * 20, 1)[0]
        subtest = suffix if suffix.startswith('(') else ''
        reason = 'Unclassified'
        category = 'test_contract'
        evidence = ''
        if 'persisted_transfer_policy' in module or 'transfer_policy_authority' in module or 'transfer_policy_migration' in module or 'frontend_config_response' in method:
            reason = 'اختبار يفترض API السياسات المحذوف أو تطبيق snapshots القديمة وقت التنفيذ؛ العقد الحالي يزيل المسارات ويتجاهلها في التنفيذ.'
            evidence = 'tests_transfer_configuration_cleanup + api/urls.py + TransferInventoryService.resolve_transfer_policy(include_persisted=False)'
        elif 'cold_storage_outbound' in module:
            reason = 'fixture لا يوفر قراءة metadata مخزن الوجهة/متطلب bin الجديدة؛ mock ناقص يعيد MagicMock أو يصل إلى SAP قبل سيناريو الاختبار المقصود.'
            evidence = 'transfer_destination_bins.destination_bin_options + missing get_warehouse_details fixture'
        elif 'physical_transfer' in module:
            reason = 'طلب/fixture قديم: source_warehouse وصلاحية FROM للمرحلة الخامسة مفقودان؛ بعض توقعات Stage 3 تتجاهل صلاحية مخزن الوجهة الفعلي.'
            evidence = 'physical_transfer_service.load and authorize_source; tests_stage5_loading'
        elif 'test_pending_shipments_exposes_unconsumed' in method:
            reason = 'العقد الحالي يعرض شحنة واحدة مع grpo_draft_id لإعادة فتح المسودة، والاختبار القديم يتوقع إخفاء الشحنة تماماً.'
            evidence = 'grpo_views.list_pending_grpo_shipments + tests_grpo_scale_draft_lifecycle'
        elif 'test_actual_position_is_still_required' in method:
            reason = 'التوقع القديم 400 لا يطابق العقد الحالي: غياب الموقع الفعلي يرفع DestinationPositionConflict ويرجع 409؛ يظل إنشاء التحويل ممنوعاً.'
            evidence = 'Stage2 destination integrity tests and original response body'
        elif 'ScaleDraftNumberingConcurrency' in test_id or 'test_different_transfers_can_reach_sap_concurrently' in method:
            category = 'database_environment'
            reason = 'SQLite لا يوفر قفل صفوف SELECT FOR UPDATE ويقفل جدول الكتابة؛ نفس الاختبار نجح على PostgreSQL محلي معزول قبل أي تغيير تطبيق.'
            evidence = 'scratch/stability-postgres-before.log'
        elif 'tests_release_deployment' in module:
            category = 'release_integrity'
            reason = 'الملف الفعلي DF4A8921...87B1163 يختلف عن تثبيت الإصدار السابق. اعتمد المستخدم الملف الحالي صراحةً في آخر توجيه؛ ثُبتت بصمته وأضيف رفض تنزيل أي ملف مخالف، دون تعديل الملف التنفيذي.'
            evidence = 'SHA-256 of EXE and existing deployment ZIP; file version 1.0.1; Authenticode NotSigned'
        key = source.replace('/', '\\')
        same = key in before and key in at_start and before[key] == at_start[key]
        rows.append({'number': len(rows)+1, 'kind': block.split(':', 1)[0], 'test': test_id, 'subtest': subtest,
                     'file': source, 'line': line, 'category': category, 'root_cause': reason,
                     'evidence': evidence, 'test_source_unchanged_since_pre_performance_snapshot': same,
                     'performance_regression': 'No confirmed performance regression; source and call-path evidence required, not comparison alone',
                     'original_trace': block})
    assert len(rows) == 55, len(rows)
    (ROOT / 'scratch/stability-failures-original.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = ['# سجل الأسباب المثبتة لإخفاقات Django الأصلية', '',
             'التاريخ: 20 أكتوبر 2026. المرجع: 781 اختباراً، 27 failure و28 error و6 skipped.', '',
             'كل صف يمثل failure/error بما فيه subtests. توافق المقارنة السابقة وحده لا يثبت قدم الإخفاق. عمود البصمة يقارن نسخة بداية التحقيق بنسخة ما قبل الأداء، ويثبت ثبات ملف الاختبار فقط؛ تُستخدم أدلة المصدر ومسارات الاستدعاء لتحديد السبب. اعتمد المستخدم البصمة التنفيذية الحالية صراحةً. أرقام الأسطر أصلية من سجل الإخفاق، وقد تتحرك بعد الإصلاح. نتائج الإصلاح النهائية موثقة في تقرير الاستقرار المرتبط أدناه.', '',
             '| # | الاختبار وموضعه | النوع/التصنيف | السبب والدليل | ثبات ملف الاختبار منذ بداية الأداء |',
             '|---|---|---|---|---|']
    for row in rows:
        location = row['file'] + (':' + str(row['line']) if row['line'] else '')
        sub = ('؛ subtest: `' + row['subtest'] + '`') if row['subtest'] else ''
        lines.append(f"| {row['number']} | `{row['test']}`{sub}<br>`{location}` | {row['kind']} / {row['category']} | {row['root_cause']}<br>الدليل: `{row['evidence']}` | {'نعم' if row['test_source_unchanged_since_pre_performance_snapshot'] else 'غير مثبت بالبصمة وحدها'} |")
    lines.extend(['', 'اكتملت معالجة الإخفاقات الأصلية وإعادة الاختبارات. تفاصيل الإصلاحات والاختبارات الجديدة والقياس الحي والقيود في [تقرير إصلاح الاستقرار](STABILITY_REMEDIATION_REPORT_AR.md). المرجع النهائي للمجموعة هو [نتائج PostgreSQL](../scratch/stability-postgres-release-final.json): 786 ناجحاً، دون failure أو error أو skipped أو اتصال HTTP غير متوقع.', ''])
    (ROOT / 'docs/STABILITY_FAILURE_ROOT_CAUSES_AR.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'classified_original_failures': len(rows)}))


if __name__ == '__main__':
    main()
