"""
Views for Issue for Production workflow (Drafting, Review, Approval, and SAP Posting).
"""
import datetime
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import PendingIssue, PendingIssueLine, AuditLog
from .role_permissions import can_access_production, can_manage_production
from .services.sap_service import SAPServiceLayer
from .services.audit_service import (
    log_action,
    MODULE_PRODUCTION_ISSUE,
    ACTION_CREATE,
    ACTION_POST,
    ACTION_REJECT,
    ACTION_RECONCILE,
)
from .services.production_issue_payload_builder import (
    ProductionIssuePayloadBuilder,
    ProductionIssuePayloadValidationError,
)

sap = SAPServiceLayer()


def format_success_response(data, message=None, status_code=status.HTTP_200_OK):
    return Response({"success": True, "message": message, "data": data}, status=status_code)


def format_error_response(error, status_code=status.HTTP_400_BAD_REQUEST):
    return Response({"success": False, "error": str(error)}, status=status_code)


def validate_and_normalize_line_allocations(
    item_code: str,
    whs_code: str,
    issue_qty: float,
    allocations: list,
    sap_client,
    line_num: int = 0,
):
    """
    Validates batch and bin allocations against live SAP inventory (OBBQ / OBTN / OBIN).
    Ensures:
    1. Tracking requirements: Batch-managed items must have batch numbers; serial items must have serial numbers.
    2. Batch existence & warehouse stock in SAP.
    3. Bin allocation validation:
       - If batch is in only 1 physical bin, auto-resolves bin if omitted.
       - Disallows System Bins (SysBin='Y' / 14) when physical storage bins exist.
       - Rejects if the selected bin does not hold the batch in SAP.
       - Rejects if requested quantity exceeds available stock in that specific bin.
    4. Allocation quantities sum to exact issue_qty.
    Returns: (is_valid: bool, result_or_error: Union[list, str])
    """
    if not isinstance(allocations, list):
        return False, f"Line {line_num}: Allocations must be a list of objects."

    tracking_flags = sap_client.get_item_tracking_flags(item_code)
    man_batch = tracking_flags.get("manage_batches", False)
    man_serial = tracking_flags.get("manage_serials", False)

    if (man_batch or man_serial) and not allocations:
        kind = "batch" if man_batch else "serial"
        return False, f"Line {line_num} ({item_code}) is {kind}-managed and requires complete selection."

    if not allocations:
        return True, []

    # Retrieve live batch-bin stock from SAP
    stock_records = []
    if man_batch:
        try:
            stock_records = sap_client.get_batch_bin_stock(item_code, whs_code)
        except Exception:
            stock_records = []

    alloc_sum = 0.0
    normalized_list = []

    for idx, alloc in enumerate(allocations):
        if not isinstance(alloc, dict):
            return False, f"Line {line_num} allocation row {idx + 1} must be an object."

        batch_no = str(alloc.get("batch_number") or alloc.get("BatchNumber") or "").strip()
        serial_no = str(alloc.get("serial_number") or alloc.get("SerialNumber") or alloc.get("InternalSerialNumber") or "").strip()

        if man_batch and not batch_no:
            return False, f"Line {line_num} ({item_code}) allocation row {idx + 1} is missing a batch number."

        if man_serial and not (serial_no or batch_no):
            return False, f"Line {line_num} ({item_code}) allocation row {idx + 1} is missing a serial number."

        try:
            qty = float(alloc.get("quantity") or alloc.get("Quantity") or 0.0)
        except (ValueError, TypeError):
            return False, f"Line {line_num} allocation row {idx + 1} has an invalid quantity."

        if qty <= 0:
            return False, f"Line {line_num} allocation row {idx + 1} has non-positive quantity ({qty})."

        alloc_sum += qty

        # Batch-Bin Validation
        target_bin_abs = alloc.get("bin_abs_entry") if alloc.get("bin_abs_entry") is not None else alloc.get("BinAbsEntry")
        target_bin_code = str(alloc.get("bin_code") or alloc.get("BinCode") or "").strip()

        if man_batch and batch_no and stock_records:
            matching_stock = [s for s in stock_records if s.get("batch_number") == batch_no]

            if not matching_stock:
                return False, f"Line {line_num}: Batch '{batch_no}' not found in warehouse '{whs_code}' or has zero available inventory in SAP."

            physical_bins = [s for s in matching_stock if not s.get("is_system_bin") and s.get("bin_abs_entry") is not None]
            all_bins = [s for s in matching_stock if s.get("bin_abs_entry") is not None]

            if target_bin_abs in (None, ""):
                # Auto-resolve if exactly one bin exists
                if len(physical_bins) == 1:
                    target_bin_abs = physical_bins[0]["bin_abs_entry"]
                    target_bin_code = physical_bins[0]["bin_code"]
                elif len(all_bins) == 1 and not physical_bins:
                    target_bin_abs = all_bins[0]["bin_abs_entry"]
                    target_bin_code = all_bins[0]["bin_code"]
                elif all_bins:
                    bins_desc = ", ".join([f"{b['bin_code']} (AbsEntry: {b['bin_abs_entry']}, Available: {b['on_hand_qty']})" for b in matching_stock])
                    return False, f"Line {line_num}: Batch '{batch_no}' exists in multiple bin locations. A specific bin location must be selected. Available bins: {bins_desc}."
            else:
                try:
                    target_bin_abs = int(target_bin_abs)
                except (ValueError, TypeError):
                    return False, f"Line {line_num}: Invalid bin location AbsEntry '{target_bin_abs}' for batch '{batch_no}'."

                # Disallow system bin if physical storage bins exist
                is_sys = any(s.get("bin_abs_entry") == target_bin_abs and s.get("is_system_bin") for s in matching_stock)
                if is_sys and physical_bins:
                    phys_desc = ", ".join([f"{b['bin_code']} (AbsEntry: {b['bin_abs_entry']})" for b in physical_bins])
                    return False, f"Line {line_num}: System bin location '{target_bin_abs}' cannot be used for batch '{batch_no}' when physical storage bin(s) ({phys_desc}) are available."

                # Verify batch actually exists in target_bin_abs
                bin_match = next((s for s in matching_stock if s.get("bin_abs_entry") == target_bin_abs), None)
                if not bin_match and all_bins:
                    valid_desc = ", ".join([f"{b['bin_code']} (AbsEntry: {b['bin_abs_entry']})" for b in matching_stock])
                    return False, f"Line {line_num}: Batch '{batch_no}' has no stock in bin location '{target_bin_abs}'. Real location(s): {valid_desc}."

                if bin_match:
                    target_bin_code = bin_match.get("bin_code") or target_bin_code
                    bin_avail = float(bin_match.get("on_hand_qty") or 0.0)
                    if qty > bin_avail + 0.0001:
                        return False, (
                            f"Line {line_num}: Batch '{batch_no}' in bin location '{target_bin_code}' (AbsEntry: {target_bin_abs}) "
                            f"has insufficient stock (requested: {qty}, available: {bin_avail})."
                        )
        elif target_bin_abs not in (None, ""):
            try:
                target_bin_abs = int(target_bin_abs)
            except (ValueError, TypeError):
                pass

        norm_item = {
            "batch_number": batch_no,
            "quantity": qty,
        }
        if serial_no:
            norm_item["serial_number"] = serial_no
        if target_bin_abs not in (None, ""):
            norm_item["bin_abs_entry"] = target_bin_abs
        if target_bin_code:
            norm_item["bin_code"] = target_bin_code

        # Preserve any child bins if present
        if alloc.get("bins"):
            norm_item["bins"] = alloc.get("bins")

        normalized_list.append(norm_item)

    if abs(alloc_sum - issue_qty) > 0.0001:
        return False, f"Line {line_num} ({item_code}): Total allocated quantity ({alloc_sum}) does not match issue quantity ({issue_qty})."

    return True, normalized_list



