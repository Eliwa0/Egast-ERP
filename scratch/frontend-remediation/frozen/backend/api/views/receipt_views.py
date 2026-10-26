from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from ..services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()


class ProductionReceiptsView(APIView):
    def get(self, request):
        try:
            from_date = request.query_params.get("from_date")
            to_date = request.query_params.get("to_date")
            result = sap.get_receipts(from_date, to_date)
            return Response(result.get("value", []))
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    def post(self, request):
        try:
            receipt_data = request.data
            result = sap.create_receipt_from_production(receipt_data)
            return Response(result, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=500)