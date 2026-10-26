import os
from decimal import Decimal, InvalidOperation


TRANSFER_USE_MOCK = os.environ.get("TRANSFER_USE_MOCK", "false").lower() == "true"

# ── Transfer stage identifiers ────────────────────────────────────────────────
from api.services.transfer_policy_service import (
    STAGE_1_TO_INTERMEDIATE, STAGE_2_TO_FRIDGE, STAGE_3_FROM_FRIDGE, STAGE_4_TO_DESTINATION,
    VALID_STAGES, TransferPolicyError, TransferPolicyResolver,
    legacy_warehouse_codes, validate_request_header,
)


def _intermediate_warehouses():
    return legacy_warehouse_codes("TRANSFER_INTERMEDIATE_WAREHOUSES")


def _fridge_warehouses():
    return legacy_warehouse_codes("TRANSFER_FRIDGE_WAREHOUSES")


def _is_configured(codes):
    return bool(codes)


MOCK_WAREHOUSES = [
    {"code": "WH-RAW", "name": "Raw Materials Warehouse"},
    {"code": "WH-PROD", "name": "Production Warehouse"},
    {"code": "WH-FG", "name": "Finished Goods Warehouse"},
    {"code": "WH-QA", "name": "Quality Hold Warehouse"},
]


MOCK_BATCHES = [
    {
        "item_code": "FG-112000028",
        "item_name": "Finished Goods Batch 112000028",
        "batch_number": "112000028-32",
        "batch_abs_entry": 1001,
        "from_warehouse": "WH-PROD",
        "from_bin": "PROD-LINE-02",
        "available_quantity": 32,
        "uom": "CTN",
        "expiry_date": "2027-02-28",
    },
    {
        "item_code": "FG-1407",
        "item_name": "Juice Multipack 12 x 250ml",
        "batch_number": "24051407-08",
        "batch_abs_entry": 1002,
        "from_warehouse": "WH-FG",
        "from_bin": "FG-B-08",
        "available_quantity": 315,
        "uom": "CASE",
        "expiry_date": "2026-11-30",
    },
    {
        "item_code": "RM-2204",
        "item_name": "Packaging Film Roll",
        "batch_number": "24052204-11",
        "batch_abs_entry": 1003,
        "from_warehouse": "WH-RAW",
        "from_bin": "RAW-A-02",
        "available_quantity": 42,
        "uom": "ROLL",
        "expiry_date": None,
    },
]


class TransferValidationError(ValueError):
    pass


class DefinitiveSAPPostingFailure(Exception):
    """SAP explicitly rejected StockTransfers; no document was created."""


class DestinationPositionConflict(TransferValidationError):
    """Stage 2 destination bin/physical-position integrity conflict."""

    pass


class TransferBatchNotFound(Exception):
    pass