def _pending_issue_to_dict(issue, include_lines=True):
    d = {
        "id": issue.id,
        "production_order_doc_entry": issue.production_order_doc_entry,
        "production_order_doc_num": issue.production_order_doc_num,
        "production_order_item_code": issue.production_order_item_code,
        "production_order_item_name": issue.production_order_item_name,
        "production_order_status": issue.production_order_status,
        "posting_date": issue.posting_date.isoformat() if issue.posting_date else None,
        "document_date": issue.document_date.isoformat() if issue.document_date else None,
        "comments": issue.comments,
        "journal_memo": issue.journal_memo,
        "total_components_count": issue.total_components_count,
        "total_quantity": issue.total_quantity,
        "status": issue.status,
        "created_by": issue.created_by.username if issue.created_by else None,
        "reviewed_by": issue.reviewed_by.username if issue.reviewed_by else None,
        "posted_by": issue.posted_by.username if issue.posted_by else None,
        "sap_doc_entry": issue.sap_doc_entry,
        "sap_doc_num": issue.sap_doc_num,
        "sap_error": issue.sap_error,
        "rejection_reason": issue.rejection_reason,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
        "reviewed_at": issue.reviewed_at.isoformat() if issue.reviewed_at else None,
        "posted_at": issue.posted_at.isoformat() if issue.posted_at else None,
    }
    if include_lines:
        lines = []
        for line in issue.lines.all().order_by("line_number"):
            lines.append({
                "id": line.id,
                "line_number": line.line_number,
                "item_code": line.item_code,
                "item_name": line.item_name,
                "uom_code": line.uom_code,
                "warehouse_code": line.warehouse_code,
                "issue_type": line.issue_type,
                "planned_quantity": line.planned_quantity,
                "issued_quantity_at_submit": line.issued_quantity_at_submit,
                "remaining_quantity_at_submit": line.remaining_quantity_at_submit,
                "issue_quantity": line.issue_quantity,
                "allocations": line.allocations_json or [],
            })
        d["lines"] = lines
    return d


def _claim_pending_issue_for_posting(issue_id, actor):
    """Atomically claim one postable issue without holding a lock during SAP I/O."""
    with transaction.atomic():
        try:
            pending = PendingIssue.objects.select_for_update().get(id=issue_id)
        except PendingIssue.DoesNotExist:
            return None, "Pending issue not found."

        if pending.status == PendingIssue.POSTED:
            return None, "This issue has already been posted to SAP."
        if pending.status == PendingIssue.POSTING:
            return None, "This issue is currently being posted to SAP."
        if pending.status == PendingIssue.FAILED and "[AMBIGUOUS_FAILURE]" in (pending.sap_error or ""):
            return None, "This issue experienced an ambiguous SAP response and requires reconciliation before posting can be attempted again."
        if pending.status not in [PendingIssue.PENDING_REVIEW, PendingIssue.FAILED]:
            return None, f"Issue in status '{pending.status}' is not available for posting."

        claimed = PendingIssue.objects.filter(
            id=pending.id,
            status=pending.status,
        ).update(
            status=PendingIssue.POSTING,
            posted_by=actor,
            sap_error="",
        )
        if claimed != 1:
            return None, "This issue is currently being posted to SAP."

        pending.refresh_from_db()
        return pending, None


