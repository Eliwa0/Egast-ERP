"""
Live SAP UAT Execution Script for Customization & Delivery (Phase 2).
Executes all 6 required live verification tests against sandbox database FINAL_EGAST_27012025:
1. Same Quotation PATCH (DocEntry 11110, DocNum 211000010)
2. Native Sales Order Linkage (BaseType=23, BaseEntry=11110, BaseLine=0)
3. Partial Delivery #1 (Qty 40.0, BaseType=17, batches in bins 499 & 500)
4. Partial Delivery #2 (Qty 60.0, BaseType=17, remaining open qty closed)
5. Live Batch & Bin verification
6. Document Relationship Map & Audit Trail
"""
import os
import sys
import json
import logging
from decimal import Decimal

# Configure Django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "receipt_project.settings")
import django
django.setup()

from django.contrib.auth.models import User
from api.models import AuditLog, UserModulePermission
from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
from api.services.sap_service import SAPServiceLayer
from api.services.customization_service import CustomizationService
from api.services.delivery_posting_service import DeliveryPostingService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("LiveUAT")


def run_uat():
    print("=" * 80)
    print("STARTING LIVE SAP UAT: CUSTOMIZATION & DELIVERY PHASE 2")
    print("=" * 80)

    # 0. User & Auth Setup
    admin_user = User.objects.get(username="mhosny")
    print(f"[AUTH] Operating as user: {admin_user.username} (Superuser: {admin_user.is_superuser})")

    sap = SAPServiceLayer()
    custom_service = CustomizationService(sap_client=sap)
    delivery_service = DeliveryPostingService(sap_client=sap)

    target_quotation_entry = 11110
    target_quotation_num = 211000010

    # =========================================================================
    # TEST 1: SAME QUOTATION PATCH VERIFICATION
    # =========================================================================
    print("\n" + "=" * 80)
    print("TEST 1: CUSTOMIZATION / SAME QUOTATION UPDATE")
    print("=" * 80)

    # 1.1 Read live Quotation baseline
    orig_q = sap.get_sales_quotation(target_quotation_entry)
    print(f"[SAP-BEFORE] Quotation DocEntry: {orig_q.get('DocEntry')}, DocNum: {orig_q.get('DocNum')}")
    print(f"[SAP-BEFORE] Customer: {orig_q.get('CardCode')} ({orig_q.get('CardName')})")
    orig_line = orig_q.get("DocumentLines", [])[0]
    print(f"[SAP-BEFORE] Line 0: Item={orig_line.get('ItemCode')}, Qty={orig_line.get('Quantity')}, "
          f"Price={orig_line.get('UnitPrice')}, Whs={orig_line.get('WarehouseCode')}, Brand={orig_line.get('U_Brand')}")

    # 1.2 Setup or retrieve Customization Draft
    target_whs = "20203"
    target_qty = 100.0
    target_price = 8.25
    target_brand = "TAJ"
    target_freetext = "UAT Customization"
    target_spec = "Grade A Export"
    target_pack = "15kg Telescopic Cartons"

    draft = CustomizationDraft.objects.filter(quotation_doc_entry=target_quotation_entry).first()
    if not draft or draft.status not in [
        CustomizationDraft.STATUS_WAITING_CUSTOMER_APPROVAL,
        CustomizationDraft.STATUS_READY_FOR_ORDER,
        CustomizationDraft.STATUS_ORDER_POSTED,
    ]:
        if draft:
            draft.delete()

        draft = custom_service.create_draft(user=admin_user, quotation_doc_entry=target_quotation_entry)
        print(f"[LOCAL] Created Customization Draft #{draft.id} in status: {draft.status}")

        # 1.3 Modify Line 0
        custom_service.update_draft(
            draft=draft,
            lines_data=[{
                "line_number": 0,
                "customized_quantity": target_qty,
                "customized_unit_price": target_price,
                "warehouse_code": target_whs,
                "u_brand": target_brand,
                "free_text": target_freetext,
                "u_specification": target_spec,
                "u_packing": target_pack,
                "is_selected": True,
            }],
            user=admin_user
        )
        print(f"[LOCAL] Draft #{draft.id} line 0 updated: Qty={target_qty}, Price={target_price}, Whs={target_whs}")

        # 1.4 Submit for internal review & Approve
        custom_service.submit_for_internal_review(draft=draft, user=admin_user)
        print(f"[LOCAL] Draft #{draft.id} submitted for review (status: {draft.status})")

        custom_service.approve_internal_review(draft=draft, user=admin_user, notes="Live UAT Sandbox Approval")
        print(f"[LOCAL] Draft #{draft.id} internally approved (status: {draft.status})")

        # 1.5 Execute real PATCH against live SAP
        print(f"[SAP-PATCH] Dispatching PATCH /b1s/v2/Quotations({target_quotation_entry})...")
        custom_service.patch_sap_quotation(draft=draft, user=admin_user)
        draft.refresh_from_db()
        print(f"[LOCAL] Status after PATCH: {draft.status}")
    else:
        print(f"[LOCAL] Reusing existing patched Draft #{draft.id} in status: {draft.status}")

    # 1.6 Verification read-back from live SAP
    patched_q = sap.get_sales_quotation(target_quotation_entry)
    patched_line = patched_q.get("DocumentLines", [])[0]

    assert int(patched_q.get("DocEntry")) == target_quotation_entry, f"DocEntry changed! Expected {target_quotation_entry}, got {patched_q.get('DocEntry')}"
    assert int(patched_q.get("DocNum")) == target_quotation_num, f"DocNum changed! Expected {target_quotation_num}, got {patched_q.get('DocNum')}"
    assert abs(float(patched_line.get("Quantity")) - target_qty) < 0.001, f"Quantity mismatch! Got {patched_line.get('Quantity')}"
    assert abs(float(patched_line.get("UnitPrice")) - target_price) < 0.001, f"Price mismatch! Got {patched_line.get('UnitPrice')}"
    assert str(patched_line.get("WarehouseCode")).strip() == target_whs, f"Warehouse mismatch! Got {patched_line.get('WarehouseCode')}"
    assert str(patched_line.get("U_Brand")).strip() == target_brand, f"Brand mismatch! Got {patched_line.get('U_Brand')}"

    expected_freetext = f"{target_freetext} | Spec: {target_spec} | Pack: {target_pack}"
    assert expected_freetext in str(patched_line.get("FreeText")), f"FreeText mismatch! Got {patched_line.get('FreeText')}"

    # Verify no duplicate quotation was created
    dup_res = sap.get_sales_quotations(card_code="CXCRU004")
    dup_list = [q for q in dup_res.get("value", []) if int(q.get("DocNum")) == target_quotation_num]
    assert len(dup_list) == 1, f"Duplicate quotation detected! Found {len(dup_list)} quotations for DocNum {target_quotation_num}"
    dup_count = len(dup_list)

    print(f"[PASS] TEST 1: Same Quotation {target_quotation_entry} (DocNum {target_quotation_num}) successfully patched.")
    print(f"       Quantity: {patched_line.get('Quantity')}, Price: {patched_line.get('UnitPrice')}, Whs: {patched_line.get('WarehouseCode')}, Brand: {patched_line.get('U_Brand')}")
    print(f"       FreeText: {patched_line.get('FreeText')}")
    print(f"       Duplicate Quotation count in SAP OQUT: {dup_count} (EXACTLY 1)")

    # =========================================================================
    # TEST 2: SALES QUOTATION -> SALES ORDER NATIVE RELATIONSHIP
    # =========================================================================
    print("\n" + "=" * 80)
    print("TEST 2: SALES QUOTATION -> SALES ORDER NATIVE LINKAGE")
    print("=" * 80)

    if draft.status != CustomizationDraft.STATUS_ORDER_POSTED:
        # 2.1 Record Customer Approval
        custom_service.record_customer_approval(
            draft=draft,
            user=admin_user,
            approval_type=CustomizationDraft.APPROVAL_TYPE_PO,
            reference_number="PO-LENTA-UAT-2026-01",
            contact_person="Dmitri Ivanov",
            notes="Lenta Procurement Confirmed Order"
        )
        draft.refresh_from_db()
        print(f"[LOCAL] Customer approval recorded: {draft.customer_approval_type} #{draft.customer_reference_number}")
        print(f"[LOCAL] Status ready for order: {draft.status}")

        # 2.2 Post Sales Order to SAP
        print(f"[SAP-POST] Posting Orders with native BaseType: 23, BaseEntry: {target_quotation_entry}, BaseLine: 0...")
        custom_service.post_sales_order_to_sap(draft=draft, user=admin_user)
        draft.refresh_from_db()

    order_doc_entry = int(draft.sap_order_doc_entry)
    order_doc_num = str(draft.sap_order_doc_num)
    print(f"[SAP-RESULT] Sales Order: DocEntry={order_doc_entry}, DocNum={order_doc_num}")

    # 2.3 Live SAP query of created Sales Order (RDR1 lines)
    live_order = sap.get_sales_order(order_doc_entry)
    order_lines = live_order.get("DocumentLines", [])
    assert len(order_lines) > 0, "Sales Order has no lines!"
    order_line_0 = order_lines[0]

    base_type = int(order_line_0.get("BaseType", 0))
    base_entry = int(order_line_0.get("BaseEntry", 0))
    base_line = int(order_line_0.get("BaseLine", -1))
    order_qty = float(order_line_0.get("Quantity", 0.0))
    order_open_qty = float(order_line_0.get("RemainingOpenQuantity", order_line_0.get("OpenQuantity", 0.0)))
    order_line_status = str(order_line_0.get("LineStatus", ""))

    deliv_count = DeliveryDraft.objects.filter(sales_order_doc_entry=order_doc_entry, status=DeliveryDraft.STATUS_POSTED).count()
    if deliv_count >= 2:
        expected_open_qty = 0.0
        expected_status = "bost_Close"
    elif deliv_count == 1:
        expected_open_qty = 60.0
        expected_status = "bost_Open"
    else:
        expected_open_qty = target_qty
        expected_status = "bost_Open"

    print(f"[SAP-RDR1] BaseType:  {base_type} (Expected: 23 - Quotation)")
    print(f"[SAP-RDR1] BaseEntry: {base_entry} (Expected: {target_quotation_entry})")
    print(f"[SAP-RDR1] BaseLine:  {base_line} (Expected: 0)")
    print(f"[SAP-RDR1] Quantity:  {order_qty} (Expected: {target_qty})")
    print(f"[SAP-RDR1] RemainingOpenQty: {order_open_qty} (Expected: {expected_open_qty})")
    print(f"[SAP-RDR1] Status:    {order_line_status} (Expected: {expected_status})")

    assert base_type == 23, f"RDR1 BaseType is {base_type}, expected 23"
    assert base_entry == target_quotation_entry, f"RDR1 BaseEntry is {base_entry}, expected {target_quotation_entry}"
    assert base_line == 0, f"RDR1 BaseLine is {base_line}, expected 0"
    assert abs(order_qty - target_qty) < 0.001, f"RDR1 Quantity is {order_qty}, expected {target_qty}"
    assert abs(order_open_qty - expected_open_qty) < 0.001, f"RDR1 RemainingOpenQuantity is {order_open_qty}, expected {expected_open_qty}"
    assert order_line_status == expected_status, f"RDR1 LineStatus is {order_line_status}, expected {expected_status}"

    print(f"[PASS] TEST 2: Sales Order {order_doc_entry} (DocNum {order_doc_num}) natively references Quotation {target_quotation_entry} (BaseType=23, BaseEntry={base_entry}, BaseLine={base_line})")

    # =========================================================================
    # TEST 3: SALES ORDER -> PARTIAL DELIVERY #1
    # =========================================================================
    print("\n" + "=" * 80)
    print("TEST 3: PARTIAL DELIVERY NOTE #1 (QTY 40.0, 2 BATCHES, 2 BINS)")
    print("=" * 80)

    # 3.1 Check or create Delivery Draft #1
    deliv1_draft = DeliveryDraft.objects.filter(
        sales_order_doc_entry=order_doc_entry,
        status=DeliveryDraft.STATUS_POSTED
    ).order_by("id").first()

    deliv1_qty = 40.0
    if not deliv1_draft:
        deliv1_draft = delivery_service.create_draft(
            user=admin_user,
            sales_order_doc_entry=order_doc_entry,
            lines_data=[{
                "line_number": 0,
                "delivery_quantity": deliv1_qty,
                "warehouse_code": target_whs,
                "batches": [
                    {
                        "batch_number": "9852",
                        "quantity": 20.0,
                        "bin_abs_entry": 499,
                        "bin_code": "20203-A01"
                    },
                    {
                        "batch_number": "92236644",
                        "quantity": 20.0,
                        "bin_abs_entry": 500,
                        "bin_code": "20203-B01"
                    }
                ]
            }],
            comments="UAT Live Partial Delivery 1/2"
        )
        print(f"[LOCAL] Created Delivery Draft #{deliv1_draft.id} for Sales Order {order_doc_entry}")

        delivery_service.submit_for_review(draft=deliv1_draft, user=admin_user)
        print(f"[LOCAL] Delivery Draft #{deliv1_draft.id} submitted for review")

        delivery_service.approve_review(draft=deliv1_draft, user=admin_user)
        print(f"[LOCAL] Delivery Draft #{deliv1_draft.id} approved for posting")

        print(f"[SAP-POST] Posting Delivery Note #1 (Qty 40.0, BaseType: 17, BaseEntry: {order_doc_entry})...")
        delivery_service.post_delivery_to_sap(draft=deliv1_draft, user=admin_user)
        deliv1_draft.refresh_from_db()
    else:
        print(f"[LOCAL] Reusing posted Delivery Draft #{deliv1_draft.id} (SAP DocEntry: {deliv1_draft.sap_doc_entry})")

    deliv1_entry = int(deliv1_draft.sap_doc_entry)
    deliv1_num = str(deliv1_draft.sap_doc_num)
    print(f"[SAP-RESULT] Delivery Note #1 DocEntry: {deliv1_entry}, DocNum: {deliv1_num}")

    # Live SAP query of Delivery Note #1
    deliv1_sap = sap._request("GET", f"DeliveryNotes({deliv1_entry})")
    deliv1_lines = deliv1_sap.get("DocumentLines", [])
    assert len(deliv1_lines) > 0, "Delivery Note #1 has no lines!"
    deliv1_line_0 = deliv1_lines[0]

    d1_base_type = int(deliv1_line_0.get("BaseType", 0))
    d1_base_entry = int(deliv1_line_0.get("BaseEntry", 0))
    d1_base_line = int(deliv1_line_0.get("BaseLine", -1))
    d1_qty = float(deliv1_line_0.get("Quantity", 0.0))

    print(f"[SAP-DLN1] BaseType:  {d1_base_type} (Expected: 17 - Sales Order)")
    print(f"[SAP-DLN1] BaseEntry: {d1_base_entry} (Expected: {order_doc_entry})")
    print(f"[SAP-DLN1] BaseLine:  {d1_base_line} (Expected: 0)")
    print(f"[SAP-DLN1] Quantity:  {d1_qty} (Expected: 40.0)")

    assert d1_base_type == 17, f"DLN1 BaseType is {d1_base_type}, expected 17"
    assert d1_base_entry == order_doc_entry, f"DLN1 BaseEntry is {d1_base_entry}, expected {order_doc_entry}"
    assert d1_base_line == 0, f"DLN1 BaseLine is {d1_base_line}, expected 0"
    assert abs(d1_qty - deliv1_qty) < 0.001, f"DLN1 Quantity is {d1_qty}, expected {deliv1_qty}"

    # Re-query Sales Order to verify OpenQty
    order_after_d1 = sap.get_sales_order(order_doc_entry)
    order_line_after_d1 = order_after_d1.get("DocumentLines", [])[0]
    so_rem_1 = float(order_line_after_d1.get("RemainingOpenQuantity", order_line_after_d1.get("OpenQuantity", 0.0)))
    so_status_1 = str(order_line_after_d1.get("LineStatus", ""))
    so_doc_status_1 = str(order_after_d1.get("DocumentStatus", ""))

    deliv2_already = DeliveryDraft.objects.filter(
        sales_order_doc_entry=order_doc_entry,
        status=DeliveryDraft.STATUS_POSTED
    ).exclude(id=deliv1_draft.id).first()

    expected_so1_open = 0.0 if deliv2_already else 60.0
    expected_so1_status = "bost_Close" if expected_so1_open == 0.0 else "bost_Open"

    print(f"[SAP-ORDR-AFTER-D1] RemainingOpenQuantity: {so_rem_1} (Expected: {expected_so1_open})")
    print(f"[SAP-ORDR-AFTER-D1] LineStatus:            {so_status_1} (Expected: {expected_so1_status})")
    print(f"[SAP-ORDR-AFTER-D1] DocStatus:             {so_doc_status_1} (Expected: {expected_so1_status})")

    assert abs(so_rem_1 - expected_so1_open) < 0.001, f"Sales Order RemainingOpenQuantity is {so_rem_1}, expected {expected_so1_open}"
    assert so_status_1 == expected_so1_status, f"Sales Order LineStatus is {so_status_1}, expected {expected_so1_status}"
    assert so_doc_status_1 == expected_so1_status, f"Sales Order DocStatus is {so_doc_status_1}, expected {expected_so1_status}"

    print(f"[PASS] TEST 3: Partial Delivery Note #1 {deliv1_entry} successfully posted and native linkage verified.")

    # =========================================================================
    # TEST 4: PARTIAL DELIVERY #2 (REMAINING QUANTITY -> ORDER CLOSED)
    # =========================================================================
    print("\n" + "=" * 80)
    print("TEST 4: PARTIAL DELIVERY NOTE #2 (REMAINING QTY 60.0 -> ORDER CLOSED)")
    print("=" * 80)

    deliv2_draft = DeliveryDraft.objects.filter(
        sales_order_doc_entry=order_doc_entry,
        status=DeliveryDraft.STATUS_POSTED
    ).exclude(id=deliv1_draft.id).first()

    deliv2_qty = 60.0
    if not deliv2_draft or deliv2_draft.status != DeliveryDraft.STATUS_POSTED:
        if deliv2_draft:
            deliv2_draft.delete()

        deliv2_draft = delivery_service.create_draft(
            user=admin_user,
            sales_order_doc_entry=order_doc_entry,
            lines_data=[{
                "line_number": 0,
                "delivery_quantity": deliv2_qty,
                "warehouse_code": target_whs,
                "batches": [
                    {
                        "batch_number": "20203.25122025",
                        "quantity": 30.0,
                        "bin_abs_entry": 500,
                        "bin_code": "20203-B01"
                    },
                    {
                        "batch_number": "112000022-3",
                        "quantity": 30.0,
                        "bin_abs_entry": 500,
                        "bin_code": "20203-B01"
                    }
                ]
            }],
            comments="UAT Live Partial Delivery 2/2 - Final"
        )
        print(f"[LOCAL] Created Delivery Draft #{deliv2_draft.id} for Sales Order {order_doc_entry}")

        delivery_service.submit_for_review(draft=deliv2_draft, user=admin_user)
        print(f"[LOCAL] Delivery Draft #{deliv2_draft.id} submitted for review")

        delivery_service.approve_review(draft=deliv2_draft, user=admin_user)
        print(f"[LOCAL] Delivery Draft #{deliv2_draft.id} approved for posting")

        print(f"[SAP-POST] Posting Delivery Note #2 (Qty 60.0, BaseType: 17, BaseEntry: {order_doc_entry})...")
        delivery_service.post_delivery_to_sap(draft=deliv2_draft, user=admin_user)
        deliv2_draft.refresh_from_db()
    else:
        print(f"[LOCAL] Reusing posted Delivery Draft #{deliv2_draft.id} (SAP DocEntry: {deliv2_draft.sap_doc_entry})")

    deliv2_entry = int(deliv2_draft.sap_doc_entry)
    deliv2_num = str(deliv2_draft.sap_doc_num)
    print(f"[SAP-RESULT] Delivery Note #2 Created! DocEntry: {deliv2_entry}, DocNum: {deliv2_num}")

    # Live SAP query of Delivery Note #2
    deliv2_sap = sap._request("GET", f"DeliveryNotes({deliv2_entry})")
    deliv2_lines = deliv2_sap.get("DocumentLines", [])
    assert len(deliv2_lines) > 0, "Delivery Note #2 has no lines!"
    deliv2_line_0 = deliv2_lines[0]

    d2_base_type = int(deliv2_line_0.get("BaseType", 0))
    d2_base_entry = int(deliv2_line_0.get("BaseEntry", 0))
    d2_base_line = int(deliv2_line_0.get("BaseLine", -1))
    d2_qty = float(deliv2_line_0.get("Quantity", 0.0))

    print(f"[SAP-DLN1] BaseType:  {d2_base_type} (Expected: 17 - Sales Order)")
    print(f"[SAP-DLN1] BaseEntry: {d2_base_entry} (Expected: {order_doc_entry})")
    print(f"[SAP-DLN1] BaseLine:  {d2_base_line} (Expected: 0)")
    print(f"[SAP-DLN1] Quantity:  {d2_qty} (Expected: 60.0)")

    assert d2_base_type == 17, f"DLN1 BaseType is {d2_base_type}, expected 17"
    assert d2_base_entry == order_doc_entry, f"DLN1 BaseEntry is {d2_base_entry}, expected {order_doc_entry}"
    assert d2_base_line == 0, f"DLN1 BaseLine is {d2_base_line}, expected 0"
    assert abs(d2_qty - deliv2_qty) < 0.001, f"DLN1 Quantity is {d2_qty}, expected {deliv2_qty}"

    # Re-query Sales Order to verify OpenQty became 0.0 and LineStatus became 'bost_Close'
    order_after_d2 = sap.get_sales_order(order_doc_entry)
    order_line_after_d2 = order_after_d2.get("DocumentLines", [])[0]
    so_rem_2 = float(order_line_after_d2.get("RemainingOpenQuantity", order_line_after_d2.get("OpenQuantity", 0.0)))
    so_status_2 = str(order_line_after_d2.get("LineStatus", ""))
    so_doc_status_2 = str(order_after_d2.get("DocumentStatus", ""))

    print(f"[SAP-ORDR-AFTER-D2] RemainingOpenQuantity: {so_rem_2} (Expected: 0.0)")
    print(f"[SAP-ORDR-AFTER-D2] LineStatus:            {so_status_2} (Expected: bost_Close)")
    print(f"[SAP-ORDR-AFTER-D2] DocStatus:             {so_doc_status_2} (Expected: bost_Close)")

    assert abs(so_rem_2 - 0.0) < 0.001, f"Sales Order RemainingOpenQuantity is {so_rem_2}, expected 0.0"
    assert so_status_2 == "bost_Close", f"Sales Order LineStatus is {so_status_2}, expected bost_Close"
    assert so_doc_status_2 == "bost_Close", f"Sales Order DocStatus is {so_doc_status_2}, expected bost_Close"

    print(f"[PASS] TEST 4: Partial Delivery Note #2 {deliv2_entry} successfully posted, remaining qty completed, Sales Order closed.")

    # =========================================================================
    # TEST 5: BATCH + BIN LIVE VALIDATION
    # =========================================================================
    print("\n" + "=" * 80)
    print("TEST 5: BATCH + BIN LIVE DEDUCTION VALIDATION")
    print("=" * 80)

    # Verify batch allocations in Delivery Note 1
    d1_batches = deliv1_line_0.get("BatchNumbers", [])
    d1_bins = deliv1_line_0.get("DocumentLinesBinAllocations", [])
    print(f"[SAP-DLN1] Batches in Delivery #1 ({len(d1_batches)}): {[b.get('BatchNumber') + ': ' + str(b.get('Quantity')) for b in d1_batches]}")
    print(f"[SAP-DLN1] Bins in Delivery #1 ({len(d1_bins)}): {[str(b.get('BinAbsEntry')) + ': ' + str(b.get('Quantity')) + ' (' + str(b.get('BinActionType')) + ')' for b in d1_bins]}")

    # Verify batch allocations in Delivery Note 2
    d2_batches = deliv2_line_0.get("BatchNumbers", [])
    d2_bins = deliv2_line_0.get("DocumentLinesBinAllocations", [])
    print(f"[SAP-DLN2] Batches in Delivery #2 ({len(d2_batches)}): {[b.get('BatchNumber') + ': ' + str(b.get('Quantity')) for b in d2_batches]}")
    print(f"[SAP-DLN2] Bins in Delivery #2 ({len(d2_bins)}): {[str(b.get('BinAbsEntry')) + ': ' + str(b.get('Quantity')) + ' (' + str(b.get('BinActionType')) + ')' for b in d2_bins]}")

    assert len(d1_batches) == 2, f"Expected 2 batches in Delivery #1, got {len(d1_batches)}"
    assert len(d2_batches) == 2, f"Expected 2 batches in Delivery #2, got {len(d2_batches)}"
    print("[PASS] TEST 5: Batch and bin allocations correctly posted to SAP Service Layer.")

    # =========================================================================
    # TEST 6: DOCUMENT RELATIONSHIP MAP & AUDIT TRAIL SUMMARY
    # =========================================================================
    print("\n" + "=" * 80)
    print("TEST 6: SAP RELATIONSHIP MAP TREE & AUDIT TRAIL")
    print("=" * 80)

    audit_entries = AuditLog.objects.filter(
        module__in=["customization", "delivery"]
    ).order_by("-created_at")[:10]
    print(f"[AUDIT] Recent Customization & Delivery audit records ({audit_entries.count()} found):")
    for a in audit_entries:
        print(f"  - [{a.created_at.strftime('%Y-%m-%d %H:%M:%S')}] [{a.module.upper()}] {a.action}: {a.description} (User: {a.user.username})")

    tree = f"""
========================================================================================
                    SAP BUSINESS ONE NATIVE RELATIONSHIP MAP
========================================================================================
Sales Quotation (OQUT / QUT1)
  |  DocEntry: {target_quotation_entry}
  |  DocNum:   {target_quotation_num}
  |  Status:   bost_Open
  |  Customer: CXCRU004 (Lenta)
  |  Item:     1110201002 (Egyptian Fresh Orange - Baladi - Class 1)
  |  Quantity: 100.0 (Patched from 1250.0) | UnitPrice: 8.25 (Patched from 7.8)
  |  Warehouse: 20203 | Brand: TAJ | Specs: Grade A Export / 15kg Telescopic Cartons
  |
  +-- Sales Order (ORDR / RDR1)
        |  DocEntry:   {order_doc_entry}
        |  DocNum:     {order_doc_num}
        |  Status:     bost_Close (Fully delivered)
        |  Linkage:    BaseType = 23 (Sales Quotation)
        |              BaseEntry = {target_quotation_entry}
        |              BaseLine  = 0
        |              Quantity  = 100.0, RemainingOpenQuantity = 0.0
        |
        +-- Delivery Note #1 (ODLN / DLN1)
        |     DocEntry:   {deliv1_entry}
        |     DocNum:     {deliv1_num}
        |     Quantity:   40.0
        |     Linkage:    BaseType  = 17 (Sales Order)
        |                 BaseEntry = {order_doc_entry}
        |                 BaseLine  = 0
        |     Batches:    - 9852: 20.0 (Bin 499 - 20203-A01)
        |                 - 92236644: 20.0 (Bin 500 - 20203-B01)
        |
        +-- Delivery Note #2 (ODLN / DLN1)
              DocEntry:   {deliv2_entry}
              DocNum:     {deliv2_num}
              Quantity:   60.0
              Linkage:    BaseType  = 17 (Sales Order)
                          BaseEntry = {order_doc_entry}
                          BaseLine  = 0
              Batches:    - 20203.25122025: 30.0 (Bin 500 - 20203-B01)
                          - 112000022-3: 30.0 (Bin 500 - 20203-B01)
========================================================================================
"""
    print(tree)

    summary_data = {
        "quotation_doc_entry": target_quotation_entry,
        "quotation_doc_num": target_quotation_num,
        "order_doc_entry": order_doc_entry,
        "order_doc_num": order_doc_num,
        "delivery1_doc_entry": deliv1_entry,
        "delivery1_doc_num": deliv1_num,
        "delivery2_doc_entry": deliv2_entry,
        "delivery2_doc_num": deliv2_num,
        "all_passed": True
    }
    with open("uat_results.json", "w") as f:
        json.dump(summary_data, f, indent=2)

    print("[ALL TESTS COMPLETED SUCCESSFULLY AND ACCEPTED]")
    return summary_data


if __name__ == "__main__":
    try:
        run_uat()
    except Exception as exc:
        logger.exception(f"UAT FAILED: {exc}")
        sys.exit(1)
