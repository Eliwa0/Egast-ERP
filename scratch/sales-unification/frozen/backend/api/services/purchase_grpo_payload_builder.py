from decimal import Decimal


class PurchaseGRPOPayloadValidationError(ValueError):
    def __init__(self, errors):
        super().__init__("Purchase GRPO payload validation failed.")
        self.errors = errors


class PurchaseGRPOPayloadBuilder:
    """
    Maps a PurchaseGRPODraft into the SAP Business One PurchaseDeliveryNotes
    payload shape. This class never communicates with SAP and never mutates the
    draft; it only validates and maps already-approved draft data.
    """

    sap_object = "PurchaseDeliveryNotes"
    required_source_fields = {
        "vendor_card_code": "CardCode",
        "posting_date": "DocDate",
        "document_date": "TaxDate",
        "due_date": "DocDueDate",
        "item_code": "DocumentLines[].ItemCode",
        "quantity": "DocumentLines[].Quantity",
        "warehouse_code": "DocumentLines[].WarehouseCode",
        "unit_price": "DocumentLines[].UnitPrice",
        "tax_code": "DocumentLines[].TaxCode",
        "batch_number": "DocumentLines[].BatchNumbers[].BatchNumber",
        "batch_quantity": "DocumentLines[].BatchNumbers[].Quantity",
        "bin_abs_entry": "DocumentLines[].DocumentLinesBinAllocations[].BinAbsEntry",
        "bin_quantity": "DocumentLines[].DocumentLinesBinAllocations[].Quantity",
    }

    def build(self, draft):
        self.validate_draft(draft)

        child_batches = list(draft.batches.all()) if hasattr(draft, "batches") else []
        if child_batches:
            batch_numbers = []
            bin_allocations = []
            for idx, b in enumerate(child_batches):
                b_qty = self._number(b.quantity)
                batch_dict = {
                    "BatchNumber": b.batch_number,
                    "Quantity": b_qty,
                    "ManufacturingDate": self._date(b.manufacturing_date),
                    "AddmisionDate": self._date(b.admission_date),
                    "ExpiryDate": self._date(b.expiry_date),
                }
                if b.details:
                    batch_dict["Notes"] = str(b.details).strip()

                udf_map = {
                    "U_Size": b.size,
                    "U_Brand": b.brand,
                    "U_Category": b.category,
                    "U_Packing": b.packing,
                    "U_Season": b.season,
                    "U_Specification": b.extra_specification,
                    "U_vendor": b.vendor,
                    "U_Part": b.part,
                    "U_Company": b.company,
                    "U_Number": b.number,
                }
                for udf_key, udf_val in udf_map.items():
                    if udf_val is not None:
                        clean_val = str(udf_val).strip()
                        if clean_val:
                            batch_dict[udf_key] = clean_val

                attr1 = str(getattr(b, "batch_attribute_1", "") or "").strip()
                if attr1:
                    batch_dict["ManufacturerSerialNumber"] = attr1

                attr2 = str(getattr(b, "batch_attribute_2", "") or "").strip()
                if attr2:
                    batch_dict["InternalSerialNumber"] = attr2

                batch_numbers.append(batch_dict)

                bin_abs = b.bin_abs_entry or draft.bin_abs_entry
                if bin_abs:
                    bin_allocations.append({
                        "BinAbsEntry": self._int(bin_abs),
                        "Quantity": b_qty,
                        "BaseLineNumber": 0,
                        "SerialAndBatchNumbersBaseLine": idx,
                    })
        else:
            batch_numbers = [
                {
                    "BatchNumber": draft.batch_number,
                    "Quantity": self._number(draft.batch_quantity or draft.quantity),
                    "ManufacturingDate": self._date(draft.manufacturing_date),
                    "AddmisionDate": self._date(draft.admission_date),
                    "ExpiryDate": self._date(draft.expiry_date),
                }
            ]
            bin_allocations = [
                {
                    "BinAbsEntry": self._int(draft.bin_abs_entry),
                    "Quantity": self._number(draft.bin_quantity or draft.quantity),
                    "BaseLineNumber": 0,
                    "SerialAndBatchNumbersBaseLine": 0,
                }
            ]

        line = {
            "ItemCode": draft.item_code,
            "ItemDescription": draft.item_name,
            "Quantity": self._number(draft.quantity),
            "WarehouseCode": draft.warehouse_code,
            "UnitPrice": self._number(draft.unit_price),
            "TaxCode": draft.tax_code,
            "VatGroup": draft.tax_code,
            "DiscountPercent": self._number(draft.discount_percent or 0),
            "BatchNumbers": batch_numbers,
            "DocumentLinesBinAllocations": bin_allocations,
        }
        if draft.uom_code:
            line["UoMCode"] = draft.uom_code

        location_val = str(getattr(draft, "location", "") or "").strip()
        if location_val:
            line["CostingCode"] = location_val

        general_val = str(getattr(draft, "general", "") or "").strip()
        if general_val:
            line["CostingCode2"] = general_val

        # Container Number -> SAP line field: Container no (U_Container_no)
        container_no = str(getattr(getattr(draft, "inspection", None), "car_number", "") or getattr(draft, "car_number", "") or "").strip()
        if container_no:
            line["U_Container_no"] = container_no

        # Container Quantity -> SAP line field: NO.Packed (U_PACKED)
        container_qty = getattr(draft, "container_quantity", None)
        if container_qty is not None and container_qty != "":
            try:
                line["U_PACKED"] = float(container_qty)
            except (ValueError, TypeError):
                pass
        # Base Document linkage for matched Purchase Quotation (Phase 6)
        scale_draft = getattr(draft, "scale_draft", None)
        has_quotation_link = bool(
            scale_draft and (getattr(scale_draft, "quotation_id", None) or getattr(scale_draft, "quotation", None))
        ) or bool(getattr(draft, "quotation", None))

        if has_quotation_link:
            quotation = getattr(draft, "quotation", None) or (scale_draft.quotation if scale_draft else None)
            if quotation and getattr(quotation, "sap_doc_entry", None):
                line["BaseType"] = 540000006
                line["BaseEntry"] = int(str(quotation.sap_doc_entry).strip())
                line_idx = getattr(draft, "quotation_line_index", None)
                if line_idx is None and scale_draft:
                    line_idx = getattr(scale_draft, "quotation_line_index", None)
                line["BaseLine"] = int(line_idx if line_idx is not None else 0)

        payload = {
            "CardCode": draft.vendor_card_code,
            "CardName": draft.vendor_name,
            "DocDate": self._date(draft.posting_date),
            "TaxDate": self._date(draft.document_date),
            "DocDueDate": self._date(draft.due_date),
            "Comments": draft.comments or "",
            "DocumentLines": [line],
        }

        if getattr(draft, "vendor_ref_no", None):
            payload["NumAtCard"] = str(draft.vendor_ref_no).strip()

        if getattr(draft, "journal_remark", None):
            payload["JournalMemo"] = str(draft.journal_remark).strip()

        return payload

    def validate_draft(self, draft):
        errors = {}
        common_required = {
            "vendor_card_code": "CardCode",
            "posting_date": "DocDate",
            "document_date": "TaxDate",
            "due_date": "DocDueDate",
            "item_code": "DocumentLines[].ItemCode",
            "quantity": "DocumentLines[].Quantity",
            "warehouse_code": "DocumentLines[].WarehouseCode",
            "unit_price": "DocumentLines[].UnitPrice",
            "tax_code": "DocumentLines[].TaxCode",
        }
        for source_field, sap_field in common_required.items():
            value = getattr(draft, source_field, None)
            if value is None or str(value).strip() == "":
                errors[source_field] = f"{sap_field} is required for SAP PurchaseDeliveryNotes."

        try:
            numeric_qty = float(draft.quantity or 0)
        except (TypeError, ValueError):
            numeric_qty = 0
        if numeric_qty <= 0:
            errors["quantity"] = "quantity must be greater than zero for SAP PurchaseDeliveryNotes."

        child_batches = list(draft.batches.all()) if hasattr(draft, "batches") else []
        if child_batches:
            total_batch_qty = 0.0
            for idx, b in enumerate(child_batches):
                if not b.batch_number:
                    errors[f"batch_{idx}_number"] = f"Batch #{idx+1} number is required."
                try:
                    b_qty = float(b.quantity or 0)
                except (TypeError, ValueError):
                    b_qty = 0
                if b_qty <= 0:
                    errors[f"batch_{idx}_quantity"] = f"Batch #{idx+1} quantity must be greater than zero."
                total_batch_qty += b_qty

                bin_val = b.bin_abs_entry or draft.bin_abs_entry
                if not bin_val:
                    errors[f"batch_{idx}_bin"] = f"Batch #{idx+1} bin location is required."
                else:
                    try:
                        self._int(bin_val)
                    except (TypeError, ValueError):
                        errors[f"batch_{idx}_bin"] = f"Batch #{idx+1} BinAbsEntry must be a valid integer."

            if abs(total_batch_qty - numeric_qty) > 0.001:
                errors["batch_quantity"] = f"Total batch quantity ({total_batch_qty:.3f}) does not match document quantity ({numeric_qty:.3f})."
        else:
            for source_field in ("batch_number", "batch_quantity", "bin_abs_entry", "bin_quantity"):
                value = getattr(draft, source_field, None)
                if value is None or str(value).strip() == "":
                    sap_field = self.required_source_fields.get(source_field, source_field)
                    errors[source_field] = f"{sap_field} is required for SAP PurchaseDeliveryNotes."

            for field in ("batch_quantity", "bin_quantity"):
                value = getattr(draft, field, None)
                try:
                    numeric = float(value or 0)
                except (TypeError, ValueError):
                    numeric = 0
                if numeric <= 0:
                    errors[field] = f"{field} must be greater than zero for SAP PurchaseDeliveryNotes."

            try:
                self._int(draft.bin_abs_entry)
            except (TypeError, ValueError):
                errors["bin_abs_entry"] = "BinAbsEntry must be a valid integer for SAP PurchaseDeliveryNotes."

        # Base Document validation for matched Purchase Quotation (Phase 6)
        scale_draft = getattr(draft, "scale_draft", None)
        has_quotation_link = bool(
            scale_draft and (getattr(scale_draft, "quotation_id", None) or getattr(scale_draft, "quotation", None))
        ) or bool(getattr(draft, "quotation", None))

        if has_quotation_link:
            quotation = getattr(draft, "quotation", None) or (scale_draft.quotation if scale_draft else None)
            if not quotation:
                errors["quotation"] = "Matched Purchase Quotation could not be found."
            else:
                # 1. Quotation must be posted to SAP
                status = getattr(quotation, "status", None)
                if status != "POSTED":
                    errors["quotation_status"] = (
                        f"Matched Purchase Quotation #{quotation.id} must be POSTED to SAP "
                        f"(current status: {status})."
                    )

                # 2. Quotation must have a valid SAP DocEntry
                sap_doc_entry_raw = getattr(quotation, "sap_doc_entry", None)
                if not sap_doc_entry_raw or not str(sap_doc_entry_raw).strip():
                    errors["quotation_sap_doc_entry"] = "Matched Purchase Quotation is missing a valid SAP DocEntry."
                else:
                    try:
                        doc_entry_int = int(str(sap_doc_entry_raw).strip())
                        if doc_entry_int <= 0:
                            errors["quotation_sap_doc_entry"] = (
                                "Matched Purchase Quotation SAP DocEntry must be a positive integer."
                            )
                    except (ValueError, TypeError):
                        errors["quotation_sap_doc_entry"] = (
                            "Matched Purchase Quotation SAP DocEntry must be a valid integer."
                        )

                # 3. Quotation line index must be valid
                line_idx = getattr(draft, "quotation_line_index", None)
                if line_idx is None and scale_draft:
                    line_idx = getattr(scale_draft, "quotation_line_index", None)

                if line_idx is None:
                    errors["quotation_line_index"] = (
                        "ScaleDraft quotation_line_index is required for matched quotation."
                    )
                else:
                    try:
                        line_idx_int = int(line_idx)
                        if line_idx_int < 0:
                            errors["quotation_line_index"] = (
                                "ScaleDraft quotation_line_index must be a non-negative integer."
                            )
                        else:
                            # 4. Verify that referenced line exists in quotation.lines
                            q_lines = getattr(quotation, "lines", []) or []
                            if line_idx_int >= len(q_lines):
                                errors["quotation_line_index"] = (
                                    f"Matched quotation line index {line_idx_int} does not exist in "
                                    f"Purchase Quotation #{quotation.id} (total lines: {len(q_lines)})."
                                )
                            else:
                                # 5. Verify item match if both have item_code specified
                                q_line = q_lines[line_idx_int]
                                q_item = str(q_line.get("item_code") or "").strip()
                                grpo_item = str(getattr(draft, "item_code", "") or "").strip()
                                if q_item and grpo_item and q_item != grpo_item:
                                    errors["item_code"] = (
                                        f"GRPO item '{grpo_item}' does not match Purchase Quotation line item '{q_item}'."
                                    )
                    except (ValueError, TypeError):
                        errors["quotation_line_index"] = (
                            "ScaleDraft quotation_line_index must be a valid integer."
                        )

        if errors:
            raise PurchaseGRPOPayloadValidationError(errors)

    def field_mapping(self):
        return {
            "vendor_card_code": "CardCode",
            "vendor_name": "CardName",
            "posting_date": "DocDate",
            "document_date": "TaxDate",
            "due_date": "DocDueDate",
            "comments": "Comments",
            "item_code": "DocumentLines[0].ItemCode",
            "item_name": "DocumentLines[0].ItemDescription",
            "quantity": "DocumentLines[0].Quantity",
            "uom_code": "DocumentLines[0].UoMCode",
            "warehouse_code": "DocumentLines[0].WarehouseCode",
            "unit_price": "DocumentLines[0].UnitPrice",
            "tax_code": "DocumentLines[0].TaxCode",
            "discount_percent": "DocumentLines[0].DiscountPercent",
            "batch_number": "DocumentLines[0].BatchNumbers[0].BatchNumber",
            "batch_quantity": "DocumentLines[0].BatchNumbers[0].Quantity",
            "manufacturing_date": "DocumentLines[0].BatchNumbers[0].ManufacturingDate",
            "admission_date": "DocumentLines[0].BatchNumbers[0].AddmisionDate",
            "expiry_date": "DocumentLines[0].BatchNumbers[0].ExpiryDate",
            "bin_abs_entry": "DocumentLines[0].DocumentLinesBinAllocations[0].BinAbsEntry",
            "bin_quantity": "DocumentLines[0].DocumentLinesBinAllocations[0].Quantity",
            "location": "DocumentLines[0].CostingCode",
            "general": "DocumentLines[0].CostingCode2",
            "container_number": "DocumentLines[0].U_Container_no",
            "container_quantity": "DocumentLines[0].U_PACKED",
            "batch_attribute_1": "DocumentLines[0].BatchNumbers[0].ManufacturerSerialNumber",
            "batch_attribute_2": "DocumentLines[0].BatchNumbers[0].InternalSerialNumber",
            "quotation_base_type": "DocumentLines[0].BaseType",
            "quotation_sap_doc_entry": "DocumentLines[0].BaseEntry",
            "quotation_line_index": "DocumentLines[0].BaseLine",
        }

    def _date(self, value):
        return value.isoformat() if hasattr(value, "isoformat") else value

    def _number(self, value):
        if isinstance(value, Decimal):
            return float(value)
        return float(value or 0)

    def _int(self, value):
        return int(str(value).strip())
