from django.db import transaction
from django.utils import timezone

from ..models_purchase_quotation import PurchaseQuotationDraft, PurchaseQuotationPostingAuditLog
from .purchase_quotation_payload_builder import (
    PurchaseQuotationPayloadBuilder,
    PurchaseQuotationPayloadValidationError,
)


class PurchaseQuotationPostingStateError(ValueError):
    pass


class PurchaseQuotationPostingError(ValueError):
    def __init__(self, message, response=None):
        super().__init__(message)
        self.response = response


class PurchaseQuotationPostingPreparationService:
    """
    Prepares and validates PurchaseQuotations payload previews for SAP Service Layer.
    """

    sap_object = "PurchaseQuotations"

    def __init__(self, payload_builder=None, sap_client=None):
        self.payload_builder = payload_builder or PurchaseQuotationPayloadBuilder()
        self.sap_client = sap_client

    def prepare_preview(self, draft, verify_with_sap=False, user=None):
        if draft.status != PurchaseQuotationDraft.APPROVED_FOR_POSTING:
            raise PurchaseQuotationPostingStateError(
                "Only approved Purchase Quotation drafts can be prepared for SAP posting."
            )

        payload = self.payload_builder.build(draft)
        sap_verification = self.verify_against_sap() if verify_with_sap else {
            "verified": False,
            "mode": "not_requested",
        }
        PurchaseQuotationPostingAuditLog.objects.create(
            draft=draft,
            action=(
                PurchaseQuotationPostingAuditLog.ACTION_VERIFY
                if verify_with_sap
                else PurchaseQuotationPostingAuditLog.ACTION_PREVIEW
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
            "draft_id": draft.id,
            "sap_object": self.sap_object,
            "payload": payload,
            "validation": {
                "valid": True,
                "message": "Payload is valid for PurchaseQuotations submission.",
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
            "message": "SAP Service Layer PurchaseQuotations endpoint is reachable.",
        }

    def _build_sap_client(self):
        from .sap_service import SAPServiceLayer

        return SAPServiceLayer()


class PurchaseQuotationPostingService:
    """
    Executes SAP Service Layer posting for an approved Purchase Quotation draft.
    """

    sap_object = "PurchaseQuotations"

    def __init__(self, sap_client=None):
        self.sap_client = sap_client

    def post(self, draft, payload, user=None):
        if draft.status != PurchaseQuotationDraft.APPROVED_FOR_POSTING:
            raise PurchaseQuotationPostingStateError(
                "Only approved Purchase Quotations can be posted to SAP."
            )

        actor = user if getattr(user, "is_authenticated", False) else None
        sap_client = self.sap_client or self._build_sap_client()
        verification = {
            "verified": False,
            "mode": "skipped_normal_posting",
            "sap_object": self.sap_object,
        }
        status_before = draft.status

        self._audit(
            draft=draft,
            action=PurchaseQuotationPostingAuditLog.ACTION_POST_ATTEMPT,
            status_before=status_before,
            status_after=draft.status,
            payload=payload,
            response=verification,
            actor=actor,
        )

        response = sap_client.create_purchase_quotation(payload)

        if isinstance(response, dict) and response.get("error"):
            message = str(response.get("error") or "SAP PurchaseQuotations posting failed.")
            self._mark_failed(
                draft=draft,
                payload=payload,
                response=response,
                message=message,
                actor=actor,
                status_before=status_before,
            )
            raise PurchaseQuotationPostingError(message, response=response)

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
            raise PurchaseQuotationPostingError(message, response=response)

        with transaction.atomic():
            locked = PurchaseQuotationDraft.objects.select_for_update().get(id=draft.id)
            locked.status = PurchaseQuotationDraft.POSTED
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
                action=PurchaseQuotationPostingAuditLog.ACTION_POST_SUCCESS,
                status_before=status_before,
                status_after=locked.status,
                payload=payload,
                response=response,
                actor=actor,
            )
        return locked

    def _mark_failed(self, draft, payload, response, message, actor, status_before):
        with transaction.atomic():
            locked = PurchaseQuotationDraft.objects.select_for_update().get(id=draft.id)
            locked.status = PurchaseQuotationDraft.POSTING_FAILED
            locked.sap_error_message = message
            locked.sap_payload_snapshot = payload
            locked.sap_response_snapshot = response
            locked.updated_by = actor
            locked.save()
            self._audit(
                draft=locked,
                action=PurchaseQuotationPostingAuditLog.ACTION_POST_FAILURE,
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
        PurchaseQuotationPostingAuditLog.objects.create(
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
    "PurchaseQuotationPayloadValidationError",
    "PurchaseQuotationPostingError",
    "PurchaseQuotationPostingPreparationService",
    "PurchaseQuotationPostingService",
    "PurchaseQuotationPostingStateError",
]