class TransferInventoryService:
    """
    Backend service for SAP Inventory Transfer.

    Batch lookup queries OBTN (batch master) + OBBQ (batch-bin quantities) via
    a registered SAP SQL query — no direct OWTR/WTR1 inserts.
    Posting uses StockTransfers through the Service Layer.

    Set TRANSFER_USE_MOCK=true to use isolated mock data for local UI testing.
    """

    def __init__(self, use_mock=None, sap_client=None):
        self.use_mock = TRANSFER_USE_MOCK if use_mock is None else use_mock
        self.sap_client = sap_client

    # ── Public API ─────────────────────────────────────────────────────────────

    def _policy_resolver(self):
        return TransferPolicyResolver(sap_client=self.sap_client, use_mock=self.use_mock)

    def get_transfer_config(self):
        """Backend-owned effective stage policies; authorization remains separate."""
        return self._policy_resolver().resolve(include_persisted=False).config

    def resolve_transfer_policy(self, include_persisted=True):
        # Preserve the existing service seams used by callers and regression tests.
        return self._policy_resolver().resolve(
            intermediate=self._resolve_intermediate_warehouses(),
            fridge=self._resolve_fridge_warehouses(),
            include_persisted=False,
        )

    def detect_intermediate_warehouses(self):
        """
        Expose the OWHS keyword search as a standalone public method.
        Returns a list of {code, name, inactive} dicts.
        """
        if self.use_mock:
            return [
                {"code": "WH-QA", "name": "Quality Hold Warehouse", "inactive": False},
            ]
        return self.sap_client.get_intermediate_warehouses()

    def get_destination_warehouses(self):
        if self.use_mock:
            return MOCK_WAREHOUSES
        return self._sap_destination_warehouses()

    def get_batch_details(self, batch_number, from_warehouse=None, from_bin=None):
        """
        Look up a single batch in a specific warehouse+bin.

        Returns a flat dict with:
            item_code, item_name, batch_number, batch_abs_entry,
            available_quantity, uom, expiry_date, from_warehouse, from_bin, mock
        """
        if self.use_mock:
            return self._mock_batch_details(batch_number, from_warehouse, from_bin)
        return self._sap_batch_details(batch_number, from_warehouse, from_bin)

    def move_inventory(self, payload):
        """
        Create one SAP Inventory Transfer document with multiple batch lines.

        Expected payload:
        {
            "from_warehouse": "20204",
            "from_bin":       "20204-A01",
            "to_warehouse":   "INTERMEDIATE_WH",
            "to_bin":         "INTERMEDIATE_BIN",
            "lines": [
                {"item_code": "1110111001", "batch_number": "112000032-36", "quantity": 10},
                ...
            ]
        }
        """
        cleaned = self._validate_move_payload(payload, allow_reserved_outbound=True, stored_contract=True)
        if self.use_mock:
            return self._mock_move_inventory(cleaned)
        return self._sap_move_inventory(cleaned)

    # ── SAP implementations ────────────────────────────────────────────────────

    def _sap_destination_warehouses(self):
        result = self.sap_client.get_warehouses()
        rows = result.get("value", []) if isinstance(result, dict) else []
        return [
            {
                "code": row.get("WarehouseCode"),
                "name": row.get("WarehouseName") or row.get("WarehouseCode"),
            }
            for row in rows
            if row.get("WarehouseCode")
        ]

    def _sap_batch_details(self, batch_number, from_warehouse, from_bin):
        normalized = self._normalize_batch_number(batch_number)
        source_whs = str(from_warehouse or "").strip()
        source_bin = str(from_bin or "").strip()

        print(
            f"[TRANSFER-BATCH] batch={normalized!r} "
            f"whs={source_whs!r} bin={source_bin!r}"
        )

        if not normalized:
            return None
        if not source_whs:
            raise TransferBatchNotFound(
                "Select From Warehouse before scanning a batch."
            )
        # source_bin is optional — intermediate warehouses have no bin locations

        row = self._query_batch_bin_quantity(normalized, source_whs, source_bin)
        if not row:
            raise TransferBatchNotFound(
                f"Batch {normalized} not found in warehouse {source_whs} / bin {source_bin}. "
                "Check that the batch exists with available quantity in that bin."
            )

        item_code = row.get("ItemCode") or ""
        item_name = row.get("ItemName") or item_code
        uom = row.get("UOM") or ""
        available_qty = float(self._to_decimal(row.get("AvailableQuantity", 0)))
        expiry_date = self._date_only(row.get("ExpiryDate"))
        batch_abs_entry = row.get("BatchAbsEntry")

        print(
            f"[TRANSFER-BATCH] found item={item_code!r} name={item_name!r} "
            f"qty={available_qty} uom={uom!r}"
        )

        return {
            "item_code": item_code,
            "item_name": item_name,
            "batch_number": normalized,
            "batch_abs_entry": batch_abs_entry,
            "available_quantity": available_qty,
            "uom": uom,
            "expiry_date": expiry_date,
            "from_warehouse": source_whs,
            "from_bin": source_bin,
            "mock": False,
        }

    def _query_batch_bin_quantity(self, batch_number, from_warehouse, from_bin):
        """
        Query SAP batch availability at bin level when from_bin is supplied.

        Bin-managed sources use OBTN + OBBQ + OBIN + OITM so availability is
        restricted to the requested physical SAP bin. Sources without a bin keep
        the existing OBTN + OBTQ warehouse-level lookup.

        Values are embedded directly in the SQL text (no ParamList) because the
        SAP Service Layer helper in this project does not support named parameters.
        The SQL code acts as a reusable slot — ensure_sql_query updates its text
        on every call when the values change.

        Returns the first matching row dict, or None if not found.
        """
        safe_batch = str(batch_number).replace("'", "''")
        safe_whs = str(from_warehouse).replace("'", "''")
        safe_bin = str(from_bin or "").replace("'", "''")

        if safe_bin:
            sql_code = "CODX_TRANS_BATCH_BIN_V1"
            sql_text = (
                'SELECT '
                'T0."AbsEntry" AS "BatchAbsEntry", '
                'T0."DistNumber" AS "BatchNumber", '
                'T0."ItemCode" AS "ItemCode", '
                'T2."ItemName" AS "ItemName", '
                'T3."WhsCode" AS "FromWarehouse", '
                'T3."BinCode" AS "FromBin", '
                'T1."OnHandQty" AS "AvailableQuantity", '
                'T2."InvntryUom" AS "UOM", '
                'T0."ExpDate" AS "ExpiryDate" '
                'FROM "OBTN" T0 '
                'INNER JOIN "OBBQ" T1 '
                '    ON T1."ItemCode" = T0."ItemCode" '
                '   AND T1."SnBMDAbs" = T0."AbsEntry" '
                'INNER JOIN "OBIN" T3 '
                '    ON T3."AbsEntry" = T1."BinAbs" '
                'LEFT JOIN "OITM" T2 '
                '    ON T2."ItemCode" = T0."ItemCode" '
                f'WHERE T0."DistNumber" = \'{safe_batch}\' '
                f'  AND T3."WhsCode" = \'{safe_whs}\' '
                f'  AND T3."BinCode" = \'{safe_bin}\' '
                '  AND T1."OnHandQty" > 0 '
                'ORDER BY T1."OnHandQty" DESC'
            )
            query_name = "Transfer batch bin lookup v1"
        else:
            sql_code = "CODX_TRANS_BATCH_WHS_V1"
            sql_text = (
                'SELECT '
                'T0."AbsEntry" AS "BatchAbsEntry", '
                'T0."DistNumber" AS "BatchNumber", '
                'T0."ItemCode" AS "ItemCode", '
                'T2."ItemName" AS "ItemName", '
                'T1."WhsCode" AS "FromWarehouse", '
                'T1."Quantity" AS "AvailableQuantity", '
                'T2."InvntryUom" AS "UOM", '
                'T0."ExpDate" AS "ExpiryDate" '
                'FROM "OBTN" T0 '
                'INNER JOIN "OBTQ" T1 '
                '    ON T1."ItemCode" = T0."ItemCode" '
                '   AND T1."SysNumber" = T0."SysNumber" '
                'LEFT JOIN "OITM" T2 '
                '    ON T2."ItemCode" = T0."ItemCode" '
                f'WHERE T0."DistNumber" = \'{safe_batch}\' '
                f'  AND T1."WhsCode" = \'{safe_whs}\' '
                '  AND T1."Quantity" > 0 '
                'ORDER BY T1."Quantity" DESC'
            )
            query_name = "Transfer batch warehouse lookup v1"

        print(
            f"[TRANSFER-BATCH] sql_code={sql_code!r} batch={safe_batch!r} "
            f"whs={safe_whs!r} bin={safe_bin!r}"
        )

        ensure_result = self.sap_client.ensure_sql_query(
            sql_code, query_name, sql_text
        )
        if ensure_result and ensure_result.get("error"):
            err = ensure_result["error"]
            msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            raise Exception(f"Failed to register SAP query '{sql_code}': {msg}")

        # No ParamList — values are embedded in the SQL text above
        result = self.sap_client.execute_sql_query(sql_code)
        if result.get("error"):
            err = result["error"]
            msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            raise Exception(f"SAP batch warehouse query failed: {msg}")

        rows = result.get("value", [])
        print(f"[TRANSFER-BATCH] rows_returned={len(rows)}")
        if rows:
            print(f"[TRANSFER-BATCH] first_row={rows[0]}")
        return rows[0] if rows else None

    def _sap_move_inventory(self, payload):
        """
        POST a StockTransfers document with one line per batch in payload['lines'].

        Stage 1 (WAREHOUSE → INTERMEDIATE): Warehouse-to-warehouse only.
        - No bins at all
        - No FromBinAbsEntry or ToBinAbsEntry
        - No StockTransferLinesBinAllocations
        - Simple batch path with no bin allocations

        Stage 2 (INTERMEDIATE → FRIDGE or INTERMEDIATE):
        - From Intermediate (no bins)
        - To Fridge: explicit bin allocations required for destination bin
        - To Intermediate: simple batch path with no bins
        """
        from datetime import date

        doc_date = date.today().strftime("%Y-%m-%d")
        stage = payload.get("transfer_stage", "")
        to_bin = payload.get("to_bin", "")
        destination_abs = None
        if stage == STAGE_3_FROM_FRIDGE:
            from api.services.transfer_destination_bins import validate_destination_bin
            destination_abs = validate_destination_bin(self.sap_client, payload)

        sap_lines = []

        if stage == STAGE_1_TO_INTERMEDIATE:
            # Stage 1: Warehouse → Intermediate (NO BINS AT ALL)
            # Simple batch path with no bin allocations
            for line in payload["lines"]:
                qty = float(line["quantity"])
                sap_line = {
                    "ItemCode": line["item_code"],
                    "Quantity": qty,
                    "FromWarehouseCode": payload["from_warehouse"],
                    "WarehouseCode": payload["to_warehouse"],
                    "BatchNumbers": [
                        {
                            "BatchNumber": line["batch_number"],
                            "Quantity": qty,
                        }
                    ],
                }
                sap_lines.append(sap_line)

        elif (stage == STAGE_2_TO_FRIDGE or stage == STAGE_4_TO_DESTINATION) and to_bin:
            # Destination bin-managed: explicit bin allocations for destination bin
            to_bin_abs = self._get_bin_abs_entry(payload["to_warehouse"], to_bin)
            if to_bin_abs is None:
                raise Exception(
                    f"Cannot resolve bin AbsEntry for bin '{to_bin}' "
                    f"in warehouse '{payload['to_warehouse']}'. "
                    "Verify the bin exists in SAP."
                )
            for line_idx, line in enumerate(payload["lines"]):
                qty = float(line["quantity"])
                sap_line = {
                    "ItemCode": line["item_code"],
                    "Quantity": qty,
                    "FromWarehouseCode": payload["from_warehouse"],
                    "WarehouseCode": payload["to_warehouse"],
                    "BatchNumbers": [
                        {
                            "BatchNumber": line["batch_number"],
                            "Quantity": qty,
                        }
                    ],
                    "StockTransferLinesBinAllocations": [
                        {
                            "BinAbsEntry": to_bin_abs,
                            "Quantity": qty,
                            "AllowNegativeQuantity": "tNO",
                            "BinActionType": "batToWarehouse",
                            "BaseLineNumber": line_idx,
                            "SerialAndBatchNumbersBaseLine": 0,
                        }
                    ],
                }
                sap_lines.append(sap_line)

        elif stage == STAGE_3_FROM_FRIDGE:
            # Stage 3 → From Fridge (bin-managed source): explicit bin allocations for source bin
            from_bin = payload.get("from_bin", "")
            if not from_bin:
                raise Exception("Missing required source bin (from_bin) for outbound transfer.")
            from_bin_abs = self._get_bin_abs_entry(payload["from_warehouse"], from_bin)
            if from_bin_abs is None:
                raise Exception(
                    f"Cannot resolve bin AbsEntry for source bin '{from_bin}' "
                    f"in warehouse '{payload['from_warehouse']}'. "
                    "Verify the bin exists in SAP."
                )

            to_bin = payload.get("to_bin", "")
            to_bin_abs = destination_abs

            for line_idx, line in enumerate(payload["lines"]):
                qty = float(line["quantity"])
                allocations = [
                    {
                        "BinAbsEntry": from_bin_abs,
                        "Quantity": qty,
                        "AllowNegativeQuantity": "tNO",
                        "BinActionType": "batFromWarehouse",
                        "BaseLineNumber": line_idx,
                        "SerialAndBatchNumbersBaseLine": 0,
                    }
                ]
                if to_bin_abs:
                    allocations.append({
                        "BinAbsEntry": to_bin_abs,
                        "Quantity": qty,
                        "AllowNegativeQuantity": "tNO",
                        "BinActionType": "batToWarehouse",
                        "BaseLineNumber": line_idx,
                        "SerialAndBatchNumbersBaseLine": 0,
                    })

                sap_line = {
                    "ItemCode": line["item_code"],
                    "Quantity": qty,
                    "FromWarehouseCode": payload["from_warehouse"],
                    "WarehouseCode": payload["to_warehouse"],
                    "BatchNumbers": [
                        {
                            "BatchNumber": line["batch_number"],
                            "Quantity": qty,
                        }
                    ],
                    "StockTransferLinesBinAllocations": allocations,
                }
                sap_lines.append(sap_line)

        else:
            # Stage 2 → Intermediate: Simple batch path (no bins)
            for line in payload["lines"]:
                qty = float(line["quantity"])
                sap_line = {
                    "ItemCode": line["item_code"],
                    "Quantity": qty,
                    "FromWarehouseCode": payload["from_warehouse"],
                    "WarehouseCode": payload["to_warehouse"],
                    "BatchNumbers": [
                        {
                            "BatchNumber": line["batch_number"],
                            "Quantity": qty,
                        }
                    ],
                }
                sap_lines.append(sap_line)

        sap_payload = {
            "DocDate": doc_date,
            "FromWarehouse": payload["from_warehouse"],
            "ToWarehouse": payload["to_warehouse"],
            "StockTransferLines": sap_lines,
        }

        import json as _json
        if stage == STAGE_3_FROM_FRIDGE:
            from api.services.transfer_destination_bins import validate_destination_allocations
            validate_destination_allocations(sap_lines, destination_abs)
        print("[TRANSFER-MOVE] payload: " + _json.dumps(sap_payload, ensure_ascii=True, default=str))
        result = self.sap_client.create_stock_transfer(sap_payload)
        print("[TRANSFER-MOVE] response keys: " + _json.dumps(
            list(result.keys()) if isinstance(result, dict) else str(result),
            ensure_ascii=True,
        ))

        if result.get("error"):
            err = result["error"]
            msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            if isinstance(err, dict):
                raise DefinitiveSAPPostingFailure(f"SAP StockTransfer failed: {msg}")
            # A string error may be a timeout/transport error returned by
            # SAPServiceLayer._request; the SAP commit outcome is unknown.
            raise Exception(f"SAP StockTransfer failed: {msg}")

        return {
            "success": True,
            "sap_doc_entry": result.get("DocEntry"),
            "sap_doc_num": result.get("DocNum"),
            "mock": False,
        }

    # ── Mock implementations ───────────────────────────────────────────────────

    def _mock_batch_details(self, batch_number, from_warehouse, from_bin):
        normalized = self._normalize_batch_number(batch_number)
        batch = next(
            (
                b
                for b in MOCK_BATCHES
                if self._normalize_batch_number(b["batch_number"]) == normalized
            ),
            None,
        )
        if not batch:
            batch = self._generate_mock_batch(normalized, from_warehouse, from_bin)
        if not batch:
            return None

        if from_warehouse and str(batch["from_warehouse"]) != str(from_warehouse).strip():
            return None
        if from_bin and str(batch["from_bin"]) != str(from_bin).strip():
            return None

        return {
            "item_code": batch["item_code"],
            "item_name": batch["item_name"],
            "batch_number": batch["batch_number"],
            "batch_abs_entry": batch.get("batch_abs_entry"),
            "available_quantity": batch["available_quantity"],
            "uom": batch["uom"],
            "expiry_date": batch.get("expiry_date"),
            "from_warehouse": batch["from_warehouse"],
            "from_bin": batch["from_bin"],
            "mock": True,
        }

    def _mock_move_inventory(self, payload):
        seed_str = "".join(
            str(l["batch_number"]) + str(l["quantity"]) for l in payload["lines"]
        )
        doc_seed = abs(hash(seed_str)) % 10000
        return {
            "success": True,
            "sap_doc_entry": 120000 + doc_seed,
            "sap_doc_num": 450000 + doc_seed,
            "mock": True,
        }

    def _generate_mock_batch(self, batch_number, from_warehouse, from_bin):
        if not batch_number or "-" not in batch_number:
            return None
        prefix, _, suffix = batch_number.partition("-")
        if not prefix.isdigit() or not suffix.isdigit():
            return None
        numeric_seed = int((prefix + suffix)[-5:])
        return {
            "item_code": f"FG-{prefix}",
            "item_name": f"Mock SAP inventory item {batch_number}",
            "batch_number": batch_number,
            "batch_abs_entry": None,
            "from_warehouse": from_warehouse or "WH-PROD",
            "from_bin": from_bin or "PROD-STAGING",
            "available_quantity": (numeric_seed % 90) + 10,
            "uom": "CTN",
            "expiry_date": "2027-12-31",
        }

    # ── Validation ─────────────────────────────────────────────────────────────

    def _validate_move_payload(self, payload, allow_reserved_outbound=False, stored_contract=False):
        # ── Stage ──────────────────────────────────────────────────────────────
        try:
            request_stage = validate_request_header(payload)
            if request_stage == STAGE_4_TO_DESTINATION:
                if str(payload['from_warehouse']).strip() == str(payload['to_warehouse']).strip():
                    raise TransferPolicyError('Stage 4: source and destination warehouse cannot be the same.')
            else:
                policy = self.resolve_transfer_policy(include_persisted=False)
                policy.validate_route(payload)
        except TransferPolicyError as exc:
            raise TransferValidationError(str(exc)) from exc
        stage = str(payload.get("transfer_stage") or "").strip()
        from_whs = str(payload["from_warehouse"]).strip()
        to_whs = str(payload["to_warehouse"]).strip()
        if stage == STAGE_3_FROM_FRIDGE and not self.use_mock:
            if not str(payload.get('from_bin') or '').strip():
                raise TransferValidationError('Stage 3: source bin (from_bin) is required for outbound cold storage transfers.')
            from api.services.transfer_destination_bins import validate_destination_bin
            try:
                validate_destination_bin(self.sap_client, payload)
            except ValueError as exc:
                raise TransferValidationError(str(exc)) from exc

        if stage == STAGE_2_TO_FRIDGE:
            self.validate_stage2_destination_position(payload)

        if stage == STAGE_3_FROM_FRIDGE:
            # Source bin is mandatory for outbound from fridge
            from_bin = str(payload.get("from_bin") or "").strip()
            if not from_bin:
                raise TransferValidationError(
                    "Stage 3: source bin (from_bin) is required for outbound cold storage transfers."
                )

            # source_pallet_position_id is mandatory
            source_pos_id = payload.get("source_pallet_position_id") or payload.get("from_position_id")
            if not source_pos_id:
                raise TransferValidationError(
                    "Missing required field: source_pallet_position_id"
                )

            from api.models_cold_storage import ColdStoragePalletPosition, ColdStorageBinLayout
            try:
                pos_obj = ColdStoragePalletPosition.objects.select_related("bin_layout").get(id=int(source_pos_id))
            except (ColdStoragePalletPosition.DoesNotExist, ValueError, TypeError):
                raise TransferValidationError(
                    f"Source pallet position #{source_pos_id} does not exist."
                )

            # Validate that position belongs to the specified source bin and warehouse
            if pos_obj.bin_code != from_bin or pos_obj.warehouse_code != from_whs:
                raise TransferValidationError(
                    f"Source position #{pos_obj.position_code} belongs to SAP Bin '{pos_obj.bin_code}' "
                    f"in warehouse '{pos_obj.warehouse_code}', not '{from_bin}' in '{from_whs}'."
                )

            # Validate allocation_type: must be ALLOCATABLE
            if pos_obj.bin_layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
                raise TransferValidationError(
                    f"SAP Bin {pos_obj.bin_code} is {pos_obj.bin_layout.allocation_type} and cannot be used for outbound pallet transfer."
                )

            # Validate position status: MUST BE OCCUPIED (or RESERVED_OUTBOUND if posting an already reserved transfer)
            if allow_reserved_outbound:
                if pos_obj.status not in (ColdStoragePalletPosition.OCCUPIED, ColdStoragePalletPosition.RESERVED_OUTBOUND):
                    raise TransferValidationError(
                        f"Position {pos_obj.position_code} in bin {pos_obj.bin_code} is {pos_obj.status} "
                        f"(expected OCCUPIED or RESERVED_OUTBOUND) and cannot be used for outbound transfer."
                    )
            else:
                if pos_obj.status != ColdStoragePalletPosition.OCCUPIED:
                    raise TransferValidationError(
                        f"Position {pos_obj.position_code} in bin {pos_obj.bin_code} is {pos_obj.status} "
                        f"(expected OCCUPIED) and cannot be reserved for outbound transfer."
                    )

            to_bin = str(payload.get("to_bin") or "").strip()
            if to_whs == from_whs and to_bin == from_bin:
                raise TransferValidationError(
                    "Stage 3: source and destination bin cannot be identical in the same warehouse."
                )

        # ── Lines ──────────────────────────────────────────────────────────────
        lines = payload.get("lines") or []
        if not lines:
            raise TransferValidationError("At least one batch line is required.")

        validated_lines = []
        for i, line in enumerate(lines, start=1):
            for field in ("item_code", "batch_number", "quantity"):
                if not str(line.get(field) or "").strip():
                    raise TransferValidationError(
                        f"Line {i}: missing required field '{field}'"
                    )
            try:
                qty = Decimal(str(line["quantity"]))
            except (InvalidOperation, TypeError):
                raise TransferValidationError(
                    f"Line {i}: quantity must be a valid number"
                )
            if qty <= 0:
                raise TransferValidationError(
                    f"Line {i}: quantity must be greater than 0"
                )
            validated_lines.append(
                {
                    "item_code": str(line["item_code"]).strip(),
                    "batch_number": str(line["batch_number"]).strip(),
                    "quantity": qty,
                }
            )

        if stage == STAGE_3_FROM_FRIDGE:
            position_batch = self._normalize_batch_number(pos_obj.current_batch_number)
            requested_batches = {
                self._normalize_batch_number(line["batch_number"])
                for line in validated_lines
            }
            if not position_batch:
                raise TransferValidationError(
                    f"Physical position batch conflict: selected position "
                    f"{pos_obj.position_code} has no recorded current batch."
                )
            if len(requested_batches) != 1:
                raise TransferValidationError(
                    f"Physical position batch conflict: selected position "
                    f"{pos_obj.position_code} represents one pallet batch, but the transfer "
                    "contains multiple batch numbers."
                )
            requested_batch = next(iter(requested_batches))
            if requested_batch != position_batch:
                raise TransferValidationError(
                    f"Physical position batch conflict: selected position "
                    f"{pos_obj.position_code} contains batch {position_batch}, not requested "
                    f"batch {requested_batch}."
                )

        validated_payload = {
            "transfer_stage": stage,
            "from_warehouse": from_whs,
            "from_bin": str(payload.get("from_bin") or "").strip(),
            "to_warehouse": to_whs,
            "to_bin": str(payload.get("to_bin") or "").strip(),
            "lines": validated_lines,
        }
        pos_id = payload.get("pallet_position_id") or payload.get("position_id")
        if pos_id:
            validated_payload["pallet_position_id"] = pos_id
        source_pos_id = payload.get("source_pallet_position_id") or payload.get("from_position_id")
        if source_pos_id:
            validated_payload["source_pallet_position_id"] = source_pos_id
        return validated_payload

    def validate_stage2_destination_position(
        self,
        payload,
        *,
        position_id=None,
        lock=False,
        expected_transfer_reference=None,
    ):
        """Validate Stage 2 physical placement against its authoritative bin layout."""
        if str(payload.get("transfer_stage") or "").strip() != STAGE_2_TO_FRIDGE:
            return None

        from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition

        to_warehouse = str(payload.get("to_warehouse") or "").strip()
        to_bin = str(payload.get("to_bin") or "").strip()
        supplied_position_id = position_id or payload.get("pallet_position_id") or payload.get("position_id")

        layout = None
        if to_warehouse and to_bin:
            layout = ColdStorageBinLayout.objects.filter(
                warehouse_code=to_warehouse,
                bin_code=to_bin,
            ).first()

        warehouse_requires_physical_placement = bool(
            to_warehouse
            and ColdStorageBinLayout.objects.filter(
                warehouse_code=to_warehouse,
                allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE,
            ).exists()
        )
        bin_requires_physical_placement = bool(
            layout and layout.allocation_type == ColdStorageBinLayout.ALLOC_ALLOCATABLE
        )

        if warehouse_requires_physical_placement and not to_bin:
            raise DestinationPositionConflict(
                "Stage 2 destination requires a SAP Bin and physical pallet position."
            )
        if bin_requires_physical_placement and not supplied_position_id:
            raise DestinationPositionConflict(
                f"Stage 2 destination SAP Bin '{to_bin}' requires a physical pallet position."
            )
        if not supplied_position_id:
            return None

        try:
            supplied_position_id = int(supplied_position_id)
        except (TypeError, ValueError):
            raise DestinationPositionConflict(
                f"Invalid destination pallet position identifier: {supplied_position_id}"
            )

        positions = ColdStoragePalletPosition.objects.select_related("bin_layout")
        if lock:
            positions = positions.select_for_update()
        try:
            position = positions.get(id=supplied_position_id)
        except ColdStoragePalletPosition.DoesNotExist:
            raise DestinationPositionConflict(
                f"Destination pallet position #{supplied_position_id} does not exist."
            )

        authoritative_layout = position.bin_layout
        if (
            authoritative_layout.warehouse_code != to_warehouse
            or position.warehouse_code != to_warehouse
        ):
            raise DestinationPositionConflict(
                f"Destination pallet position #{supplied_position_id} belongs to warehouse "
                f"'{authoritative_layout.warehouse_code}', not '{to_warehouse}'."
            )
        if authoritative_layout.bin_code != to_bin or position.bin_code != to_bin:
            raise DestinationPositionConflict(
                f"Destination pallet position #{supplied_position_id} belongs to SAP Bin "
                f"'{authoritative_layout.bin_code}', not '{to_bin}'."
            )
        if authoritative_layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
            raise DestinationPositionConflict(
                f"Destination SAP Bin '{to_bin}' is {authoritative_layout.allocation_type} "
                "and does not accept physical pallet placement."
            )
        if expected_transfer_reference:
            if position.status != ColdStoragePalletPosition.RESERVED:
                raise DestinationPositionConflict(
                    f"Destination pallet position #{supplied_position_id} is {position.status}, "
                    "not RESERVED for this transfer."
                )
            if position.transfer_reference != expected_transfer_reference:
                raise DestinationPositionConflict(
                    f"Destination pallet position #{supplied_position_id} is reserved for "
                    f"'{position.transfer_reference or 'another transfer'}', not "
                    f"'{expected_transfer_reference}'."
                )
        return position

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _resolve_intermediate_warehouses(self):
        return self._policy_resolver().resolve_intermediate()[0]

    def _resolve_fridge_warehouses(self):
        return self._policy_resolver().resolve_fridge()

    def _get_bin_abs_entry(self, warehouse_code, bin_code):
        if not bin_code:
            return None
        result = self.sap_client.get_bin_locations_by_warehouse(warehouse_code)
        for loc in result.get("value", []):
            if str(loc.get("BinCode", "")).strip() == str(bin_code).strip():
                return loc.get("AbsEntry")
        return None

    def _normalize_batch_number(self, batch_number):
        return str(batch_number or "").strip().replace(" ", "").upper()

    def _to_decimal(self, value):
        try:
            return Decimal(str(value or "0"))
        except (InvalidOperation, TypeError):
            return Decimal("0")

    def _date_only(self, value):
        if value in (None, ""):
            return None
        text = str(value)
        if "T" in text:
            return text.split("T", 1)[0]
        if " " in text:
            return text.split(" ", 1)[0]
        return text

    # ── Cold Storage Pallet Position Integration ────────────────────────────────

    def reserve_pallet_position_for_transfer(self, pending_transfer, position_id, user=None):
        """
        Atomically reserve a ColdStoragePalletPosition for a PendingTransferRequest.

        Rules:
        - Position must exist.
        - Position's SAP bin must be ALLOCATABLE.
        - Position must be AVAILABLE.
        - If position is already RESERVED, OCCUPIED, MAINTENANCE, NON_ALLOCATABLE, or UNCONFIGURED,
          raises TransferValidationError (subclass of ValueError) using existing Phase 5 validation.
        - Sets transfer_reference to 'PTR-<id>' on the position.
        - Stores pallet_position and pallet_position_code snapshot on pending_transfer.
        - Concurrency-safe: atomic with select_for_update().
        """
        if not position_id:
            return pending_transfer

        from django.db import transaction
        from api.models_cold_storage import ColdStoragePalletPosition

        if hasattr(position_id, "id"):
            pos_id = position_id.id
        else:
            try:
                pos_id = int(position_id)
            except (ValueError, TypeError):
                raise TransferValidationError(f"Invalid pallet position identifier: {position_id}")

        if not pending_transfer.id:
            pending_transfer.save()

        transfer_ref = f"PTR-{pending_transfer.id}"

        with transaction.atomic():
            self.validate_stage2_destination_position(
                {
                    "transfer_stage": pending_transfer.transfer_stage,
                    "to_warehouse": pending_transfer.to_warehouse,
                    "to_bin": pending_transfer.to_bin,
                },
                position_id=pos_id,
                lock=True,
            )
            try:
                reserved_pos = ColdStoragePalletPosition.reserve_position(
                    position_id=pos_id,
                    user=user or pending_transfer.created_by,
                    reference=transfer_ref,
                    transfer_reference=transfer_ref,
                )
            except ColdStoragePalletPosition.DoesNotExist:
                raise TransferValidationError(f"Pallet position #{pos_id} does not exist.")
            except ValueError as exc:
                raise TransferValidationError(str(exc))

            pending_transfer.pallet_position = reserved_pos
            pending_transfer.pallet_position_code = reserved_pos.position_code
            pending_transfer.save(update_fields=["pallet_position", "pallet_position_code", "updated_at"])
            return pending_transfer

    def release_pallet_position_for_transfer(self, pending_transfer, user=None):
        """
        Release a reserved ColdStoragePalletPosition associated with a PendingTransferRequest
        back to AVAILABLE when the transfer is cancelled or deleted before SAP posting.

        Rules:
        - If no position is linked, returns None.
        - If position is OCCUPIED, raises TransferValidationError (never release occupied positions).
        - Changes status: RESERVED -> AVAILABLE.
        - Clears reservation metadata and transfer_reference on the position.
        - Clears pallet_position and pallet_position_code on pending_transfer.
        - Concurrency-safe: atomic with select_for_update().
        """
        pos_id = pending_transfer.pallet_position_id
        if not pos_id:
            return None

        from django.db import transaction
        from api.models_cold_storage import ColdStoragePalletPosition

        with transaction.atomic():
            try:
                released_pos = ColdStoragePalletPosition.release_position(
                    position_id=pos_id,
                    user=user or pending_transfer.created_by,
                )
            except ColdStoragePalletPosition.DoesNotExist:
                return None
            except ValueError as exc:
                raise TransferValidationError(str(exc))

            pending_transfer.pallet_position = None
            pending_transfer.pallet_position_code = ""
            pending_transfer.save(update_fields=["pallet_position", "pallet_position_code", "updated_at"])
            return released_pos

    def occupy_pallet_position_for_transfer(self, pending_transfer, user=None):
        """
        Transition a reserved ColdStoragePalletPosition to OCCUPIED after confirmed SAP posting.

        Rules:
        - Position must be linked to the transfer.
        - Must be idempotent: if already OCCUPIED for this transfer (e.g. retry), returns cleanly.
        - Position must be in RESERVED status (or already OCCUPIED by this transfer).
        - Reservation must belong to this transfer (transfer_reference == 'PTR-<id>').
        - Uses actual batch_number from pending_transfer (or lines).
        - Calls existing Phase 5 ColdStoragePalletPosition.occupy_position().
        - Concurrency-safe: atomic with select_for_update().
        """
        pos_id = pending_transfer.pallet_position_id
        if not pos_id:
            return None

        from django.db import transaction
        from api.models import PendingTransferRequest
        from api.models_cold_storage import ColdStoragePalletPosition

        expected_ref = f"PTR-{pending_transfer.id}"
        batch_num = str(pending_transfer.batch_number or "").strip()
        if not batch_num and pending_transfer.lines:
            batch_num = str(pending_transfer.lines[0].get("batch_number") or "").strip()

        with transaction.atomic():
            try:
                pos = ColdStoragePalletPosition.objects.select_for_update().select_related("bin_layout").get(id=pos_id)
            except ColdStoragePalletPosition.DoesNotExist:
                raise TransferValidationError(f"Pallet position #{pos_id} not found.")

            # Idempotency check:
            if pos.status == ColdStoragePalletPosition.OCCUPIED:
                if pos.transfer_reference == expected_ref or pending_transfer.status == PendingTransferRequest.POSTED:
                    return pos
                raise TransferValidationError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is already OCCUPIED by {pos.transfer_reference or 'another record'}."
                )

            # State validation: must be RESERVED
            if pos.status != ColdStoragePalletPosition.RESERVED:
                raise TransferValidationError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is {pos.status} (expected RESERVED for {expected_ref})."
                )

            # Reservation ownership validation:
            if pos.transfer_reference and pos.transfer_reference != expected_ref:
                raise TransferValidationError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is RESERVED for {pos.transfer_reference}, not {expected_ref}."
                )

            # Delegate to existing Phase 5 occupy_position:
            occupied_pos = ColdStoragePalletPosition.occupy_position(
                position_id=pos.id,
                user=user or pending_transfer.posted_by or pending_transfer.created_by,
                batch_number=batch_num,
                reference=expected_ref,
                transfer_reference=expected_ref,
            )
            return occupied_pos

    def reserve_source_pallet_position_for_transfer(self, pending_transfer, position_id, user=None):
        """
        Reserve an OCCUPIED ColdStoragePalletPosition for outbound transfer.
        Transitions OCCUPIED -> RESERVED_OUTBOUND.
        Stores source_pallet_position and source_pallet_position_code snapshot on pending_transfer.
        Preserves current batch number and existing transfer reference.
        Concurrency-safe: atomic with select_for_update().
        """
        if not position_id:
            return pending_transfer

        from django.db import transaction
        from api.models_cold_storage import ColdStoragePalletPosition

        if hasattr(position_id, "id"):
            pos_id = position_id.id
        else:
            try:
                pos_id = int(position_id)
            except (ValueError, TypeError):
                raise TransferValidationError(f"Invalid source pallet position identifier: {position_id}")

        if not pending_transfer.id:
            pending_transfer.save()

        transfer_ref = f"PTR-{pending_transfer.id}"

        with transaction.atomic():
            try:
                pos = ColdStoragePalletPosition.objects.select_for_update().select_related("bin_layout").get(id=pos_id)
            except ColdStoragePalletPosition.DoesNotExist:
                raise TransferValidationError(f"Pallet position #{pos_id} does not exist.")

            # Validate bin match if pending_transfer has from_bin
            if pending_transfer.from_bin and pos.bin_code != pending_transfer.from_bin:
                raise TransferValidationError(
                    f"Position {pos.position_code} belongs to bin {pos.bin_code}, not {pending_transfer.from_bin}."
                )
            if pending_transfer.from_warehouse and pos.warehouse_code != pending_transfer.from_warehouse:
                raise TransferValidationError(
                    f"Position {pos.position_code} belongs to warehouse {pos.warehouse_code}, not {pending_transfer.from_warehouse}."
                )

            # Idempotency check: if already reserved for THIS transfer, return cleanly
            if pos.status == ColdStoragePalletPosition.RESERVED_OUTBOUND and pending_transfer.source_pallet_position_id == pos.id:
                return pending_transfer

            if pos.status == ColdStoragePalletPosition.OCCUPIED:
                position_batch = self._normalize_batch_number(pos.current_batch_number)
                requested_batches = {
                    self._normalize_batch_number(
                        line.get("batch_number") or line.get("batchNumber")
                    )
                    for line in (pending_transfer.lines or [])
                }
                requested_batches.discard("")
                if not requested_batches:
                    snapshot_batch = self._normalize_batch_number(
                        pending_transfer.batch_number
                    )
                    if snapshot_batch:
                        requested_batches.add(snapshot_batch)
                if not position_batch:
                    raise TransferValidationError(
                        f"Physical position batch conflict: selected position "
                        f"{pos.position_code} has no recorded current batch."
                    )
                if len(requested_batches) != 1:
                    raise TransferValidationError(
                        f"Physical position batch conflict: selected position "
                        f"{pos.position_code} represents one pallet batch, but the transfer "
                        "contains multiple batch numbers."
                    )
                requested_batch = next(iter(requested_batches))
                if requested_batch != position_batch:
                    raise TransferValidationError(
                        f"Physical position batch conflict: selected position "
                        f"{pos.position_code} contains batch {position_batch}, not requested "
                        f"batch {requested_batch}."
                    )

            try:
                reserved_pos = ColdStoragePalletPosition.reserve_position_for_outbound(
                    position_id=pos.id,
                    user=user or pending_transfer.created_by,
                    reference=f"OUTBOUND: {transfer_ref}",
                )
            except ValueError as exc:
                raise TransferValidationError(str(exc))

            pending_transfer.source_pallet_position = reserved_pos
            pending_transfer.source_pallet_position_code = reserved_pos.position_code
            pending_transfer.save(update_fields=["source_pallet_position", "source_pallet_position_code", "updated_at"])
            return pending_transfer

    def release_source_pallet_position_for_transfer(self, pending_transfer, user=None):
        """
        Release a RESERVED_OUTBOUND ColdStoragePalletPosition associated with a PendingTransferRequest
        back to OCCUPIED when the outbound transfer is cancelled or deleted before SAP posting.
        Concurrency-safe: atomic with select_for_update().
        """
        pos_id = pending_transfer.source_pallet_position_id
        if not pos_id:
            return None

        from django.db import transaction
        from api.models_cold_storage import ColdStoragePalletPosition

        with transaction.atomic():
            try:
                released_pos = ColdStoragePalletPosition.release_outbound_reservation(
                    position_id=pos_id,
                    user=user or pending_transfer.created_by,
                )
            except ColdStoragePalletPosition.DoesNotExist:
                return None
            except ValueError as exc:
                raise TransferValidationError(str(exc))

            pending_transfer.source_pallet_position = None
            pending_transfer.source_pallet_position_code = ""
            pending_transfer.save(update_fields=["source_pallet_position", "source_pallet_position_code", "updated_at"])
            return released_pos

    def vacate_source_pallet_position_for_transfer(self, pending_transfer, user=None):
        """
        Transition a RESERVED_OUTBOUND ColdStoragePalletPosition to AVAILABLE after confirmed SAP posting.

        Rules:
        - If no source position is linked, returns None.
        - Must be idempotent: if already AVAILABLE (e.g. retry), returns cleanly.
        - Position must be in RESERVED_OUTBOUND status (or already AVAILABLE).
        - Calls ColdStoragePalletPosition.vacate_outbound_position().
        - Concurrency-safe: atomic with select_for_update().
        """
        pos_id = pending_transfer.source_pallet_position_id
        if not pos_id:
            return None

        from django.db import transaction
        from api.models_cold_storage import ColdStoragePalletPosition

        with transaction.atomic():
            try:
                pos = ColdStoragePalletPosition.objects.select_for_update().select_related("bin_layout").get(id=pos_id)
            except ColdStoragePalletPosition.DoesNotExist:
                raise TransferValidationError(f"Source pallet position #{pos_id} not found.")

            # Idempotency check:
            if pos.status == ColdStoragePalletPosition.AVAILABLE:
                return pos

            if pos.status != ColdStoragePalletPosition.RESERVED_OUTBOUND:
                raise TransferValidationError(
                    f"Position {pos.position_code} in bin {pos.bin_code} is {pos.status} (expected RESERVED_OUTBOUND for outbound transfer)."
                )

            vacated_pos = ColdStoragePalletPosition.vacate_outbound_position(
                position_id=pos.id,
                user=user or pending_transfer.posted_by or pending_transfer.created_by,
            )
            return vacated_pos


