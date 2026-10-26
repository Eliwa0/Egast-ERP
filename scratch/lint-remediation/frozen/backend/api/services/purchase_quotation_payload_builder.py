from decimal import Decimal

from .cache_service import build_cache_key, cache_get, sap_master_namespace


def _resolve_cost_center_dimension(cost_code):
    """Resolve an SAP cost center's dimension from the shared Redis cache.

    Dimension 1 (Location) and Dimension 2 (General) are cached under separate
    keys by list_quality_cost_centers; this reads those same keys and returns the
    row's declared dimension, or None when the code is unknown/not cached.
    """
    for dim in (1, 2):
        cache_key = build_cache_key(sap_master_namespace("cost-centers"), dim)
        rows = cache_get(cache_key) or []
        for cc in rows:
            if str(cc.get("code")).strip() == cost_code:
                value = cc.get("dimension")
                if value is not None:
                    return int(value)
    return None


class PurchaseQuotationPayloadValidationError(ValueError):
    def __init__(self, errors):
        super().__init__("Purchase Quotation payload validation failed.")
        self.errors = errors


class PurchaseQuotationPayloadBuilder:
    """
    Maps a PurchaseQuotationDraft into the SAP Business One PurchaseQuotations
    payload shape. This class never communicates with SAP and never mutates the
    draft; it only validates and maps draft data.

    VERIFIED FIELD MAPPINGS (SAP HANA DB -> Service Layer):
    - Quoted Qty   -> PQT1.Quantity    -> SL: Quantity
    - Required Qty -> PQT1.PQTReqQty   -> SL: RequiredQuantity
    - Quoted Date  -> PQT1.ShipDate    -> SL: ShipDate
    - Required Date -> PQT1.PQTReqDate -> SL: RequiredDate
    - Warehouse    -> PQT1.WhsCode     -> SL: WarehouseCode
    - Location     -> PQT1.LocCode     -> SL: LocationCode
    - Cost Center  -> PQT1.OcrCode     -> SL: CostingCode
    - Group No.    -> OPQT.PQTGrpNum   -> SL: GroupNumber
    - Unit Price   -> PQT1.Price       -> SL: UnitPrice
    - Discount %   -> PQT1.DiscPrcnt   -> SL: DiscountPercent
    - Tax Code     -> PQT1.TaxCode     -> SL: TaxCode
    - UoM Code     -> PQT1.UomCode     -> SL: UoMCode
    """

    sap_object = "PurchaseQuotations"

    def build(self, draft):
        self.validate_draft(draft)

        document_lines = []
        for line in draft.lines or []:
            sl_line = {
                "ItemCode": str(line.get("item_code", "")).strip(),
                "ItemDescription": str(line.get("item_description", line.get("item_name", ""))).strip(),
                "Quantity": self._number(line.get("quoted_qty", 1)),
                "RequiredQuantity": self._number(line.get("required_qty", 1)),
                "UnitPrice": self._number(line.get("unit_price", 0)),
                "DiscountPercent": self._number(line.get("discount_percent", 0)),
            }

            # Vehicle Number -> SAP line field: Container no (U_Container_no)
            vehicle_num = str(getattr(draft, "vehicle_number", "") or line.get("vehicle_number") or "").strip()
            if vehicle_num:
                sl_line["U_Container_no"] = vehicle_num

            # Container Quantity -> SAP line field: NO.Packed (U_PACKED)
            container_qty = getattr(draft, "container_quantity", None)
            if container_qty is None:
                container_qty = line.get("container_quantity")
            if container_qty is not None and container_qty != "":
                try:
                    sl_line["U_PACKED"] = float(container_qty)
                except (ValueError, TypeError):
                    pass

            quoted_date = self._date(line.get("quoted_date") or draft.posting_date)
            if quoted_date:
                sl_line["ShipDate"] = quoted_date

            required_date = self._date(line.get("required_date") or draft.required_date or draft.valid_until)
            if required_date:
                sl_line["RequiredDate"] = required_date

            if line.get("uom_code"):
                sl_line["UoMCode"] = str(line["uom_code"]).strip()

            if line.get("tax_code"):
                sl_line["TaxCode"] = str(line["tax_code"]).strip()

            if line.get("warehouse_code"):
                sl_line["WarehouseCode"] = str(line["warehouse_code"]).strip()

            # Location handling:
            # In SAP Business One, LocationCode on DocumentLines is an integer referencing table OLOC.
            # When aligning with GRPO, Location is a Dimension 1 Profit Center (CostingCode).
            # If location_code is a distinct numeric OLOC code, map to LocationCode.
            # If location_code represents a Dimension 1 Cost Center, it maps to CostingCode.
            if line.get("location_code"):
                loc_val = self._int(line["location_code"])
                cost_code_val = str(line.get("costing_code") or "").strip()
                loc_str = str(line["location_code"]).strip()
                if loc_val is not None and cost_code_val and cost_code_val != loc_str:
                    sl_line["LocationCode"] = loc_val
                elif not cost_code_val and not sl_line.get("CostingCode"):
                    sl_line["CostingCode"] = loc_str

            if line.get("costing_code2"):
                sl_line["CostingCode2"] = str(line["costing_code2"]).strip()

            if line.get("costing_code"):
                cost_code = str(line["costing_code"]).strip()
                dim = line.get("cost_center_dimension") or line.get("dimension")
                if dim is None:
                    try:
                        dim = _resolve_cost_center_dimension(cost_code)
                    except Exception:
                        dim = None

                if dim == 2 or (dim is None and cost_code.startswith("210")):
                    if "CostingCode2" not in sl_line:
                        sl_line["CostingCode2"] = cost_code
                elif dim == 3:
                    sl_line["CostingCode3"] = cost_code
                elif dim == 4:
                    sl_line["CostingCode4"] = cost_code
                elif dim == 5:
                    sl_line["CostingCode5"] = cost_code
                else:
                    sl_line["CostingCode"] = cost_code

            document_lines.append(sl_line)

        payload = {
            "CardCode": draft.vendor_card_code,
            "CardName": draft.vendor_name,
            "DocDate": self._date(draft.posting_date),
            "TaxDate": self._date(draft.document_date or draft.posting_date),
            "DocDueDate": self._date(draft.valid_until or draft.posting_date),
            "Comments": draft.remarks or "",
            "DocumentLines": document_lines,
        }

        if draft.contact_person_code:
            payload["ContactPersonCode"] = self._int(draft.contact_person_code)

        if draft.vendor_ref_no:
            payload["NumAtCard"] = str(draft.vendor_ref_no).strip()

        if draft.currency:
            payload["DocCurrency"] = str(draft.currency).strip()

        if getattr(draft, "group_no", None):
            group_num = self._int(draft.group_no)
            payload["GroupNumber"] = group_num if group_num is not None else draft.group_no

        if draft.required_date:
            req_date = self._date(draft.required_date)
            payload["ReqDate"] = req_date
            payload["RequriedDate"] = req_date

        if draft.buyer_code:
            payload["SalesPersonCode"] = self._int(draft.buyer_code)

        if draft.owner_code:
            payload["DocumentsOwner"] = self._int(draft.owner_code)

        if draft.journal_remark:
            payload["JournalMemo"] = str(draft.journal_remark).strip()

        if draft.discount_percent and float(draft.discount_percent) > 0:
            payload["DiscountPercent"] = self._number(draft.discount_percent)

        if draft.freight and float(draft.freight) > 0:
            payload["TotalFreight"] = self._number(draft.freight)

        if draft.rounding and float(draft.rounding) != 0:
            payload["Rounding"] = "tYES"
            payload["RoundingDiffAmount"] = self._number(draft.rounding)

        return payload

    def validate_draft(self, draft):
        errors = {}
        if not getattr(draft, "vendor_card_code", None) or str(draft.vendor_card_code).strip() == "":
            errors["vendor_card_code"] = "Vendor CardCode is required for SAP PurchaseQuotations."

        if getattr(draft, "vehicle_number", None):
            v_num = str(draft.vehicle_number).strip()
            if len(v_num) > 11:
                errors["vehicle_number"] = "Vehicle number cannot exceed 11 characters for SAP Service Layer (U_Container_no)."

        if not getattr(draft, "posting_date", None):
            errors["posting_date"] = "Posting Date is required for SAP PurchaseQuotations."

        if not getattr(draft, "valid_until", None):
            errors["valid_until"] = "Valid Until (DocDueDate) is required for SAP PurchaseQuotations."

        lines = getattr(draft, "lines", []) or []
        if not lines:
            errors["lines"] = "At least one line item is required for SAP PurchaseQuotations."
        else:
            for idx, line in enumerate(lines):
                if not line.get("item_code"):
                    errors[f"lines[{idx}].item_code"] = "Item Code is required for each line."
                quoted_qty = self._number(line.get("quoted_qty", 0))
                if quoted_qty <= 0:
                    errors[f"lines[{idx}].quoted_qty"] = "Quoted Quantity must be greater than zero."
                req_qty = self._number(line.get("required_qty", 0))
                if req_qty <= 0:
                    errors[f"lines[{idx}].required_qty"] = "Required Quantity must be greater than zero."

        if errors:
            raise PurchaseQuotationPayloadValidationError(errors)

    def _date(self, value):
        if not value:
            return None
        return value.isoformat() if hasattr(value, "isoformat") else str(value)

    def _number(self, value):
        if isinstance(value, Decimal):
            return float(value)
        return float(value or 0)

    def _int(self, value):
        try:
            return int(str(value).strip())
        except (ValueError, TypeError):
            return None
