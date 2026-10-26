from django.db import transaction
from django.utils import timezone

from ..models import PurchaseGRPODraft, PurchaseGRPOPostingAuditLog
from .purchase_grpo_payload_builder import (
    PurchaseGRPOPayloadBuilder,
    PurchaseGRPOPayloadValidationError,
)


class PurchaseGRPOPostingStateError(ValueError):
    pass


class PurchaseGRPOPostingError(ValueError):
    def __init__(self, message, response=None):
        super().__init__(message)
        self.response = response


class PurchaseGRPOPostingPreparationService:
    """
    Prepares and validates PurchaseDeliveryNotes payload previews.

    This service is the SAP boundary for the Purchase GRPO module, but Phase 4
    deliberately does not execute posting. It may perform read-only SAP
    verification when requested; it must never POST a PurchaseDeliveryNotes
    document in this phase.
    """

    sap_object = "PurchaseDeliveryNotes"

    def __init__(self, payload_builder=None, sap_client=None):
        self.payload_builder = payload_builder or PurchaseGRPOPayloadBuilder()
        self.sap_client = sap_client

    def prepare_preview(self, draft, verify_with_sap=False, user=None):
        allowed_statuses = {
            PurchaseGRPODraft.DRAFT,
            PurchaseGRPODraft.APPROVED_FOR_POSTING,
            PurchaseGRPODraft.POSTING_FAILED,
        }
        if draft.status not in allowed_statuses:
            raise PurchaseGRPOPostingStateError(
                f"Cannot prepare preview for Purchase GRPO draft with status '{draft.status}'."
            )

        payload = self.payload_builder.build(draft)
        sap_verification = self.verify_against_sap() if verify_with_sap else {
            "verified": False,
            "mode": "not_requested",
        }
        PurchaseGRPOPostingAuditLog.objects.create(
            draft=draft,
            action=(
                PurchaseGRPOPostingAuditLog.ACTION_VERIFY
                if verify_with_sap
                else PurchaseGRPOPostingAuditLog.ACTION_PREVIEW
            ),
            status_before=draft.status,
            status_after=draft.status,
            sap_object=self.sap_object,
            payload_snapshot=payload,
            response_snapshot=sap_verification,
            actor=user if getattr(user, "is_authenticated", False) else None,
        )
        return {
            "ready": True,
            "posting_enabled": False,
            "draft_id": draft.id,
            "sap_object": self.sap_object,
            "payload": payload,
            "field_mapping": self.payload_builder.field_mapping(),
            "validation": {
                "valid": True,
                "message": "Payload is valid for PurchaseDeliveryNotes preview. SAP posting is disabled in Phase 4.",
            },
            "sap_verification": sap_verification,
        }

    def verify_against_sap(self):
        sap_client = self.sap_client or self._build_sap_client()
        endpoint = f"{self.sap_object}?$top=1&$select=DocEntry"
        result = sap_client._request("GET", endpoint)
        if isinstance(result, dict) and result.get("error"):
            return {
                "verified": False,
                "mode": "read_only",
                "sap_object": self.sap_object,
                "endpoint": endpoint,
                "error": result.get("error"),
            }
        return {
            "verified": True,
            "mode": "read_only",
            "sap_object": self.sap_object,
            "endpoint": endpoint,
            "message": "SAP Service Layer PurchaseDeliveryNotes endpoint is reachable. No document was posted.",
        }

    def _build_sap_client(self):
        from .sap_service import SAPServiceLayer

        return SAPServiceLayer()


