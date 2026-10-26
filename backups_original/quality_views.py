from functools import wraps
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.decorators import api_view
from .role_permissions import can_access_quality, can_manage_quality
from .models import PendingQualityInspection

def require_quality_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_access_quality(request.user):
            return JsonResponse({"success": False, "error": "Quality access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped

def require_quality_admin_access(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"success": False, "error": "Authentication required"}, status=401)
        if not can_manage_quality(request.user):
            return JsonResponse({"success": False, "error": "Quality admin access required"}, status=403)
        return view_func(request, *args, **kwargs)
    wrapped.csrf_exempt = getattr(view_func, "csrf_exempt", False)
    return wrapped

def _pending_quality_inspection_to_dict(ins):
    return {
        "id": ins.id,
        "batch_number": ins.batch_number,
        "item_code": ins.item_code,
        "item_name": ins.item_name,
        "supplier_name": ins.supplier_name,
        "farm_origin": ins.farm_origin,
        "inspector_name": ins.inspector_name,
        "data_clerk_name": ins.data_clerk_name,
        "contractor_name": ins.contractor_name,
        "car_number": ins.car_number,
        "crop_name": ins.crop_name,
        "raw_material_type": ins.raw_material_type,
        "inspection_date": ins.inspection_date.isoformat() if ins.inspection_date else None,
        "sample_size": ins.sample_size,
        "samples_data": ins.samples_data,
        "notes": ins.notes,
        "total_defects_count": ins.total_defects_count,
        "average_defects_per_sample": ins.average_defects_per_sample,
        "decision": ins.decision,
        "quarantine_violation": ins.quarantine_violation,
        "af_waste_total": ins.af_waste_total,
        "ag_quality_total": ins.ag_quality_total,
        "ah_grand_total": ins.ah_grand_total,
        "combined_bruises_cuts_percentage": ins.combined_bruises_cuts_percentage,
        "high_cut_percentage": ins.high_cut_percentage,
        "status": ins.status,
        "created_by": ins.created_by.username if ins.created_by else None,
        "reviewed_by": ins.reviewed_by.username if ins.reviewed_by else None,
        "rejection_reason": ins.rejection_reason,
        "sap_doc_entry": ins.sap_doc_entry,
        "sap_doc_num": ins.sap_doc_num,
        "sap_error": ins.sap_error,
        "created_at": ins.created_at.isoformat() if ins.created_at else None,
        "updated_at": ins.updated_at.isoformat() if ins.updated_at else None,
        "reviewed_at": ins.reviewed_at.isoformat() if ins.reviewed_at else None,
        "posted_at": ins.posted_at.isoformat() if ins.posted_at else None,
    }

@api_view(["GET"])
@require_quality_access
def list_pending_inspections(request):
    status_filter = request.query_params.get("status", "PENDING_REVIEW")
    search_query = request.query_params.get("search", "")
    
    queryset = PendingQualityInspection.objects.select_related("created_by", "reviewed_by").all()
    if status_filter != "ALL":
        queryset = queryset.filter(status=status_filter)
    if search_query:
        queryset = queryset.filter(batch_number__icontains=search_query)
        
    return JsonResponse({
        "success": True,
        "data": {
            "inspections": [_pending_quality_inspection_to_dict(x) for x in queryset]
        }
    })

@api_view(["GET"])
@require_quality_access
def get_quality_inspection_detail(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.select_related("created_by", "reviewed_by").get(id=inspection_id)
        return JsonResponse({
            "success": True,
            "data": {
                "inspection": _pending_quality_inspection_to_dict(ins)
            }
        })
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)

@api_view(["POST"])
@require_quality_access
def create_quality_inspection(request):
    data = request.data
    
    metadata = data.get("metadata", {})
    samples_data = data.get("samples_data", [])
    sample_size = int(data.get("sample_size", len(samples_data)))
    
    from .services.sap_service import SAPServiceLayer
    from .services.quality_service import QualityInspectionService
    
    sap_client = SAPServiceLayer()
    service = QualityInspectionService(sap_client)
    
    metrics = service.calculate_inspection_metrics(sample_size, samples_data)
    
    # Parse inspection date safely
    insp_date = metadata.get("inspection_date")
    if not insp_date or insp_date == "":
        insp_date = timezone.now().date().isoformat()
        
    ins = PendingQualityInspection.objects.create(
        batch_number=metadata.get("batch_number", ""),
        item_code=metadata.get("item_code", ""),
        item_name=metadata.get("item_name", ""),
        supplier_name=metadata.get("supplier_name", ""),
        farm_origin=metadata.get("farm_origin", ""),
        inspector_name=metadata.get("inspector_name", ""),
        data_clerk_name=metadata.get("data_clerk_name", ""),
        contractor_name=metadata.get("contractor_name", ""),
        car_number=metadata.get("car_number", ""),
        crop_name=metadata.get("crop_name", ""),
        raw_material_type=metadata.get("raw_material_type", ""),
        inspection_date=insp_date,
        sample_size=sample_size,
        samples_data=samples_data,
        notes=metadata.get("notes", ""),
        total_defects_count=metrics['sum_ah'],
        average_defects_per_sample=metrics['average_defects_per_sample'],
        decision=metrics['decision'],
        quarantine_violation=metrics['quarantine_violation'],
        af_waste_total=metrics['sum_af'],
        ag_quality_total=metrics['sum_ag'],
        ah_grand_total=metrics['sum_ah'],
        combined_bruises_cuts_percentage=metrics['combined_bruises_cuts_percentage'],
        high_cut_percentage=metrics['high_cut_percentage'],
        status=PendingQualityInspection.PENDING_REVIEW,
        created_by=request.user
    )
    
    return JsonResponse({
        "success": True,
        "data": {
            "inspection": _pending_quality_inspection_to_dict(ins)
        }
    })

@api_view(["POST"])
@require_quality_admin_access
def approve_post_quality_inspection(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.get(id=inspection_id)
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)
        
    if ins.status == PendingQualityInspection.POSTED:
        return JsonResponse({"success": False, "error": "This inspection report has already been posted to SAP"}, status=400)
    if ins.status == PendingQualityInspection.REJECTED:
        return JsonResponse({"success": False, "error": "This inspection report has been rejected and cannot be posted"}, status=400)
        
    target_warehouse = request.data.get("target_warehouse")
    
    from .services.sap_service import SAPServiceLayer
    from .services.quality_service import QualityInspectionService
    
    sap_client = SAPServiceLayer()
    service = QualityInspectionService(sap_client)
    
    try:
        service.post_inspection_to_sap(ins, target_warehouse=target_warehouse)
        ins.reviewed_by = request.user
        ins.reviewed_at = timezone.now()
        ins.save()
        return JsonResponse({
            "success": True,
            "data": {
                "inspection": _pending_quality_inspection_to_dict(ins)
            }
        })
    except Exception as e:
        ins.sap_error = str(e)
        ins.status = PendingQualityInspection.FAILED
        ins.save()
        return JsonResponse({"success": False, "error": f"Failed posting to SAP: {e}"}, status=400)

@api_view(["POST"])
@require_quality_admin_access
def reject_quality_inspection(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.get(id=inspection_id)
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)
        
    reason = request.data.get("reason", "")
    ins.status = PendingQualityInspection.REJECTED
    ins.rejection_reason = reason
    ins.reviewed_by = request.user
    ins.reviewed_at = timezone.now()
    ins.save()
    
    return JsonResponse({
        "success": True,
        "data": {
            "inspection": _pending_quality_inspection_to_dict(ins)
        }
    })

@api_view(["DELETE", "POST"])
@require_quality_admin_access
def delete_quality_inspection(request, inspection_id):
    try:
        ins = PendingQualityInspection.objects.get(id=inspection_id)
        ins.delete()
        return JsonResponse({"success": True, "message": "Inspection report deleted successfully"})
    except PendingQualityInspection.DoesNotExist:
        return JsonResponse({"success": False, "error": "Inspection report not found"}, status=404)

@api_view(["GET"])
@require_quality_access
def get_quality_batch_details(request, batch_number):
    from .services.sap_service import SAPServiceLayer
    sap_client = SAPServiceLayer()
    try:
        # Search in SAP BatchNumbers first
        endpoint = f"BatchNumbers?$filter=BatchNumber eq '{batch_number}'"
        result = sap_client._request("GET", endpoint)
        batches = result.get("value", [])
        if batches:
            batch = batches[0]
            return JsonResponse({
                "success": True,
                "batch": {
                    "batch_number": batch.get("BatchNumber"),
                    "quantity": batch.get("Quantity", 0),
                    "bin_location": batch.get("BinLocation", ""),
                    "expiration_date": batch.get("ExpirationDate", ""),
                    "mfr_date": batch.get("ManufacturingDate", ""),
                    "admission_date": batch.get("AdmissionDate", ""),
                    "details": batch.get("Notes") or batch.get("Details", ""),
                    "uom": batch.get("UoMCode", ""),
                    "vendor": batch.get("VendorCode", ""),
                    "part_number": batch.get("PartNumber", ""),
                    "extra_specification": batch.get("ExtraSpecification", ""),
                    "size": batch.get("U_Size", ""),
                    "brand": batch.get("U_Brand", ""),
                    "udf_uom": batch.get("U_UOM", ""),
                    "udf_vendor": batch.get("U_vendor", ""),
                    "udf_part": batch.get("U_Part", ""),
                    "udf_category": batch.get("U_Category", ""),
                    "udf_packing": batch.get("U_Packing", ""),
                    "udf_season": batch.get("U_Season", "") or batch.get("Season", ""),
                    "udf_extra_specification": batch.get("U_Specification", ""),
                    "udf_number": batch.get("U_Number", ""),
                    "warehouse": batch.get("Warehouse", "")
                }
            })
        
        # Try local pending receipt batches
        from ..models import PendingReceiptBatch
        local_batches = PendingReceiptBatch.objects.filter(batch_number=batch_number).order_by('-id')
        if local_batches.exists():
            local_b = local_batches[0]
            return JsonResponse({
                "success": True,
                "batch": {
                    "batch_number": local_b.batch_number,
                    "quantity": local_b.quantity,
                    "bin_location": local_b.bin_location,
                    "mfr_date": local_b.mfr_date,
                    "admission_date": local_b.admission_date,
                    "details": local_b.details,
                    "uom": local_b.uom_label,
                    "vendor": local_b.vendor,
                    "size": local_b.size,
                    "brand": local_b.brand,
                    "udf_category": local_b.category,
                    "udf_packing": local_b.packing,
                    "udf_season": local_b.season,
                    "udf_extra_specification": local_b.extra_specification,
                    "warehouse": local_b.pending_receipt.warehouse_code
                }
            })

        return JsonResponse({"success": True, "batch": None})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=400)
