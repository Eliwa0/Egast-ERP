import datetime
from django.utils import timezone
from ..models import PendingQualityInspection

# Keys for tallies matching form/ logic
AF_KEYS = [
    'acarus', 'scale_insect', 'spray_marks', 'citrus_rust', 'thrips',
    'vegetable_defects', 'gummosis', 'sunburn', 'sooty_mold', 'mealybug', 'mutations'
]

AG_KEYS = [
    'oil_spots', 'under_size', 'tearing', 'bruises', 'cuts', 'venting',
    'fruit_fly', 'creasing', 'fall_drop', 'navel_blight', 'softness', 'molds'
]

class QualityInspectionService:
    def __init__(self, sap_client):
        self.sap = sap_client

    def calculate_inspection_metrics(self, sample_size, samples_data):
        """
        Replicates the exact calculations and Excel formulas extracted from form/script.js.
        """
        totals = {}
        # Initialize defect totals
        defect_keys = AF_KEYS + AG_KEYS + ['grade_1', 'grade_2', 'high_cut']
        for k in defect_keys:
            totals[k] = 0

        # Tally counts across all samples
        all_samples = []
        for item in samples_data:
            if isinstance(item, dict) and 'samples' in item:
                all_samples.extend(item['samples'])
            else:
                all_samples.append(item)

        for sample in all_samples:
            if not isinstance(sample, dict):
                continue
            defects = sample.get('defects', {})
            # If defects is a list (API format), parse it, otherwise if dict
            if isinstance(defects, list):
                for d in defects:
                    k = d.get('defect_key')
                    if k in totals:
                        totals[k] += int(d.get('quantity', 0))
            elif isinstance(defects, dict):
                for k, v in defects.items():
                    if k in totals:
                        totals[k] += int(v or 0)

        # 1. Sum AF (Waste Total / Benzat)
        sum_af = sum(totals[k] for k in AF_KEYS)

        # 2. Sum AG (Quality Total / Farza)
        sum_ag = sum(totals[k] for k in AG_KEYS)

        # 3. Sum AH (Grand Total)
        sum_ah = sum_af + sum_ag + totals['grade_1'] + totals['grade_2']

        # 4. Percentages
        pct_bruises_cuts = 0.0
        pct_high_cut = 0.0
        if sum_ah > 0:
            pct_bruises_cuts = ((totals['bruises'] + totals['cuts']) / sum_ah) * 100.0
            pct_high_cut = (totals['high_cut'] / sum_ah) * 100.0

        # 5. QA Decision Tree
        quarantine_violation = (totals['molds'] > 0)
        avg_defects = sum_ah / sample_size if sample_size > 0 else 0.0

        if quarantine_violation:
            decision = "Rejected (Quarantine Defects)"
        elif avg_defects > 4.0:
            decision = "Rejected (Tolerable Boundary Exceeded)"
        elif sum_ah > 0:
            decision = "Conditionally Accepted"
        else:
            decision = "Accepted"

        return {
            'totals': totals,
            'sum_af': sum_af,
            'sum_ag': sum_ag,
            'sum_ah': sum_ah,
            'combined_bruises_cuts_percentage': round(pct_bruises_cuts, 2),
            'high_cut_percentage': round(pct_high_cut, 2),
            'quarantine_violation': quarantine_violation,
            'average_defects_per_sample': round(avg_defects, 2),
            'decision': decision
        }

    def post_inspection_to_sap(self, inspection, target_warehouse=None):
        """
        Releases the batch in SAP. If a release target_warehouse is specified,
        performs a Stock Transfer in SAP from WH-QA (or current warehouse) to the target.
        Otherwise, updates the batch status in OBTN/OBTNDetails to 'Released' (0).
        """
        if inspection.status == PendingQualityInspection.POSTED:
            raise ValueError("This inspection report has already been posted.")

        # Re-run calculations to be safe
        metrics = self.calculate_inspection_metrics(inspection.sample_size, inspection.samples_data)
        
        # Check decision
        is_pass = "Accepted" in metrics['decision'] or "Conditionally Accepted" in metrics['decision']

        # Construct SAP call
        if is_pass:
            uom_code = str(getattr(inspection, "uom_code", "") or getattr(inspection, "uom_name", "") or "").strip()
            if float(inspection.quantity or 0) <= 0:
                raise ValueError("Total Quantity is required and must be greater than zero before SAP posting.")
            if not uom_code:
                raise ValueError("Unit of Measure is required before SAP posting.")
            if target_warehouse:
                # Perform Stock Transfer from WH-QA to target warehouse
                transfer_payload = {
                    "FromWarehouse": inspection.warehouse_code,
                    "ToWarehouse": target_warehouse,
                    "StockTransferLines": [
                        {
                            "ItemCode": inspection.item_code,
                            "Quantity": inspection.quantity,
                            "UoMCode": uom_code,
                            "WarehouseCode": target_warehouse,
                            "FromWarehouseCode": inspection.warehouse_code,
                            "BatchNumbers": [
                                {
                                    "BatchNumber": inspection.batch_number,
                                    "Quantity": inspection.quantity
                                }
                            ]
                        }
                    ]
                }
                
                result = self.sap.create_stock_transfer(transfer_payload)
                if result.get("error") or not result.get("DocEntry"):
                    err_msg = result.get("error", {}).get("message", {}).get("value", str(result))
                    raise Exception(f"SAP Stock Transfer failed: {err_msg}")
                
                inspection.sap_doc_entry = str(result.get("DocEntry"))
                inspection.sap_doc_num = str(result.get("DocNum"))
            else:
                # Fallback: update batch status inside SAP OBTN using Service Layer BatchNumberDetails
                # In SAP: status 0 = Released, 1 = Locked, 2 = Access Denied.
                # Endpoint: BatchNumberDetails(ItemCode='...', BatchNumber='...')
                # We can perform a PATCH to update Status to 0 (Released).
                safe_item = str(inspection.item_code).replace("'", "''")
                safe_batch = str(inspection.batch_number).replace("'", "''")
                endpoint = f"BatchNumberDetails(ItemCode='{safe_item}',BatchNumber='{safe_batch}')"
                
                patch_payload = {
                    "Status": 0 # Released
                }
                
                result = self.sap._request("PATCH", endpoint, patch_payload)
                if isinstance(result, dict) and result.get("error"):
                    err_msg = result.get("error", {}).get("message", {}).get("value", str(result))
                    raise Exception(f"SAP Batch status update failed: {err_msg}")
        else:
            # If FAIL: keep status as Locked (status = 1) or move to quarantine bin/warehouse if configured
            # Simply log status in SAP or perform no transfer
            pass

        # Update inspection record
        inspection.status = PendingQualityInspection.POSTED
        inspection.posted_at = timezone.now()
        inspection.save()

        return inspection