class PurchaseGRPOPostingService:
    """
    Executes SAP posting for an approved Purchase GRPO draft.

    The service receives an already validated PurchaseDeliveryNotes payload and
    must not build or mutate it. Payload mapping remains owned by
    PurchaseGRPOPayloadBuilder.
    """

    sap_object = "PurchaseDeliveryNotes"

    def __init__(self, sap_client=None):
        self.sap_client = sap_client

    def post(self, draft, payload, user=None):
        allowed_statuses = {
            PurchaseGRPODraft.DRAFT,
            PurchaseGRPODraft.APPROVED_FOR_POSTING,
            PurchaseGRPODraft.POSTING_FAILED,
        }
        if draft.status not in allowed_statuses:
            raise PurchaseGRPOPostingStateError(
                f"Cannot post Purchase GRPO draft with status '{draft.status}' to SAP."
            )

        actor = user if getattr(user, "is_authenticated", False) else None
        sap_client = self.sap_client or self._build_sap_client()
        verification = {
            "verified": False,
            "mode": "skipped_normal_posting",
            "sap_object": self.sap_object,
            "message": "Pre-post SAP verification is skipped during normal posting.",
        }
        status_before = draft.status

        self._audit(
            draft=draft,
            action=PurchaseGRPOPostingAuditLog.ACTION_POST_ATTEMPT,
            status_before=status_before,
            status_after=draft.status,
            payload=payload,
            response=verification,
            actor=actor,
        )
        response = sap_client.create_purchase_delivery_note(payload)

        if isinstance(response, dict) and response.get("error"):
            message = str(response.get("error") or "SAP PurchaseDeliveryNotes posting failed.")
            self._mark_failed(
                draft=draft,
                payload=payload,
                response=response,
                message=message,
                actor=actor,
                status_before=status_before,
            )
            raise PurchaseGRPOPostingError(message, response=response)

        doc_entry = response.get("DocEntry") if isinstance(response, dict) else None
        doc_num = response.get("DocNum") if isinstance(response, dict) else None
        if doc_entry is None and doc_num is None:
            message = "SAP returned a success response without DocEntry or DocNum."
            self._mark_failed(
                draft=draft,
                payload=payload,
                response=response,
                message=message,
                actor=actor,
                status_before=status_before,
            )
            raise PurchaseGRPOPostingError(message, response=response)

        with transaction.atomic():
            locked = PurchaseGRPODraft.objects.select_for_update().get(id=draft.id)
            locked.status = PurchaseGRPODraft.POSTED
            locked.sap_doc_entry = "" if doc_entry is None else str(doc_entry)
            locked.sap_doc_num = "" if doc_num is None else str(doc_num)
            locked.sap_error_message = ""
            locked.sap_payload_snapshot = payload
            locked.sap_response_snapshot = response
            locked.posted_at = timezone.now()
            locked.posted_by = actor
            locked.updated_by = actor
            locked.save()
            self._audit(
                draft=locked,
                action=PurchaseGRPOPostingAuditLog.ACTION_POST_SUCCESS,
                status_before=status_before,
                status_after=locked.status,
                payload=payload,
                response=response,
                actor=actor,
            )
        return locked

    def _mark_failed(self, draft, payload, response, message, actor, status_before):
        with transaction.atomic():
            locked = PurchaseGRPODraft.objects.select_for_update().get(id=draft.id)
            locked.status = PurchaseGRPODraft.POSTING_FAILED
            locked.sap_error_message = message
            locked.sap_payload_snapshot = payload
            locked.sap_response_snapshot = response
            locked.updated_by = actor
            locked.save()
            self._audit(
                draft=locked,
                action=PurchaseGRPOPostingAuditLog.ACTION_POST_FAILURE,
                status_before=status_before,
                status_after=locked.status,
                payload=payload,
                response=response,
                error_message=message,
                actor=actor,
            )

    def _audit(
        self,
        draft,
        action,
        status_before,
        status_after,
        payload=None,
        response=None,
        error_message="",
        actor=None,
    ):
        PurchaseGRPOPostingAuditLog.objects.create(
            draft=draft,
            action=action,
            status_before=status_before,
            status_after=status_after,
            sap_object=self.sap_object,
            payload_snapshot=payload,
            response_snapshot=response,
            error_message=error_message,
            actor=actor,
        )

    def _build_sap_client(self):
        from .sap_service import SAPServiceLayer

        return SAPServiceLayer()


__all__ = [
    "PurchaseGRPOPayloadValidationError",
    "PurchaseGRPOPostingError",
    "PurchaseGRPOPostingPreparationService",
    "PurchaseGRPOPostingService",
    "PurchaseGRPOPostingStateError",
]
