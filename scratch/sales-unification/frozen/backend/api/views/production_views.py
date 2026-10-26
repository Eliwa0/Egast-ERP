from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from ..services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()


class ProductionOrdersView(APIView):
    def get(self, request):
        try:
            status_filter = request.query_params.get("status")
            result = sap.get_production_orders(status_filter)
            return Response(result.get("value", []))
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    def post(self, request):
        # إنشاء أمر إنتاج جديد (اختياري)
        pass


class ProductionOrderDetailView(APIView):
    def get(self, request, doc_entry):
        try:
            result = sap.get_production_order(doc_entry)
            return Response(result)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    def put(self, request, doc_entry):
        # تحديث أمر إنتاج
        pass


class CloseProductionOrderView(APIView):
    def post(self, request, doc_entry):
        try:
            result = sap.close_production_order(doc_entry)
            return Response({"message": "Order closed successfully", "data": result})
        except Exception as e:
            return Response({"error": str(e)}, status=500)