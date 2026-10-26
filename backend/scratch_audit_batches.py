import os
import json
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
item_code = "2710100006"
warehouse_code = "20204"

clean_code = item_code.replace("'", "''")
clean_whs = warehouse_code.replace("'", "''")

rows = []
try:
    param_whs = f"itemCode='{clean_code}'&whsCode='{clean_whs}'"
    result = sap.execute_sql_query("CD_BATCHES_BY_ITEM_WHS", param_whs)
    if isinstance(result, dict) and not result.get("error"):
        rows = result.get("value") or []
except Exception as e:
    print("CD_BATCHES_BY_ITEM_WHS error:", e)

if not rows:
    try:
        param_whs = f"itemCode='{clean_code}'&whsCode='{clean_whs}'"
        result_obtq = sap.execute_sql_query("CD_BATCHES_OBTQ_WHS", param_whs)
        if isinstance(result_obtq, dict) and not result_obtq.get("error"):
            rows = result_obtq.get("value") or []
    except Exception as e:
        print("CD_BATCHES_OBTQ_WHS error:", e)

batches = []
for r in rows:
    row_whs = str(r.get("WhsCode") or "").strip()
    if warehouse_code and row_whs != warehouse_code:
        continue

    on_hand = float(r.get("OnHandQty") or 0.0)
    if on_hand <= 0:
        continue

    batch_number = str(r.get("BatchNumber") or "").strip()
    bin_code = str(r.get("BinCode") or "").strip()
    bin_abs = r.get("BinAbsEntry")
    is_system_bin = (r.get("SysBin") == "Y") or ("SYSTEM-BIN" in bin_code.upper())
    exp_date = r.get("ExpDate")
    mnf_date = r.get("MnfDate")

    batches.append({
        "item_code": r.get("ItemCode") or item_code,
        "batch_number": batch_number,
        "dist_number": batch_number,
        "warehouse_code": row_whs,
        "on_hand_qty": on_hand,
        "quantity": on_hand,
        "bin_abs_entry": bin_abs,
        "bin_code": bin_code,
        "expiry_date": exp_date,
        "manufacturing_date": mnf_date,
        "is_system_bin": is_system_bin,
    })

batches.sort(key=lambda b: (1 if b["is_system_bin"] else 0, -b["on_hand_qty"]))

print(f"Total batches returned: {len(batches)}")
for b in batches:
    print(b)