@api_view(["POST"])
def create_pending_issue(request):
    """
    Save a draft Issue for Production for review.
    Does NOT call SAP InventoryGenExits.
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_access_production(request.user):
        return Response({"success": False, "error": "Production module access required"}, status=status.HTTP_403_FORBIDDEN)

    data = request.data or {}
    doc_entry = data.get("production_order_doc_entry") or data.get("ProductionOrderEntry") or data.get("DocEntry")
    if not doc_entry:
        return format_error_response("production_order_doc_entry is required.", status.HTTP_400_BAD_REQUEST)

    lines_data = data.get("lines") or data.get("Components") or []
    if not lines_data or not isinstance(lines_data, list):
        return format_error_response("At least one component line is required.", status.HTTP_400_BAD_REQUEST)

    # 1. Load current Production Order from SAP
    try:
        order = sap.get_production_order(int(doc_entry))
    except Exception as e:
        return format_error_response(f"Could not load Production Order from SAP: {e}", status.HTTP_400_BAD_REQUEST)

    if not order or (isinstance(order, dict) and order.get("error")):
        err_msg = order.get("error") if isinstance(order, dict) else "Order not found"
        return format_error_response(f"Production Order {doc_entry} not found in SAP: {err_msg}", status.HTTP_404_NOT_FOUND)

    # 2. Validate order status is Released
    order_status = order.get("ProductionOrderStatus") or order.get("Status")
    if order_status not in ["boposReleased", "R"]:
        return format_error_response(
            f"Production order must be in Released status to issue components (current status: {order_status}).",
            status.HTTP_400_BAD_REQUEST,
        )

    # 3. Validate component lines against SAP lines
    sap_lines = order.get("ProductionOrderLines") or []
    sap_lines_by_num = {
        line.get("LineNumber"): line
        for line in sap_lines
        if line.get("LineNumber") is not None
    }
    if not sap_lines_by_num:
        return format_error_response("Production order has no component lines in SAP.", status.HTTP_400_BAD_REQUEST)

    validated_lines = []
    seen_lines = set()

    for idx, line_input in enumerate(lines_data):
        line_num = line_input.get("line_number")
        if line_num is None:
            line_num = line_input.get("LineNumber")

        if line_num is None:
            return format_error_response(f"Row {idx + 1} is missing line_number.", status.HTTP_400_BAD_REQUEST)

        try:
            line_num = int(line_num)
        except (ValueError, TypeError):
            return format_error_response(f"Invalid line_number '{line_num}' at row {idx + 1}.", status.HTTP_400_BAD_REQUEST)

        if line_num in seen_lines:
            return format_error_response(f"Duplicate line_number {line_num} in request.", status.HTTP_400_BAD_REQUEST)
        seen_lines.add(line_num)

        sap_line = sap_lines_by_num.get(line_num)
        if not sap_line:
            return format_error_response(
                f"Line number {line_num} does not belong to Production Order {doc_entry}.",
                status.HTTP_400_BAD_REQUEST,
            )

        sap_item_code = str(sap_line.get("ItemNo") or sap_line.get("ItemCode") or "").strip()
        item_code = str(line_input.get("item_code") or line_input.get("ItemCode") or sap_item_code).strip()
        if item_code and sap_item_code and item_code != sap_item_code:
            return format_error_response(
                f"ItemCode '{item_code}' on line {line_num} does not match SAP line item '{sap_item_code}'.",
                status.HTTP_400_BAD_REQUEST,
            )

        planned_qty = float(sap_line.get("PlannedQuantity") or 0.0)
        issued_qty = float(sap_line.get("IssuedQuantity") or 0.0)
        remaining_qty = max(0.0, planned_qty - issued_qty)

        raw_qty = line_input.get("issue_quantity")
        if raw_qty is None:
            raw_qty = line_input.get("Quantity")

        try:
            issue_qty = float(raw_qty or 0.0)
        except (ValueError, TypeError):
            return format_error_response(f"Invalid issue quantity on line {line_num}.", status.HTTP_400_BAD_REQUEST)

        if issue_qty <= 0:
            return format_error_response(
                f"Issue quantity on line {line_num} must be greater than zero.",
                status.HTTP_400_BAD_REQUEST,
            )

        if issue_qty > remaining_qty + 0.0001:
            return format_error_response(
                f"Issue quantity ({issue_qty}) on line {line_num} exceeds remaining quantity ({remaining_qty}).",
                status.HTTP_400_BAD_REQUEST,
            )

        whs_code = str(line_input.get("warehouse_code") or sap_line.get("Warehouse") or "").strip()
        if not whs_code:
            return format_error_response(f"Warehouse code is missing for line {line_num}.", status.HTTP_400_BAD_REQUEST)

        # Check item tracking flags and validate allocations
        raw_allocations = line_input.get("allocations") or line_input.get("allocations_json") or line_input.get("Batches") or []
        is_valid, norm_allocs_or_err = validate_and_normalize_line_allocations(
            item_code=sap_item_code or item_code,
            whs_code=whs_code,
            issue_qty=issue_qty,
            allocations=raw_allocations,
            sap_client=sap,
            line_num=line_num,
        )
        if not is_valid:
            return format_error_response(norm_allocs_or_err, status.HTTP_400_BAD_REQUEST)

        validated_lines.append({
            "line_number": line_num,
            "item_code": sap_item_code or item_code,
            "item_name": str(sap_line.get("ItemDescription") or line_input.get("item_name") or ""),
            "uom_code": str(sap_line.get("UoMCode") or line_input.get("uom_code") or ""),
            "warehouse_code": whs_code,
            "issue_type": str(sap_line.get("ProductionOrderIssueType") or line_input.get("issue_type") or "Manual"),
            "planned_quantity": planned_qty,
            "issued_quantity": issued_qty,
            "remaining_quantity": remaining_qty,
            "issue_quantity": issue_qty,
            "allocations": norm_allocs_or_err,
        })

    posting_date_str = str(data.get("posting_date") or "").strip()
    try:
        posting_date = datetime.date.fromisoformat(posting_date_str.split("T")[0]) if posting_date_str else datetime.date.today()
    except ValueError:
        posting_date = datetime.date.today()

    doc_date_str = str(data.get("document_date") or "").strip()
    try:
        doc_date = datetime.date.fromisoformat(doc_date_str.split("T")[0]) if doc_date_str else posting_date
    except ValueError:
        doc_date = posting_date

    order_num = str(order.get("DocumentNumber") or order.get("DocNum") or doc_entry)
    item_code_header = str(order.get("ItemNo") or order.get("ItemCode") or "")
    item_name_header = str(order.get("ProductDescription") or order.get("ProdName") or "")
    comments = str(data.get("comments") or f"Issue for Production Order {order_num}").strip()
    journal_memo = str(data.get("journal_memo") or f"Issue for Production - {order_num}").strip()

    total_quantity = sum(vl["issue_quantity"] for vl in validated_lines)

    # 4. Atomically persist PendingIssue and PendingIssueLine
    with transaction.atomic():
        pending = PendingIssue.objects.create(
            production_order_doc_entry=int(doc_entry),
            production_order_doc_num=order_num,
            production_order_item_code=item_code_header,
            production_order_item_name=item_name_header,
            production_order_status=order_status,
            posting_date=posting_date,
            document_date=doc_date,
            comments=comments,
            journal_memo=journal_memo,
            total_components_count=len(validated_lines),
            total_quantity=total_quantity,
            status=PendingIssue.PENDING_REVIEW,
            created_by=request.user,
            raw_payload_json=data,
        )

        for vl in validated_lines:
            PendingIssueLine.objects.create(
                pending_issue=pending,
                line_number=vl["line_number"],
                item_code=vl["item_code"],
                item_name=vl["item_name"],
                uom_code=vl["uom_code"],
                warehouse_code=vl["warehouse_code"],
                issue_type=vl["issue_type"],
                planned_quantity=vl["planned_quantity"],
                issued_quantity_at_submit=vl["issued_quantity"],
                remaining_quantity_at_submit=vl["remaining_quantity"],
                issue_quantity=vl["issue_quantity"],
                allocations_json=vl["allocations"],
            )

    log_action(
        request=request,
        user=request.user,
        action=ACTION_CREATE,
        module=MODULE_PRODUCTION_ISSUE,
        entity_type="PendingIssue",
        entity_id=str(pending.id),
        description=f"Created pending issue #{pending.id} for Production Order #{pending.production_order_doc_num}",
        details={
            "order_number": pending.production_order_doc_num,
            "components_count": pending.total_components_count,
            "total_quantity": pending.total_quantity,
        },
    )

    return format_success_response(
        {
            "pending_issue_id": pending.id,
            "status": pending.status,
            "total_components": pending.total_components_count,
            "total_quantity": pending.total_quantity,
        },
        message="Issue submitted for review successfully.",
        status_code=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
def list_pending_issues(request):
    """
    List pending issues.
    Production Admins see all; regular production users see only their own.
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_access_production(request.user):
        return Response({"success": False, "error": "Production module access required"}, status=status.HTTP_403_FORBIDDEN)

    qs = PendingIssue.objects.select_related("created_by", "reviewed_by", "posted_by").prefetch_related("lines")

    if not can_manage_production(request.user):
        qs = qs.filter(created_by=request.user)

    status_filter = request.query_params.get("status")
    if status_filter:
        qs = qs.filter(status=status_filter.strip())

    order_num_filter = request.query_params.get("order_number")
    if order_num_filter:
        qs = qs.filter(production_order_doc_num=order_num_filter.strip())

    issues = list(qs)
    include_lines = request.query_params.get("include_lines", "").lower() in ("1", "true", "yes")

    return format_success_response({
        "issues": [_pending_issue_to_dict(issue, include_lines=include_lines) for issue in issues],
        "count": len(issues),
    })


