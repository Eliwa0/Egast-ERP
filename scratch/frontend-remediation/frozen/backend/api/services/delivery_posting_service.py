import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from django.db import transaction, IntegrityError
from django.utils import timezone

from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
from api.services.delivery_payload_builder import (
    DeliveryPayloadBuilder,
    DeliveryPayloadValidationError,
)
from api.services.sap_service import SAPServiceLayer
from api.services.sales_order_service import _sap_error_message

logger = logging.getLogger(__name__)


class DeliveryStateError(ValueError):
    pass


class DeliveryPostingError(Exception):
    def __init__(self, message, sap_response=None, is_ambiguous=False):
        super().__init__(message)
        self.message = str(message)
        self.sap_response = sap_response or {}
        self.is_ambiguous = is_ambiguous


def calculate_line_open_quantity(sap_line: Dict[str, Any]) -> float:
    """
    Computes the remaining open quantity for a Sales Order line (RDR1) from SAP.
    Prefers RemainingOpenQuantity, then OpenQuantity, then OpenQty, then Quantity - DeliveredQuantity.
    """
    if sap_line.get("LineStatus") == "bost_Close":
        return 0.0

    rem = sap_line.get("RemainingOpenQuantity")
    if rem is not None:
        return max(0.0, float(rem))

    opn = sap_line.get("OpenQuantity")
    if opn is not None:
        return max(0.0, float(opn))

    opn_qty = sap_line.get("OpenQty")
    if opn_qty is not None:
        return max(0.0, float(opn_qty))

    total = float(sap_line.get("Quantity") or 0.0)
    delivered = float(sap_line.get("DeliveredQuantity") or 0.0)
    return max(0.0, total - delivered)