def reserve_pallet_position_for_transfer(pending_transfer, position_id, user=None):
    """Module-level convenience helper for reserving a cold storage pallet position for a transfer."""
    svc = TransferInventoryService()
    return svc.reserve_pallet_position_for_transfer(pending_transfer, position_id, user=user)


def release_pallet_position_for_transfer(pending_transfer, user=None):
    """Module-level convenience helper for releasing a cold storage pallet position from a transfer."""
    svc = TransferInventoryService()
    return svc.release_pallet_position_for_transfer(pending_transfer, user=user)


def occupy_pallet_position_for_transfer(pending_transfer, user=None):
    """Module-level convenience helper for occupying a cold storage pallet position for a transfer."""
    svc = TransferInventoryService()
    return svc.occupy_pallet_position_for_transfer(pending_transfer, user=user)


def reserve_source_pallet_position_for_transfer(pending_transfer, position_id, user=None):
    """Module-level convenience helper for reserving an occupied source position for outbound transfer."""
    svc = TransferInventoryService()
    return svc.reserve_source_pallet_position_for_transfer(pending_transfer, position_id, user=user)


def release_source_pallet_position_for_transfer(pending_transfer, user=None):
    """Module-level convenience helper for releasing an outbound position reservation back to OCCUPIED."""
    svc = TransferInventoryService()
    return svc.release_source_pallet_position_for_transfer(pending_transfer, user=user)


def vacate_source_pallet_position_for_transfer(pending_transfer, user=None):
    """Module-level convenience helper for vacating an outbound position after confirmed SAP posting."""
    svc = TransferInventoryService()
    return svc.vacate_source_pallet_position_for_transfer(pending_transfer, user=user)