@api_view(["GET"])
def get_pending_issue_detail(request, issue_id):
    """
    Get full detail of a single pending issue.
    Production Admins can view any; regular users only their own.
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_access_production(request.user):
        return Response({"success": False, "error": "Production module access required"}, status=status.HTTP_403_FORBIDDEN)

    try:
        issue = (
            PendingIssue.objects
            .select_related("created_by", "reviewed_by", "posted_by")
            .prefetch_related("lines")
            .get(id=issue_id)
        )
    except PendingIssue.DoesNotExist:
        return format_error_response("Pending issue not found.", status.HTTP_404_NOT_FOUND)

    if not can_manage_production(request.user) and issue.created_by != request.user:
        return Response({"success": False, "error": "Access denied to this pending issue."}, status=status.HTTP_403_FORBIDDEN)

    return format_success_response(_pending_issue_to_dict(issue, include_lines=True))


@api_view(["POST"])
def reject_pending_issue(request, issue_id):
    """
    Reject a pending issue.
    Production Admin only.
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_manage_production(request.user):
        return Response({"success": False, "error": "Production admin access required"}, status=status.HTTP_403_FORBIDDEN)

    reason = str(request.data.get("reason") or "").strip()
    if not reason:
        return format_error_response("Rejection reason is required.", status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        try:
            pending = PendingIssue.objects.select_for_update().get(id=issue_id)
        except PendingIssue.DoesNotExist:
            return format_error_response("Pending issue not found.", status.HTTP_404_NOT_FOUND)

        if pending.status == PendingIssue.POSTED:
            return format_error_response("Cannot reject an issue that has already been posted to SAP.", status.HTTP_409_CONFLICT)

        if pending.status == PendingIssue.POSTING:
            return format_error_response("Cannot reject an issue currently being posted to SAP.", status.HTTP_409_CONFLICT)

        if "[AMBIGUOUS_FAILURE]" in (pending.sap_error or ""):
            return format_error_response("Cannot reject an issue in ambiguous state. Reconciliation is required first.", status.HTTP_409_CONFLICT)

        pending.status = PendingIssue.REJECTED
        pending.rejection_reason = reason
        pending.reviewed_by = request.user
        pending.reviewed_at = timezone.now()
        pending.save()

    log_action(
        request=request,
        user=request.user,
        action=ACTION_REJECT,
        module=MODULE_PRODUCTION_ISSUE,
        entity_type="PendingIssue",
        entity_id=str(pending.id),
        description=f"Rejected pending issue #{pending.id} for Order #{pending.production_order_doc_num}",
        details={
            "order_number": pending.production_order_doc_num,
            "reason": reason,
        },
    )

    return format_success_response(
        _pending_issue_to_dict(pending, include_lines=False),
        message="Issue rejected successfully.",
    )


def _is_ambiguous_error(error_text):
    """Detect if an error indicates transport/gateway timeout or ambiguous response."""
    if not error_text:
        return False
    lower = str(error_text).lower()
    ambiguous_keywords = [
        "timeout",
        "timed out",
        "time out",
        "connection reset",
        "connection refused",
        "connection aborted",
        "remote disconnected",
        "max retries exceeded",
        "without docentry",
        "without docnum",
        "502",
        "503",
        "504",
        "bad gateway",
        "gateway timeout",
        "service unavailable",
    ]
    return any(kw in lower for kw in ambiguous_keywords)


def _mark_issue_failed(pending, error_message):
    """Mark an issue definitively failed (safe to retry)."""
    try:
        with transaction.atomic():
            locked = PendingIssue.objects.select_for_update().get(id=pending.id)
            locked.status = PendingIssue.FAILED
            locked.sap_error = str(error_message)
            locked.save(update_fields=["status", "sap_error", "updated_at"])
    except Exception as exc:
        print(f"[ISSUE-POST] Failed to update issue status to FAILED: {exc}")


def _mark_issue_ambiguous(pending, error_message):
    """Mark an issue in ambiguous state requiring reconciliation before posting can be re-attempted."""
    try:
        with transaction.atomic():
            locked = PendingIssue.objects.select_for_update().get(id=pending.id)
            locked.status = PendingIssue.FAILED
            locked.sap_error = f"[AMBIGUOUS_FAILURE] {error_message}"
            locked.save(update_fields=["status", "sap_error", "updated_at"])
    except Exception as exc:
        print(f"[ISSUE-POST] Failed to update issue status to AMBIGUOUS: {exc}")


@api_view(["POST"])
def approve_post_pending_issue(request, issue_id):
    """
    Approve and post a pending issue to SAP InventoryGenExits.
    Production Admin only.
    Guaranteed atomic claim & duplicate posting protection.
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_manage_production(request.user):
        return Response({"success": False, "error": "Production admin access required"}, status=status.HTTP_403_FORBIDDEN)

    # 1. Atomic claim lock (select_for_update)
    pending, claim_error = _claim_pending_issue_for_posting(issue_id, request.user)
    if claim_error:
        claim_err_lower = claim_error.lower()
        if "already been posted" in claim_err_lower or "currently being posted" in claim_err_lower or "ambiguous" in claim_err_lower:
            return format_error_response(claim_error, status.HTTP_409_CONFLICT)
        if "not found" in claim_err_lower:
            return format_error_response(claim_error, status.HTTP_404_NOT_FOUND)
        return format_error_response(claim_error, status.HTTP_400_BAD_REQUEST)

    # 2. Outside DB lock: Re-fetch and revalidate Production Order from SAP
    try:
        order = sap.get_production_order(int(pending.production_order_doc_entry))
    except Exception as e:
        _mark_issue_failed(pending, f"Could not revalidate Production Order from SAP: {e}")
        return format_error_response(f"Could not revalidate Production Order from SAP: {e}", status.HTTP_400_BAD_REQUEST)

    if not order or (isinstance(order, dict) and order.get("error")):
        err = order.get("error") if isinstance(order, dict) else "Order not found"
        _mark_issue_failed(pending, f"Production Order {pending.production_order_doc_entry} not found in SAP: {err}")
        return format_error_response(f"Production Order not found in SAP: {err}", status.HTTP_400_BAD_REQUEST)

    order_status = order.get("ProductionOrderStatus") or order.get("Status")
    if order_status not in ["boposReleased", "R"]:
        err = f"Production Order status is no longer Released ({order_status})."
        _mark_issue_failed(pending, err)
        return format_error_response(err, status.HTTP_400_BAD_REQUEST)

    # 3. Live component lines and remaining quantity revalidation
    sap_lines = order.get("ProductionOrderLines", [])
    sap_lines_by_num = {}
    for sl in sap_lines:
        ln = sl.get("LineNumber")
        if ln is None:
            ln = sl.get("LineNum")
        if ln is not None:
            try:
                sap_lines_by_num[int(ln)] = sl
            except (ValueError, TypeError):
                pass

    pending_lines = list(pending.lines.all().order_by("line_number"))
    if not pending_lines:
        err = "Pending issue has no component lines."
        _mark_issue_failed(pending, err)
        return format_error_response(err, status.HTTP_400_BAD_REQUEST)

    for pl in pending_lines:
        sl = sap_lines_by_num.get(pl.line_number)
        if not sl:
            err = f"Component line {pl.line_number} (Item: {pl.item_code}) no longer exists in SAP Production Order."
            _mark_issue_failed(pending, err)
            return format_error_response(err, status.HTTP_400_BAD_REQUEST)

        sap_item = str(sl.get("ItemNo") or sl.get("ItemCode") or "").strip()
        if sap_item and pl.item_code and sap_item != pl.item_code:
            err = f"Component line {pl.line_number} item code mismatch: draft has '{pl.item_code}', but live SAP has '{sap_item}'."
            _mark_issue_failed(pending, err)
            return format_error_response(err, status.HTTP_400_BAD_REQUEST)

        live_planned = float(sl.get("PlannedQuantity") or 0.0)
        live_issued = float(sl.get("IssuedQuantity") or 0.0)
        live_remaining = max(0.0, live_planned - live_issued)

        if float(pl.issue_quantity) > live_remaining + 0.0001:
            err = (
                f"Requested issue quantity ({pl.issue_quantity}) for line {pl.line_number} ({pl.item_code}) "
                f"exceeds live SAP remaining quantity ({live_remaining:.4f})."
            )
            _mark_issue_failed(pending, err)
            return format_error_response(err, status.HTTP_400_BAD_REQUEST)

    # 4. Live Batch & Bin allocation revalidation
    for pl in pending_lines:
        is_valid, norm_allocs_or_err = validate_and_normalize_line_allocations(
            item_code=pl.item_code,
            whs_code=pl.warehouse_code,
            issue_qty=float(pl.issue_quantity),
            allocations=pl.allocations_json or [],
            sap_client=sap,
            line_num=pl.line_number,
        )
        if not is_valid:
            err = f"Line {pl.line_number} ({pl.item_code}) validation failed: {norm_allocs_or_err}"
            _mark_issue_failed(pending, err)
            return format_error_response(err, status.HTTP_400_BAD_REQUEST)

        # If normalization updated bins (e.g. auto-resolved single bin), persist to DB
        if norm_allocs_or_err != pl.allocations_json:
            pl.allocations_json = norm_allocs_or_err
            pl.save(update_fields=["allocations_json"])

    # 5. Build SAP InventoryGenExits payload from authoritative database records
    builder = ProductionIssuePayloadBuilder()
    try:
        sap_payload = builder.build(pending)
    except ProductionIssuePayloadValidationError as ve:
        _mark_issue_failed(pending, str(ve))
        return format_error_response(str(ve), status.HTTP_400_BAD_REQUEST)

    # 6. POST to SAP Service Layer InventoryGenExits
    try:
        result = sap.create_issue_for_production(sap_payload)
    except Exception as exc:
        result = {"error": str(exc), "success": False}

    if isinstance(result, dict) and result.get("error"):
        error_text = str(result.get("error"))
        if _is_ambiguous_error(error_text):
            _mark_issue_ambiguous(pending, error_text)
            try:
                log_action(
                    request=request,
                    user=request.user,
                    action=ACTION_POST,
                    status=AuditLog.STATUS_WARNING,
                    module=MODULE_PRODUCTION_ISSUE,
                    entity_type="PendingIssue",
                    entity_id=str(pending.id),
                    description=f"Ambiguous SAP response for Goods Issue for Production Order #{pending.production_order_doc_num}",
                    details={"error": error_text, "ambiguous": True},
                )
            except Exception:
                pass
            return format_error_response(
                f"Ambiguous SAP response: {error_text}. Reconciliation is required before posting can be re-attempted.",
                status.HTTP_502_BAD_GATEWAY,
            )

        _mark_issue_failed(pending, error_text)
        try:
            log_action(
                request=request,
                user=request.user,
                action=ACTION_POST,
                status="FAILED",
                module=MODULE_PRODUCTION_ISSUE,
                entity_type="PendingIssue",
                entity_id=str(pending.id),
                description=f"Failed to post Goods Issue for Production Order #{pending.production_order_doc_num} to SAP",
                details={"error": error_text},
            )
        except Exception:
            pass
        return format_error_response(f"SAP Goods Issue failed: {error_text}", status.HTTP_400_BAD_REQUEST)

    sap_doc_entry = str(result.get("DocEntry") or "") if isinstance(result, dict) else ""
    sap_doc_num = str(result.get("DocNum") or "") if isinstance(result, dict) else ""

    if not sap_doc_entry and not sap_doc_num:
        error_text = "SAP returned response without DocEntry or DocNum."
        _mark_issue_ambiguous(pending, error_text)
        try:
            log_action(
                request=request,
                user=request.user,
                action=ACTION_POST,
                status=AuditLog.STATUS_WARNING,
                module=MODULE_PRODUCTION_ISSUE,
                entity_type="PendingIssue",
                entity_id=str(pending.id),
                description=f"Ambiguous SAP response for Order #{pending.production_order_doc_num}: missing DocEntry/DocNum",
                details={"error": error_text, "ambiguous": True},
            )
        except Exception:
            pass
        return format_error_response(
            f"Ambiguous SAP response: {error_text}. Reconciliation is required.",
            status.HTTP_502_BAD_GATEWAY,
        )

    # 7. Irreversible commit of POSTED state and SAP identifiers
    now = timezone.now()
    with transaction.atomic():
        locked = PendingIssue.objects.select_for_update().get(id=pending.id)
        locked.status = PendingIssue.POSTED
        locked.sap_doc_entry = sap_doc_entry
        locked.sap_doc_num = sap_doc_num
        locked.sap_error = ""
        locked.posted_at = now
        locked.posted_by = request.user
        locked.reviewed_at = now
        locked.reviewed_by = request.user
        locked.save()

    # Fail-safe audit logging (cannot downgrade POSTED state)
    try:
        log_action(
            request=request,
            user=request.user,
            action=ACTION_POST,
            status="SUCCESS",
            module=MODULE_PRODUCTION_ISSUE,
            entity_type="PendingIssue",
            entity_id=str(pending.id),
            description=f"Posted Goods Issue for Production Order #{pending.production_order_doc_num} (SAP #{sap_doc_num})",
            details={
                "sap_doc_num": sap_doc_num,
                "sap_doc_entry": sap_doc_entry,
                "order_number": pending.production_order_doc_num,
                "components_count": pending.total_components_count,
                "total_quantity": pending.total_quantity,
            },
        )
    except Exception as audit_err:
        print(f"[ISSUE-POST] Post-commit audit logging error (issue #{pending.id} remains POSTED): {audit_err}")

    return format_success_response({
        "pending_issue_id": pending.id,
        "status": PendingIssue.POSTED,
        "sap_doc_num": sap_doc_num,
        "sap_doc_entry": sap_doc_entry,
    }, message="Issue posted to SAP successfully.")


def _verify_sap_issue_document(sap_doc, pending):
    """
    Deterministically verifies that an SAP InventoryGenExits document corresponds
    to the given PendingIssue.
    Returns (True, None) if compatible, or (False, reason) if not compatible.
    """
    if not isinstance(sap_doc, dict) or sap_doc.get("error"):
        err = sap_doc.get("error") if isinstance(sap_doc, dict) else "Invalid document format"
        return False, f"SAP document could not be retrieved: {err}"

    sap_lines = sap_doc.get("DocumentLines", [])
    if not sap_lines:
        return False, "SAP document contains no DocumentLines."

    doc_entry = int(pending.production_order_doc_entry)
    prod_lines = [
        sl for sl in sap_lines
        if str(sl.get("BaseType")) == "202" and int(sl.get("BaseEntry") or -1) == doc_entry
    ]

    pending_lines = list(pending.lines.all().order_by("line_number"))
    if not pending_lines:
        return False, "Pending issue has no component lines."

    if len(prod_lines) != len(pending_lines):
        return False, f"SAP document has {len(prod_lines)} lines for order {doc_entry}, but draft has {len(pending_lines)}."

    sap_lines_by_baseline = {}
    for sl in prod_lines:
        bl = sl.get("BaseLine")
        if bl is not None:
            try:
                sap_lines_by_baseline[int(bl)] = sl
            except (ValueError, TypeError):
                pass

    for pl in pending_lines:
        sl = sap_lines_by_baseline.get(pl.line_number)
        if not sl:
            return False, f"Component line {pl.line_number} not found in SAP document."

        sap_item = str(sl.get("ItemCode") or sl.get("ItemNo") or "").strip()
        if sap_item and str(pl.item_code).strip() != sap_item:
            return False, f"Line {pl.line_number} item code mismatch: SAP '{sap_item}' vs draft '{pl.item_code}'."

        sap_qty = float(sl.get("Quantity") or 0.0)
        draft_qty = float(pl.issue_quantity or 0.0)
        if abs(sap_qty - draft_qty) > 0.0001:
            return False, f"Line {pl.line_number} quantity mismatch: SAP {sap_qty} vs draft {draft_qty}."

        if pl.warehouse_code:
            sap_whs = str(sl.get("WarehouseCode") or sl.get("Warehouse") or "").strip()
            if sap_whs and str(pl.warehouse_code).strip() != sap_whs:
                return False, f"Line {pl.line_number} warehouse mismatch: SAP '{sap_whs}' vs draft '{pl.warehouse_code}'."

    return True, None


@api_view(["POST"])
def reconcile_pending_issue(request, issue_id):
    """
    Reconcile an issue in ambiguous failure state or in-flight state.
    Production Admin only.
    Checks whether SAP actually created the InventoryGenExits document.
    - If found in SAP: transitions issue to POSTED with verified sap_doc_entry / sap_doc_num.
    - If confirmed not in SAP: clears ambiguous marker and resets to FAILED (safe to retry).
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_manage_production(request.user):
        return Response({"success": False, "error": "Production admin access required"}, status=status.HTTP_403_FORBIDDEN)

    with transaction.atomic():
        try:
            pending = PendingIssue.objects.select_for_update().get(id=issue_id)
        except PendingIssue.DoesNotExist:
            return format_error_response("Pending issue not found.", status.HTTP_404_NOT_FOUND)

        if pending.status == PendingIssue.POSTED:
            return format_success_response({
                "pending_issue_id": pending.id,
                "status": pending.status,
                "sap_doc_num": pending.sap_doc_num,
                "sap_doc_entry": pending.sap_doc_entry,
                "reconciliation_result": "ALREADY_POSTED",
            }, message="Issue is already posted to SAP.")

        is_ambiguous = (pending.status == PendingIssue.POSTING) or ("[AMBIGUOUS_FAILURE]" in (pending.sap_error or ""))
        if not is_ambiguous:
            return format_error_response(
                "This issue is not in an ambiguous or in-flight state requiring reconciliation.",
                status.HTTP_400_BAD_REQUEST,
            )

    manual_entry = request.data.get("sap_doc_entry")
    manual_num = request.data.get("sap_doc_num")
    now = timezone.now()

    # Manual reconciliation: verify user-supplied document against SAP
    if manual_entry or manual_num:
        doc_entry_lookup = manual_entry or manual_num
        try:
            sap_doc = sap.get_issue_for_production(doc_entry_lookup) if hasattr(sap, "get_issue_for_production") else sap._request("GET", f"InventoryGenExits({doc_entry_lookup})")
        except Exception as exc:
            return format_error_response(f"Could not connect to SAP to verify document #{doc_entry_lookup}: {exc}", status.HTTP_502_BAD_GATEWAY)

        is_valid, err_reason = _verify_sap_issue_document(sap_doc, pending)
        if not is_valid:
            return format_error_response(
                f"SAP document #{doc_entry_lookup} does not correspond to this Issue draft: {err_reason}",
                status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            locked = PendingIssue.objects.select_for_update().get(id=pending.id)
            if locked.status == PendingIssue.POSTED:
                return format_success_response({
                    "pending_issue_id": locked.id,
                    "status": locked.status,
                    "sap_doc_num": locked.sap_doc_num,
                    "sap_doc_entry": locked.sap_doc_entry,
                    "reconciliation_result": "ALREADY_POSTED",
                }, message="Issue is already posted to SAP.")

            locked.status = PendingIssue.POSTED
            locked.sap_doc_entry = str(sap_doc.get("DocEntry") or doc_entry_lookup)
            locked.sap_doc_num = str(sap_doc.get("DocNum") or manual_num or locked.sap_doc_entry)
            locked.sap_error = ""
            locked.posted_at = now
            locked.posted_by = request.user
            locked.reviewed_at = now
            locked.reviewed_by = request.user
            locked.save()

            try:
                log_action(
                    request=request,
                    user=request.user,
                    action=ACTION_RECONCILE,
                    status="SUCCESS",
                    module=MODULE_PRODUCTION_ISSUE,
                    entity_type="PendingIssue",
                    entity_id=str(locked.id),
                    description=f"Manually reconciled issue #{locked.id} with verified SAP #{locked.sap_doc_num}",
                    details={"manual": True, "sap_doc_num": locked.sap_doc_num, "sap_doc_entry": locked.sap_doc_entry},
                )
            except Exception:
                pass

            return format_success_response({
                "pending_issue_id": locked.id,
                "status": locked.status,
                "sap_doc_num": locked.sap_doc_num,
                "sap_doc_entry": locked.sap_doc_entry,
                "reconciliation_result": "MANUALLY_LINKED",
            }, message="Issue reconciled and linked to verified SAP document.")

    # Automated reconciliation: inspect SAP state
    try:
        order = sap.get_production_order(int(pending.production_order_doc_entry))
    except Exception as exc:
        return format_error_response(
            f"Could not connect to SAP to reconcile issue: {exc}. Ambiguous status remains.",
            status.HTTP_502_BAD_GATEWAY,
        )

    if not order or (isinstance(order, dict) and order.get("error")):
        return format_error_response(
            "Could not fetch Production Order from SAP to verify status. Ambiguous status remains.",
            status.HTTP_502_BAD_GATEWAY,
        )

    # Check SAP InventoryGenExits for this Production Order
    doc_entry = int(pending.production_order_doc_entry)
    matching_docs = []

    try:
        filter_str = f"DocDate ge '{pending.posting_date.isoformat()}'" if pending.posting_date else ""
        endpoint = "InventoryGenExits?$orderby=DocEntry desc&$top=50"
        if filter_str:
            endpoint = f"InventoryGenExits?$filter={filter_str}&$orderby=DocEntry desc&$top=50"
        exits_resp = sap._request("GET", endpoint) if hasattr(sap, "_request") else None
        exits_list = exits_resp.get("value", []) if isinstance(exits_resp, dict) else []

        for ex in exits_list:
            is_match, _ = _verify_sap_issue_document(ex, pending)
            if is_match:
                matching_docs.append(ex)
    except Exception as q_err:
        print(f"[RECONCILE] Error checking InventoryGenExits: {q_err}")

    # Multiple matching documents protection
    if len(matching_docs) > 1:
        return format_error_response(
            f"Multiple matching SAP Goods Issues found ({len(matching_docs)} documents). Manual document verification is required to avoid linking the wrong document.",
            status.HTTP_409_CONFLICT,
        )

    with transaction.atomic():
        locked = PendingIssue.objects.select_for_update().get(id=pending.id)

        # Concurrency safety: if another thread posted it while we were inspecting SAP, do not mutate
        if locked.status == PendingIssue.POSTED:
            return format_success_response({
                "pending_issue_id": locked.id,
                "status": locked.status,
                "sap_doc_num": locked.sap_doc_num,
                "sap_doc_entry": locked.sap_doc_entry,
                "reconciliation_result": "ALREADY_POSTED",
            }, message="Issue is already posted to SAP.")

        if len(matching_docs) == 1:
            found_doc = matching_docs[0]
            found_doc_entry = str(found_doc.get("DocEntry") or "")
            found_doc_num = str(found_doc.get("DocNum") or found_doc_entry)

            locked.status = PendingIssue.POSTED
            locked.sap_doc_entry = found_doc_entry
            locked.sap_doc_num = found_doc_num
            locked.sap_error = ""
            locked.posted_at = now
            locked.posted_by = request.user
            locked.reviewed_at = now
            locked.reviewed_by = request.user
            locked.save()

            try:
                log_action(
                    request=request,
                    user=request.user,
                    action=ACTION_RECONCILE,
                    status="SUCCESS",
                    module=MODULE_PRODUCTION_ISSUE,
                    entity_type="PendingIssue",
                    entity_id=str(locked.id),
                    description=f"Reconciled issue #{locked.id}: confirmed created in SAP #{found_doc_num}",
                    details={"sap_doc_num": found_doc_num, "sap_doc_entry": found_doc_entry},
                )
            except Exception:
                pass

            return format_success_response({
                "pending_issue_id": locked.id,
                "status": locked.status,
                "sap_doc_num": found_doc_num,
                "sap_doc_entry": found_doc_entry,
                "reconciliation_result": "FOUND_AND_LINKED",
            }, message="Confirmed document was created in SAP. Issue marked POSTED.")

        # Document was definitely NOT created in SAP
        locked.status = PendingIssue.FAILED
        locked.sap_error = "Reconciled with SAP: Document was not found in SAP. Safe to retry."
        locked.save()

        try:
            log_action(
                request=request,
                user=request.user,
                action=ACTION_RECONCILE,
                status="SUCCESS",
                module=MODULE_PRODUCTION_ISSUE,
                entity_type="PendingIssue",
                entity_id=str(locked.id),
                description=f"Reconciled issue #{locked.id}: confirmed not in SAP; cleared for retry",
                details={"cleared": True},
            )
        except Exception:
            pass

        return format_success_response({
            "pending_issue_id": locked.id,
            "status": locked.status,
            "sap_error": locked.sap_error,
            "reconciliation_result": "CLEARED_FOR_RETRY",
        }, message="Reconciliation confirmed the document was not created in SAP. Safe to retry.")


@api_view(["GET"])
def get_production_issue_available_batches(request):
    """
    Fetch in-stock batches from SAP Business One for a given item and warehouse for Production Issue.
    Uses SAP SQL query CD_BATCHES_BY_ITEM (with fallback to CD_BATCHES_OBTQ).
    Filters out any batches with OnHandQty <= 0.
    """
    if not request.user.is_authenticated:
        return Response({"success": False, "error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    if not can_access_production(request.user):
        return Response({"success": False, "error": "Production module access required"}, status=status.HTTP_403_FORBIDDEN)

    item_code = request.query_params.get("item_code", "").strip()
    warehouse_code = request.query_params.get("warehouse_code", "").strip()

    if not item_code:
        return Response(
            {"success": False, "error": "item_code query parameter is required", "batches": []},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        batches = sap.get_batch_bin_stock(item_code, warehouse_code)
        return Response({"success": True, "batches": batches})
    except Exception as exc:
        return Response({"success": True, "batches": [], "error": str(exc)})