class DeliveryPostingService:
    """
    Manages the full lifecycle of Delivery drafts and native SAP Delivery Note (ODLN) posting:
    Draft Creation -> Line/Batch Allocation -> Manager Review -> Live OpenQty Re-verification -> Native Posting.
    """

    def __init__(self, sap_client=None):
        self.sap_client = sap_client or SAPServiceLayer()
        self.payload_builder = DeliveryPayloadBuilder()

    def create_draft(
        self,
        user,
        sales_order_doc_entry: int,
        lines_data: Optional[List[Dict[str, Any]]] = None,
        doc_date: Optional[Any] = None,
        doc_due_date: Optional[Any] = None,
        comments: str = "",
        cost_center_1: Optional[str] = None,
        cost_center_2: Optional[str] = None,
        cost_center_3: Optional[str] = None,
    ) -> DeliveryDraft:
        """
        Creates a new DeliveryDraft linked to an existing open SAP Sales Order (ORDR).
        Populates lines and verifies that open quantities exist.
        """
        order = self.sap_client.get_sales_order(sales_order_doc_entry)
        if not order or (isinstance(order, dict) and order.get("error")):
            err_msg = order.get("error") if isinstance(order, dict) else "Order not found"
            raise DeliveryStateError(f"Cannot initialize delivery: {err_msg}")

        doc_num = str(order.get("DocNum") or sales_order_doc_entry)
        card_code = str(order.get("CardCode") or "")
        card_name = str(order.get("CardName") or "")
        doc_status = str(order.get("DocumentStatus") or "")

        if doc_status == "bost_Close":
            raise DeliveryStateError(f"Sales Order #{doc_num} is closed in SAP.")

        sap_lines = order.get("DocumentLines") or []
        if not sap_lines:
            raise DeliveryStateError(f"Sales Order #{doc_num} has no line items.")

        # Determine dates
        raw_order_date = order.get("DocDate")
        order_doc_date = str(raw_order_date).split("T")[0] if raw_order_date else None
        resolved_doc_date = doc_date or order_doc_date or date.today()
        raw_due_date = order.get("DocDueDate")
        if doc_due_date:
            resolved_due_date = doc_due_date
        elif raw_due_date:
            resolved_due_date = str(raw_due_date).split("T")[0]
        else:
            resolved_due_date = resolved_doc_date

        with transaction.atomic():
            # Check for conflicting in-progress drafts
            existing_active = DeliveryDraft.objects.filter(
                sales_order_doc_entry=sales_order_doc_entry,
                status__in=[
                    DeliveryDraft.STATUS_DRAFT,
                    DeliveryDraft.STATUS_PENDING_REVIEW,
                    DeliveryDraft.STATUS_APPROVED,
                    DeliveryDraft.STATUS_POSTING,
                ],
            ).first()
            if existing_active:
                raise DeliveryStateError(
                    f"An active Delivery Draft (#{existing_active.id}, Status: {existing_active.status}) "
                    f"already exists for Sales Order #{doc_num}."
                )

            try:
                with transaction.atomic():
                    draft = DeliveryDraft.objects.create(
                        sales_order_doc_entry=sales_order_doc_entry,
                        sales_order_doc_num=doc_num,
                        customer_code=card_code,
                        customer_name=card_name,
                        status=DeliveryDraft.STATUS_DRAFT,
                        doc_date=resolved_doc_date,
                        doc_due_date=resolved_due_date,
                        comments=comments,
                        cost_center_1=str(cost_center_1 or "").strip(),
                        cost_center_2=str(cost_center_2 or "").strip(),
                        cost_center_3=str(cost_center_3 or "").strip(),
                        created_by=user,
                    )
            except IntegrityError as exc:
                # The pre-check cannot serialize two operators creating the first
                # draft simultaneously. A partial unique constraint arbitrates;
                # the savepoint keeps this transaction usable for classification.
                if DeliveryDraft.objects.filter(sales_order_doc_entry=sales_order_doc_entry,
                        status__in=['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTING']).exists():
                    raise DeliveryStateError(f'An active Delivery Draft already exists for Sales Order #{doc_num}.') from exc
                raise

            override_by_line = {
                int(l.get("line_number", l.get("LineNum"))): l
                for l in (lines_data or [])
                if l.get("line_number") is not None or l.get("LineNum") is not None
            }

            has_deliverable_line = False

            for s_line in sap_lines:
                line_num = int(s_line.get("LineNum"))
                item_code = str(s_line.get("ItemCode") or "")
                desc = str(s_line.get("ItemDescription") or "")
                uom = str(s_line.get("UoMCode") or s_line.get("UomCode") or s_line.get("MeasureUnit") or "")
                order_qty = float(s_line.get("Quantity") or 0.0)
                open_qty = calculate_line_open_quantity(s_line)
                whs = str(s_line.get("WarehouseCode") or "").strip()

                if open_qty <= 0 and line_num not in override_by_line:
                    # Skip completely delivered lines unless explicitly requested
                    continue

                override = override_by_line.get(line_num, {})
                # If explicit lines_data was passed, use requested delivery quantity;
                # otherwise default to full open quantity
                if lines_data is not None:
                    deliv_qty = float(override.get("delivery_quantity", 0.0))
                else:
                    deliv_qty = open_qty

                if deliv_qty > open_qty + 0.0001:
                    raise DeliveryStateError(
                        f"Requested delivery quantity ({deliv_qty}) for line {line_num} "
                        f"exceeds SAP open quantity ({open_qty})."
                    )

                line_whs = str(override.get("warehouse_code", whs)).strip()

                draft_line = DeliveryDraftLine.objects.create(
                    draft=draft,
                    line_number=line_num,
                    item_code=item_code,
                    item_description=desc,
                    uom=uom,
                    order_quantity=order_qty,
                    open_quantity_at_draft=open_qty,
                    delivery_quantity=deliv_qty,
                    warehouse_code=line_whs,
                )

                # Process batches if specified
                batches = override.get("batches") or []
                if batches:
                    b_sum = 0.0
                    for b_data in batches:
                        b_qty = float(b_data.get("quantity") or 0.0)
                        b_sum += b_qty
                        DeliveryDraftBatch.objects.create(
                            line=draft_line,
                            batch_number=str(b_data.get("batch_number", "")).strip(),
                            quantity=b_qty,
                            bin_abs_entry=b_data.get("bin_abs_entry"),
                            bin_code=str(b_data.get("bin_code", "")).strip(),
                        )
                    if abs(b_sum - deliv_qty) > 0.0001:
                        raise DeliveryStateError(
                            f"Batch allocation sum ({b_sum}) does not match line delivery quantity ({deliv_qty}) for line {line_num}."
                        )

                if deliv_qty > 0:
                    has_deliverable_line = True

            if not draft.lines.exists():
                raise DeliveryStateError(f"No deliverable lines found on Sales Order #{doc_num}.")

        return draft

    def update_draft(
        self,
        draft: DeliveryDraft,
        lines_data: List[Dict[str, Any]],
        user,
        comments: Optional[str] = None,
        doc_date: Optional[Any] = None,
        doc_due_date: Optional[Any] = None,
        cost_center_1: Optional[str] = None,
        cost_center_2: Optional[str] = None,
        cost_center_3: Optional[str] = None,
    ) -> DeliveryDraft:
        """
        Updates delivery quantities and batch/bin allocations on a draft.
        Draft must be in DRAFT or REJECTED status.
        """
        if draft.status not in [DeliveryDraft.STATUS_DRAFT, DeliveryDraft.STATUS_REJECTED]:
            raise DeliveryStateError(f"Cannot edit Delivery Draft in status '{draft.status}'.")

        from api.services.shipping_service import assert_delivery_manifest
        try:
            assert_delivery_manifest(draft, lines_data)
        except ValueError as exc:
            raise DeliveryStateError(str(exc)) from exc

        with transaction.atomic():
            if comments is not None:
                draft.comments = str(comments).strip()
            if doc_date:
                draft.doc_date = doc_date
            if doc_due_date:
                draft.doc_due_date = doc_due_date
            if cost_center_1 is not None:
                draft.cost_center_1 = str(cost_center_1).strip()
            if cost_center_2 is not None:
                draft.cost_center_2 = str(cost_center_2).strip()
            if cost_center_3 is not None:
                draft.cost_center_3 = str(cost_center_3).strip()

            for line_in in lines_data:
                line_num = int(line_in.get("line_number", line_in.get("LineNum")))
                line_obj = draft.lines.filter(line_number=line_num).first()
                if not line_obj:
                    continue

                if "delivery_quantity" in line_in:
                    qty = float(line_in["delivery_quantity"])
                    if qty < 0:
                        raise DeliveryStateError(f"Line {line_num} delivery quantity cannot be negative.")
                    if qty > line_obj.open_quantity_at_draft + 0.0001:
                        raise DeliveryStateError(
                            f"Line {line_num} quantity ({qty}) exceeds open quantity ({line_obj.open_quantity_at_draft})."
                        )
                    line_obj.delivery_quantity = qty

                if "warehouse_code" in line_in:
                    line_obj.warehouse_code = str(line_in["warehouse_code"]).strip()

                if "cost_center_code" in line_in:
                    line_obj.cost_center_code = str(line_in["cost_center_code"]).strip()
                if "cost_center_code2" in line_in:
                    line_obj.cost_center_code2 = str(line_in["cost_center_code2"]).strip()

                line_obj.save()

                if "batches" in line_in:
                    line_obj.batches.all().delete()
                    batches = line_in["batches"] or []
                    b_sum = 0.0
                    for b_data in batches:
                        b_qty = float(b_data.get("quantity") or 0.0)
                        b_sum += b_qty
                        DeliveryDraftBatch.objects.create(
                            line=line_obj,
                            batch_number=str(b_data.get("batch_number", "")).strip(),
                            quantity=b_qty,
                            bin_abs_entry=b_data.get("bin_abs_entry"),
                            bin_code=str(b_data.get("bin_code", "")).strip(),
                        )
                    if batches and abs(b_sum - line_obj.delivery_quantity) > 0.0001:
                        raise DeliveryStateError(
                            f"Line {line_num} batch allocation sum ({b_sum}) does not match line delivery quantity ({line_obj.delivery_quantity})."
                        )

            draft.status = DeliveryDraft.STATUS_DRAFT
            self._save_active_draft(draft)

        return draft

    def submit_for_review(self, draft: DeliveryDraft, user) -> DeliveryDraft:
        """Submits the delivery draft for manager review."""
        from api.services.shipping_service import assert_delivery_manifest
        try:
            assert_delivery_manifest(draft)
        except ValueError as exc:
            raise DeliveryStateError(str(exc)) from exc
        if draft.status not in [DeliveryDraft.STATUS_DRAFT, DeliveryDraft.STATUS_REJECTED]:
            raise DeliveryStateError(f"Draft #{draft.id} cannot be submitted from status '{draft.status}'.")

        active_lines = [l for l in draft.lines.all() if l.delivery_quantity > 0]
        if not active_lines:
            raise DeliveryStateError("At least one line must have a delivery quantity greater than zero.")

        for line in active_lines:
            if not line.warehouse_code:
                raise DeliveryStateError(f"Line {line.line_number} is missing a warehouse code.")

        draft.status = DeliveryDraft.STATUS_PENDING_REVIEW
        self._save_active_draft(draft, update_fields=["status", "updated_at"])
        return draft

    @staticmethod
    def _save_active_draft(draft, **kwargs):
        """A rejected draft may be reopened only when no replacement is active."""
        try:
            with transaction.atomic():
                draft.save(**kwargs)
        except IntegrityError as exc:
            if DeliveryDraft.objects.filter(
                sales_order_doc_entry=draft.sales_order_doc_entry,
                status__in=['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTING'],
            ).exclude(pk=draft.pk).exists():
                raise DeliveryStateError('Another active Delivery Draft already exists for this Sales Order.') from exc
            raise

    def approve_review(self, draft: DeliveryDraft, user) -> DeliveryDraft:
        """Manager approves the delivery draft for posting."""
        if draft.status != DeliveryDraft.STATUS_PENDING_REVIEW:
            raise DeliveryStateError(f"Draft #{draft.id} is not pending review (current: {draft.status}).")

        draft.status = DeliveryDraft.STATUS_APPROVED
        draft.reviewed_by = user
        draft.reviewed_at = timezone.now()
        draft.rejection_reason = ""
        draft.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
        return draft

    def reject_review(self, draft: DeliveryDraft, user, reason: str) -> DeliveryDraft:
        """Manager rejects the delivery draft."""
        if draft.status != DeliveryDraft.STATUS_PENDING_REVIEW:
            raise DeliveryStateError(f"Draft #{draft.id} is not pending review (current: {draft.status}).")

        clean_reason = str(reason or "").strip()
        if not clean_reason:
            raise DeliveryStateError("Rejection reason is required.")

        draft.status = DeliveryDraft.STATUS_REJECTED
        draft.reviewed_by = user
        draft.reviewed_at = timezone.now()
        draft.rejection_reason = clean_reason
        draft.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
        return draft

    def post_delivery_to_sap(self, draft: DeliveryDraft, user) -> DeliveryDraft:
        """
        Executes native SAP Delivery Note (ODLN) posting.
        1. Atomic lock on DeliveryDraft.
        2. Re-verifies live SAP Sales Order OpenQty at post time.
        3. Constructs native BaseType: 17 payload.
        4. Posts POST /b1s/v1/DeliveryNotes to SAP.
        5. Saves resulting DocEntry/DocNum.
        """
        with transaction.atomic():
            locked = DeliveryDraft.objects.select_for_update().get(id=draft.id)
            from api.services.shipping_service import assert_delivery_manifest
            try:
                assert_delivery_manifest(locked)
            except ValueError as exc:
                raise DeliveryStateError(str(exc)) from exc
            if locked.status != DeliveryDraft.STATUS_APPROVED:
                if locked.status == DeliveryDraft.STATUS_POSTED:
                    raise DeliveryStateError(f"Delivery Note #{locked.sap_doc_num} is already posted.")
                raise DeliveryStateError(f"Draft #{locked.id} is not approved for posting (current: {locked.status}).")

            locked.status = DeliveryDraft.STATUS_POSTING
            locked.save(update_fields=["status", "updated_at"])

        # Fetch LIVE Sales Order from SAP to re-verify open quantities
        live_order = self.sap_client.get_sales_order(draft.sales_order_doc_entry)
        if not live_order or (isinstance(live_order, dict) and live_order.get("error")):
            err_msg = live_order.get("error") if isinstance(live_order, dict) else "Could not fetch Sales Order"
            with transaction.atomic():
                draft.status = DeliveryDraft.STATUS_FAILED
                draft.sap_error = f"Failed to verify live Sales Order before posting: {err_msg}"
                draft.save(update_fields=["status", "sap_error", "updated_at"])
            raise DeliveryPostingError(f"Cannot verify Sales Order with SAP: {err_msg}", live_order)

        sap_lines_by_num = {
            int(l.get("LineNum")): l
            for l in (live_order.get("DocumentLines") or [])
            if l.get("LineNum") is not None
        }

        # Check each deliverable line against live SAP OpenQty
        deliverable_lines = [l for l in draft.lines.all() if float(l.delivery_quantity or 0.0) > 0]
        if not deliverable_lines:
            with transaction.atomic():
                draft.status = DeliveryDraft.STATUS_FAILED
                draft.sap_error = "No lines with positive delivery quantity found."
                draft.save(update_fields=["status", "sap_error", "updated_at"])
            raise DeliveryStateError("Delivery draft has no lines with positive delivery quantity.")

        for d_line in deliverable_lines:
            s_line = sap_lines_by_num.get(d_line.line_number)
            if not s_line:
                err = f"Line {d_line.line_number} ({d_line.item_code}) not found in live SAP Sales Order."
                with transaction.atomic():
                    draft.status = DeliveryDraft.STATUS_FAILED
                    draft.sap_error = err
                    draft.save(update_fields=["status", "sap_error", "updated_at"])
                raise DeliveryStateError(err)

            live_open = calculate_line_open_quantity(s_line)
            if float(d_line.delivery_quantity) > live_open + 0.0001:
                err = (
                    f"Concurrency conflict: Line {d_line.line_number} ({d_line.item_code}) "
                    f"delivery quantity ({d_line.delivery_quantity}) exceeds current live SAP open quantity ({live_open}). "
                    f"A concurrent delivery or order change may have occurred."
                )
                with transaction.atomic():
                    draft.status = DeliveryDraft.STATUS_FAILED
                    draft.sap_error = err
                    draft.save(update_fields=["status", "sap_error", "updated_at"])
                raise DeliveryStateError(err)

        # Build payload
        try:
            payload = self.payload_builder.build(draft)
            # Header currency must follow the verified base Sales Order, not BP/local defaults.
            if live_order.get("DocCurrency"):
                payload["DocCurrency"] = live_order["DocCurrency"]
        except DeliveryPayloadValidationError as exc:
            with transaction.atomic():
                draft.status = DeliveryDraft.STATUS_FAILED
                draft.sap_error = str(exc)
                draft.save(update_fields=["status", "sap_error", "updated_at"])
            raise DeliveryStateError(str(exc))

        # Execute SAP Service Layer POST
        result = self.sap_client._request("POST", "DeliveryNotes", payload)

        if not isinstance(result, dict) or result.get("error") or not result.get("DocEntry"):
            error_details = _sap_error_message(result if isinstance(result, dict) else {}, "SAP did not confirm Delivery creation.")
            ambiguous = not (isinstance(result, dict) and isinstance(result.get("error"), dict))
            with transaction.atomic():
                # A transport failure can happen after SAP committed the document.
                # Keep the existing in-flight guard until read-only reconciliation.
                draft.status = DeliveryDraft.STATUS_POSTING if ambiguous else DeliveryDraft.STATUS_FAILED
                draft.raw_payload_json = payload
                draft.sap_error = error_details
                draft.save(update_fields=["status", "raw_payload_json", "sap_error", "updated_at"])
            raise DeliveryPostingError(f"Delivery creation was not confirmed: {error_details}" if ambiguous else f"SAP rejected Delivery Note creation: {error_details}", result, is_ambiguous=ambiguous)

        doc_entry = str(result.get("DocEntry") or "")
        doc_num = str(result.get("DocNum") or doc_entry)

        with transaction.atomic():
            draft.status = DeliveryDraft.STATUS_POSTED
            draft.sap_doc_entry = doc_entry
            draft.sap_doc_num = doc_num
            draft.posted_by = user
            draft.posted_at = timezone.now()
            draft.raw_payload_json = payload
            draft.sap_error = ""
            draft.save(update_fields=[
                "status",
                "sap_doc_entry",
                "sap_doc_num",
                "posted_by",
                "posted_at",
                "raw_payload_json",
                "sap_error",
                "updated_at",
            ])
            self._vacate_pallet_positions_for_draft(draft, user=user)

        return draft

    def _vacate_pallet_positions_for_draft(self, draft: DeliveryDraft, user=None):
        """
        Immediately vacates physical ColdStoragePalletPosition slots associated
        with batches delivered in this draft upon confirmed SAP posting.
        Sets status = AVAILABLE and clears current_batch_number, leaving batch
        history intact on DeliveryDraft / SAP records.
        """
        from api.models_cold_storage import ColdStoragePalletPosition
        vacated_ids = []
        try:
            lines = draft.lines.all().prefetch_related("batches")
            for line in lines:
                for batch in line.batches.all():
                    batch_num = str(batch.batch_number or "").strip()
                    if not batch_num:
                        continue

                    # Target candidate positions holding this batch in OCCUPIED or RESERVED_OUTBOUND
                    qs = ColdStoragePalletPosition.objects.select_for_update().filter(
                        current_batch_number=batch_num,
                        status__in=[
                            ColdStoragePalletPosition.OCCUPIED,
                            ColdStoragePalletPosition.RESERVED_OUTBOUND,
                        ],
                    )
                    # Narrow down by bin / warehouse if known
                    if batch.bin_abs_entry:
                        scoped_qs = qs.filter(sap_bin_abs_entry=batch.bin_abs_entry)
                        if scoped_qs.exists():
                            qs = scoped_qs
                    elif line.warehouse_code:
                        scoped_qs = qs.filter(warehouse_code=line.warehouse_code)
                        if scoped_qs.exists():
                            qs = scoped_qs

                    for pos in qs:
                        old_batch = pos.current_batch_number
                        pos.status = ColdStoragePalletPosition.AVAILABLE
                        pos.current_batch_number = ""
                        pos.reservation_reference = ""
                        pos.transfer_reference = ""
                        pos.reserved_by = None
                        pos.reserved_at = None
                        pos.save(update_fields=[
                            "status",
                            "current_batch_number",
                            "reservation_reference",
                            "transfer_reference",
                            "reserved_by",
                            "reserved_at",
                            "updated_at",
                        ])
                        vacated_ids.append(pos.id)
                        logger.info(
                            "Vacated cold storage pallet position #%s (code %s) in bin %s after delivery of batch %s (Draft #%s)",
                            pos.id, pos.position_code, pos.bin_code, old_batch, draft.id
                        )

                        try:
                            from api.models import AuditLog
                            AuditLog.objects.create(
                                user=user or draft.posted_by,
                                username=(user.username if user else (draft.posted_by.username if draft.posted_by else "system")),
                                action="VACATE_DELIVERY",
                                module="COLD_STORAGE",
                                entity_type="ColdStoragePalletPosition",
                                entity_id=str(pos.id),
                                status=AuditLog.STATUS_SUCCESS,
                                details={
                                    "delivery_draft_id": draft.id,
                                    "sap_doc_num": draft.sap_doc_num,
                                    "batch_number": old_batch,
                                    "bin_code": pos.bin_code,
                                    "position_code": pos.position_code,
                                },
                            )
                        except Exception:
                            logger.exception("Failed to write audit log for delivery vacating position %s", pos.id)

        except Exception as exc:
            logger.exception("Error while vacating pallet positions for delivery draft #%s: %s", draft.id, exc)

        return vacated_ids

    def reconcile_delivery(self, draft: DeliveryDraft) -> DeliveryDraft:
        """
        Attempts to reconcile a draft in FAILED or POSTING status by checking if
        a Delivery Note referencing this Sales Order was actually created in SAP.
        """
        if draft.status not in [DeliveryDraft.STATUS_FAILED, DeliveryDraft.STATUS_POSTING]:
            return draft

        # Search DeliveryNotes by BaseEntry
        endpoint = f"DeliveryNotes?$filter=CardCode eq '{draft.customer_code}'&$orderby=DocEntry desc&$top=5"
        res = self.sap_client._request("GET", endpoint)
        if isinstance(res, dict) and not res.get("error"):
            deliveries = res.get("value") or []
            for d in deliveries:
                # Fetch delivery detail to check BaseEntry
                d_entry = d.get("DocEntry")
                d_detail = self.sap_client._request("GET", f"DeliveryNotes({d_entry})")
                if isinstance(d_detail, dict) and not d_detail.get("error"):
                    # Another partial delivery of this order is not this draft.
                    if f"(Draft #{draft.id})" not in str(d_detail.get("Comments") or ""):
                        continue
                    if str(d_detail.get("CardCode") or "") != draft.customer_code:
                        continue
                    lines = d_detail.get("DocumentLines") or []
                    expected_lines = [line for line in draft.lines.all() if line.delivery_quantity > 0]
                    try:
                        matches = len(lines) == len(expected_lines) and all(any(
                            int(actual.get("BaseType", 0)) == 17
                            and int(actual.get("BaseEntry", 0)) == int(draft.sales_order_doc_entry)
                            and int(actual.get("BaseLine", -1)) == expected.line_number
                            and str(actual.get("ItemCode") or "") == expected.item_code
                            and str(actual.get("WarehouseCode") or "") == expected.warehouse_code
                            and abs(float(actual.get("Quantity", 0)) - expected.delivery_quantity) < 0.000001
                            for actual in lines) for expected in expected_lines)
                    except (TypeError, ValueError):
                        matches = False
                    if not matches:
                        continue
                    for line in lines:
                        if (
                            int(line.get("BaseType", 0)) == 17
                            and int(line.get("BaseEntry", 0)) == int(draft.sales_order_doc_entry)
                        ):
                            with transaction.atomic():
                                draft.status = DeliveryDraft.STATUS_POSTED
                                draft.sap_doc_entry = str(d_entry)
                                draft.sap_doc_num = str(d.get("DocNum") or d_entry)
                                draft.sap_error = ""
                                draft.save(update_fields=["status", "sap_doc_entry", "sap_doc_num", "sap_error", "updated_at"])
                                self._vacate_pallet_positions_for_draft(draft, user=draft.posted_by or draft.created_by)
                            return draft
        return draft

