import json
from django.contrib.auth.models import User
from django.test import TestCase, Client, override_settings
from api.models import UserProfile, AuditLog
from api.models_quality import PendingQualityInspection


class QualityInspectionSubmitTests(TestCase):
    @override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
    def test_grade_inputs_follow_item_stage_mapping_and_activation(self):
        from django.core.cache import cache
        from api.models_quality import InspectionStage, QualityCriterion, ItemQualityCriterion
        stage = InspectionStage.objects.get(code='RECEIVING')
        grades = list(QualityCriterion.objects.filter(inspection_stage=stage,
            calculation_key__in=['grade_1', 'grade_2']))
        self.assertEqual(len(grades), 2)
        self.assertTrue(all(grade.category.code == 'GRADE' for grade in grades))
        for grade in grades:
            ItemQualityCriterion.objects.create(item_code='GRADE-ITEM', inspection_stage=stage,
                quality_criterion=grade)

        def keys(item, stage_code='RECEIVING'):
            cache.clear()
            response = self.client.get('/api/quality/inspection-criteria/',
                {'inspection_stage': stage_code, 'item_code': item})
            self.assertEqual(response.status_code, 200)
            return {criterion['calculation_key'] for category in response.json()['categories']
                    for criterion in category['criteria']}

        self.assertEqual(keys('GRADE-ITEM'), {'grade_1', 'grade_2'})
        self.assertEqual(keys('OTHER-ITEM'), set())
        self.assertEqual(keys('GRADE-ITEM', 'PRE_EXPORT'), set())
        grades[0].is_active = False
        grades[0].save(update_fields=['is_active'])
        self.assertEqual(keys('GRADE-ITEM'), {grades[1].calculation_key})

    def test_workbook_grades_are_saved_and_used_in_percentage_denominator(self):
        # unprotected_copy.xlsx, 22-12-2025!F11:AH27: AF=3, AG=5, AD=2, AE=2.
        samples = [
            {'defects': {'acarus': 1, 'fall_drop': 1, 'grade_1': 2, 'grade_2': 2}},
            {'defects': {'vegetable_defects': 1, 'cuts': 1, 'navel_blight': 1}},
            {'defects': {'citrus_rust': 1, 'tearing': 1, 'molds': 1}},
        ] + [{'defects': {}} for _ in range(12)]
        response = self.client.post('/api/quality/inspections/create/',
            data=json.dumps({'metadata': {'item_code': 'RAW', 'quantity': 100, 'uom_code': 'KG'},
                             'sample_size': 15, 'samples_data': samples}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        inspection = PendingQualityInspection.objects.latest('id')
        self.assertEqual(inspection.samples_data[0]['defects']['grade_1'], 2)
        self.assertEqual(inspection.samples_data[0]['defects']['grade_2'], 2)
        self.assertEqual(inspection.af_waste_total, 3)
        self.assertEqual(inspection.ag_quality_total, 5)
        self.assertEqual(inspection.ah_grand_total, 12)
        self.assertEqual(float(inspection.combined_bruises_cuts_percentage), 8.33)
        self.assertEqual(float(inspection.high_cut_percentage), 0)

    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username="test_qc_user", password="password123")
        UserProfile.objects.filter(user=self.user).update(role="quality_admin")
        self.client.login(username="test_qc_user", password="password123")

    def test_create_quality_inspection_success_and_audit_log(self):
        payload = {
            "metadata": {
                "item_code": "RM-TOMATO-001",
                "item_name": "Fresh Tomato",
                "vendor_card_code": "V1000",
                "vendor_name": "Best Farm",
                "quantity": 1250.5,
                "uom_code": "KG",
                "warehouse_code": "WH01",
            },
            "samples_data": [],
            "sample_size": 0,
        }

        response = self.client.post(
            "/api/quality/inspections/create/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        res_json = response.json()
        self.assertTrue(res_json.get("success"))
        inspection_data = res_json.get("data", {}).get("inspection", {})
        self.assertEqual(inspection_data.get("item_code"), "RM-TOMATO-001")
        self.assertEqual(float(inspection_data.get("quantity")), 1250.5)

        # Verify database record
        ins_id = inspection_data.get("id")
        ins = PendingQualityInspection.objects.get(id=ins_id)
        self.assertEqual(ins.quantity, 1250.5)

        # Verify AuditLog creation and details
        audit = AuditLog.objects.filter(
            entity_type="PendingQualityInspection",
            entity_id=str(ins.id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details.get("total_quantity"), 1250.5)
