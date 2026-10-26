from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.db.models import F

from .models_cold_storage import ColdStoragePalletPosition


@api_view(["GET"])
def list_reserved_outbound_positions(request):
    """Return all active outbound position reservations, oldest first."""
    positions = (
        ColdStoragePalletPosition.objects
        .filter(status=ColdStoragePalletPosition.RESERVED_OUTBOUND)
        .select_related("reserved_by")
        .order_by(F("reserved_at").asc(nulls_last=True), "id")
    )

    data = [
        {
            "id": position.id,
            "position_code": position.position_code,
            "status": position.status,
            "reservation_reference": position.reservation_reference,
            "reserved_by": position.reserved_by.username if position.reserved_by else None,
            "reserved_at": position.reserved_at.isoformat() if position.reserved_at else None,
            "source_sap_bin": position.bin_code,
            "source_sap_bin_abs_entry": position.sap_bin_abs_entry,
            "source_warehouse": position.warehouse_code,
            "batch_number": position.current_batch_number or None,
            "transfer_reference": position.transfer_reference or None,
        }
        for position in positions
    ]
    return Response({"success": True, "message": None, "data": {"positions": data, "count": len(data)}})
