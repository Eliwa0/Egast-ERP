from rest_framework.views import APIView
from rest_framework.response import Response
from ..services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()


class ItemStockView(APIView):
    def get(self, request, item_code):
        try:
            result = sap.get_item_stock(item_code)
            return Response(result)
        except Exception as e:
            return Response({"error": str(e)}, status=500)


class LowStockView(APIView):
    def get(self, request):
        try:
            threshold = request.query_params.get("threshold", 10)
            result = sap.get_low_stock_items(int(threshold))
            return Response(result.get("value", []))
        except Exception as e:
            return Response({"error": str(e)}, status=500)