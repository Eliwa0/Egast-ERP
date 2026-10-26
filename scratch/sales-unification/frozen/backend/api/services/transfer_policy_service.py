"""Deployment-scoped Transfer policy; deliberately contains no authorization.

Phase 1 preserves the existing permissive fallbacks and UI discovery heuristics.
Active persisted revisions narrow routes without expanding user grants.
No SAP writes, process-global policy cache, or inferred Shipping Dock mapping.
"""
import os
from dataclasses import dataclass

from api.services.cache_service import sap_master_namespace


STAGE_1_TO_INTERMEDIATE = "STAGE_1_TO_INTERMEDIATE"
STAGE_2_TO_FRIDGE = "STAGE_2_TO_FRIDGE"
STAGE_3_FROM_FRIDGE = "STAGE_3_FROM_FRIDGE"
STAGE_4_TO_DESTINATION = "STAGE_4_TO_DESTINATION"
VALID_STAGES = (STAGE_1_TO_INTERMEDIATE, STAGE_2_TO_FRIDGE, STAGE_3_FROM_FRIDGE, STAGE_4_TO_DESTINATION)
TRANSIT_KEYWORDS = ["stock-in-transit", "transit", "تحت النقل", "وسيط"]


class TransferPolicyError(ValueError):
    pass


def legacy_warehouse_codes(key):
    # These historically read the deployment environment, not settings overrides.
    return [code.strip() for code in os.environ.get(key, "").split(",") if code.strip()]


def validate_request_header(payload):
    """Check capability/required fields before legacy discovery can perform SAP reads."""
    key = str(payload.get("transfer_stage") or "").strip()
    if not key:
        raise TransferPolicyError("Missing required field: transfer_stage")
    if key not in VALID_STAGES:
        raise TransferPolicyError(
            f"Invalid transfer_stage {key!r}. Must be one of: {', '.join(VALID_STAGES)}"
        )
    for field in ("from_warehouse", "to_warehouse"):
        if not str(payload.get(field) or "").strip():
            raise TransferPolicyError(f"Missing required field: {field}")
    return key


@dataclass
class ResolvedTransferPolicy:
    config: dict

    def stage(self, key):
        if not key:
            raise TransferPolicyError("Missing required field: transfer_stage")
        if key not in self.config["stages"]:
            raise TransferPolicyError(
                f"Invalid transfer_stage {key!r}. Must be one of: {', '.join(VALID_STAGES)}"
            )
        policy = self.config["stages"][key]
        return policy

    def validate_route(self, payload):
        """Operational checks only; live stock/positions and user grants stay separate."""
        key = validate_request_header(payload)
        policy = self.stage(key)
        source = str(payload["from_warehouse"]).strip()
        destination = str(payload["to_warehouse"]).strip()
        has_bin = bool(str(payload.get("to_bin") or "").strip())
        intermediate = self.config["intermediate_warehouses"]
        fridge = self.config["fridge_warehouses"]
        persisted = policy.get("policy_source") == "persisted_policy"
        if key == STAGE_4_TO_DESTINATION and persisted:
            if source not in policy["source_warehouses"]["allowed"]:
                raise TransferPolicyError("Stage 4 source must match the active Transfer policy.")
            if source == destination:
                raise TransferPolicyError("Stage 4: source and destination warehouse cannot be the same.")
        if persisted:
            for endpoint, field, requirement in (("from_bin", "allowed_source_bins", "source_bin_policy"), ("to_bin", "allowed_destination_bins", "destination_bin_policy")):
                if key == STAGE_4_TO_DESTINATION and endpoint == 'to_bin':
                    continue
                if key == STAGE_3_FROM_FRIDGE and endpoint == 'to_bin':
                    # Live SAP warehouse master data owns the destination bin requirement.
                    continue
                if key == STAGE_2_TO_FRIDGE and endpoint == "to_bin" and policy.get("ui", {}).get("destination_selection_policy") == "transaction_position":
                    pair = next((route for route in policy["route_pairs"] if route["from_warehouse"] == source and route["to_warehouse"] == destination), None)
                    if pair and pair.get("destination_type") == "fridge" and not str(payload.get("to_bin") or "").strip():
                        raise TransferPolicyError("to_bin must be selected with the Cold Storage physical position.")
                    if pair and pair.get("destination_type") == "fridge" and not (payload.get("pallet_position_id") or payload.get("position_id")):
                        raise TransferPolicyError("A user-selected Cold Storage physical position is required.")
                    # The existing position validator verifies the selected SAP bin
                    # against the user-selected physical position and warehouse.
                    continue
                code = source if endpoint == "from_bin" else destination
                selected = str(payload.get(endpoint) or "").strip()
                allowed = policy.get(field, {}).get(code, [])
                if (policy[requirement] == "required" or allowed) and not selected:
                    raise TransferPolicyError(f"{endpoint} is required by the stored policy.")
                if selected and not any(b["bin_code"] == selected for b in allowed):
                    raise TransferPolicyError(f"{endpoint} is not explicitly allowed by Transfer policy.")
            if key == STAGE_2_TO_FRIDGE:
                pair = next((p for p in policy["route_pairs"] if p["from_warehouse"] == source and p["to_warehouse"] == destination), None)
                if pair and str(payload.get("destination_type") or payload.get("to_destination_type") or "") != pair["destination_type"]:
                    raise TransferPolicyError("Stage 2 destination_type disagrees with configured route.")
        elif key == STAGE_1_TO_INTERMEDIATE and intermediate:
            if destination not in intermediate:
                raise TransferPolicyError(
                    f"Stage 1: destination warehouse must be the intermediate "
                    f"warehouse ({', '.join(intermediate)}). Got: {destination!r}."
                )
            if source in intermediate:
                raise TransferPolicyError(
                    f"Stage 1: source warehouse cannot be the intermediate warehouse "
                    f"({source!r}). Use Stage 2 for Intermediate → Fridge transfers."
                )
        elif key == STAGE_2_TO_FRIDGE:
            if intermediate and source not in intermediate:
                raise TransferPolicyError(
                    f"Stage 2: source warehouse must be the intermediate warehouse "
                    f"({', '.join(intermediate)}). Got: {source!r}."
                )
            if has_bin and fridge and destination not in fridge:
                raise TransferPolicyError(
                    f"Stage 2: destination warehouse must be a fridge warehouse "
                    f"({', '.join(fridge)}). Got: {destination!r}."
                )
            if not has_bin and destination == source:
                raise TransferPolicyError("Stage 2: source and destination warehouse cannot be the same.")
        elif key == STAGE_3_FROM_FRIDGE and fridge and source not in fridge:
            raise TransferPolicyError(
                f"Stage 3: source warehouse must be a fridge warehouse "
                f"({', '.join(fridge)}). Got: {source!r}."
            )
        elif key == STAGE_4_TO_DESTINATION:
            if destination == source:
                raise TransferPolicyError("Stage 4: source and destination warehouse cannot be the same.")
        # None means legacy constraints above, NOT an empty route allowlist.
        pairs = policy["route_pairs"]
        if pairs is not None and not any(
            pair["from_warehouse"] == source and pair["to_warehouse"] == destination
            for pair in pairs
        ):
            raise TransferPolicyError("Source/destination route is not allowed by Transfer policy.")
        return policy


class TransferPolicyResolver:
    """A new resolution per invocation, scoped to one deployed SAP connection."""

    def __init__(self, sap_client=None, use_mock=False):
        self.sap_client = sap_client
        self.use_mock = use_mock

    def resolve_intermediate(self):
        codes = legacy_warehouse_codes("TRANSFER_INTERMEDIATE_WAREHOUSES")
        if codes:
            return codes, []
        if self.use_mock or self.sap_client is None:
            return [], []
        try:
            candidates = self.sap_client.get_intermediate_warehouses()
            return [c["code"] for c in candidates if c.get("code") and not c.get("inactive")], candidates
        except Exception:
            # Preserve legacy skipped membership validation when discovery fails.
            return [], []

    def resolve_fridge(self):
        return legacy_warehouse_codes("TRANSFER_FRIDGE_WAREHOUSES")

    def resolve(self, *, intermediate=None, fridge=None, include_persisted=True, administration=False):
        candidates = []
        if intermediate is None:
            intermediate, candidates = self.resolve_intermediate()
        if fridge is None:
            fridge = self.resolve_fridge()
        intermediate, fridge = list(intermediate), list(fridge)
        selector_all = {"mode": "all"}
        selector_intermediate = {"mode": "codes", "codes": intermediate}
        selector_storage = {
            "mode": "all", "exclude_codes": intermediate,
            "exclude_name_keywords": list(TRANSIT_KEYWORDS),
        }

        def stage(label, description, source, destination, source_bin, destination_bin,
                  source_position, destination_position, effect, ui):
            return {
                "enabled": True, "label": label, "description": description,
                "route_pairs": None,
                "source_warehouses": source, "destination_warehouses": destination,
                "source_bin_policy": source_bin, "destination_bin_policy": destination_bin,
                "source_position_required": source_position,
                "destination_position_policy": destination_position,
                "physical_effect": effect, "quantity_policy": "legacy_positive_available",
                "ui": ui,
            }

        stages = {
            STAGE_1_TO_INTERMEDIATE: stage(
                "Stage 1 — Station → Intermediate",
                "From production/station warehouse to intermediate warehouse.",
                {"excluded": intermediate}, {"allowed": intermediate or None},
                "unused", "unused", False, "none", "none",
                {"source": {"mode": "all", "exclude_codes": intermediate},
                 "destination": selector_intermediate, "destination_types": [],
                 "inferred_route_endpoint": "TO",
                 "source_bin_required": False, "destination_bin_required_types": [],
                 "fetch_destination_bins": False},
            ),
            STAGE_2_TO_FRIDGE: stage(
                "Stage 2 — Intermediate → Fridge",
                "From intermediate warehouse to fridge/cold store.",
                {"allowed": intermediate or None},
                {"with_bin_allowed": fridge or None, "without_bin": "different_from_source"},
                "unused", "legacy_destination_layout", False, "legacy_destination_layout",
                "occupy_linked_destination",
                {"source": selector_intermediate,
                 "destination_by_type": {"intermediate": selector_intermediate, "fridge": selector_storage},
                 "destination_types": ["intermediate", "fridge"],
                 "default_destination_type": "intermediate", "destination_type_required": True,
                 "destination_type_by_warehouse": {"codes": intermediate, "matched": "intermediate", "other": "fridge"},
                 "inferred_route_endpoint": "FROM",
                 "source_bin_required": False, "destination_bin_required_types": ["fridge"],
                 "destination_position_requires_selected_bin": True,
                 "fetch_destination_bins_types": ["fridge"]},
            ),
            STAGE_3_FROM_FRIDGE: stage(
                "Stage 3 — From Fridge / Outbound",
                "From fridge/cold store to destination warehouse.",
                {"allowed": fridge or None}, {"allowed": None},
                "required", "optional", True, "none", "vacate_linked_source",
                {"source": selector_storage,
                 "destination": {**selector_all, "exclude_source": True, "prepend_codes": intermediate},
                 "destination_types": [], "source_bin_required": True,
                 "destination_bin_required_types": [], "fetch_destination_bins": True},
            ),
            STAGE_4_TO_DESTINATION: stage(
                "Stage 4 — Intermediate → Destination Warehouse",
                "From intermediate warehouse to user-selected warehouse.",
                {"allowed": intermediate or None}, {"allowed": None},
                "unused", "unused", False, "none", "none",
                {"source": selector_intermediate,
                 "destination": {**selector_all, "exclude_source": True},
                 "destination_types": [],
                 "inferred_route_endpoint": "FROM",
                 "source_bin_required": False,
                 "destination_bin_required_types": [],
                 "fetch_destination_bins": True},
            ),
        }
        for key, policy in stages.items():
            policy["key"] = key
        stages[STAGE_4_TO_DESTINATION]["intermediate_warehouse"] = intermediate[0] if len(intermediate) == 1 else ""
        # Old response keys stay available to existing clients.
        stages[STAGE_1_TO_INTERMEDIATE]["to_warehouses"] = intermediate
        stages[STAGE_2_TO_FRIDGE]["from_warehouses"] = intermediate
        stages[STAGE_2_TO_FRIDGE]["to_warehouses"] = fridge
        stages[STAGE_4_TO_DESTINATION]["from_warehouses"] = intermediate
        config = {
            "policy_version": 1, "policy_source": "legacy_deployment",
            "company_scope": sap_master_namespace("transfer-policy"),
            "stages": stages, "intermediate_warehouses": intermediate,
            "fridge_warehouses": fridge,
            "intermediate_configured": bool(legacy_warehouse_codes("TRANSFER_INTERMEDIATE_WAREHOUSES")),
            "fridge_configured": bool(legacy_warehouse_codes("TRANSFER_FRIDGE_WAREHOUSES")),
            "intermediate_candidates": candidates,
        }
        for policy in stages.values():
            policy["policy_source"] = "legacy_deployment"
        if include_persisted and not self.use_mock:
            from api.models_transfer_policy import TransferPolicyRevision
            from api.services.persisted_transfer_policy_service import effective_stage
            rows = TransferPolicyRevision.objects.filter(company_scope=config["company_scope"], **({} if administration else {"state": "ACTIVE"}))
            if administration:
                # Administration shows saved intent, independently per stage.
                # Drafts are not activated or passed to the execution resolver.
                priority = {"ACTIVE": 0, "DRAFT": 1, "DISABLED": 2}
                rows = sorted(rows, key=lambda row: (priority[row.state], -row.revision))
            selected = set()
            for row in rows:
                if row.stage_key not in VALID_STAGES:
                    raise TransferPolicyError("Persisted policy has an invalid stage.")
                if row.stage_key in selected:
                    continue
                selected.add(row.stage_key)
                stages[row.stage_key] = effective_stage(row, stages[row.stage_key], administration=administration)
                if administration:
                    stages[row.stage_key]["state"] = row.state
                config["policy_source"] = "persisted_policy"
        config["stage_sources"] = {key: value["policy_source"] for key, value in stages.items()}
        return ResolvedTransferPolicy(config)


def validate_master_data_boundary(warehouse, bin_record=None, *, require_bin=False, physical=False):
    """Pure future activation boundary; no SAP calls or new legacy restrictions."""
    truthy = lambda value: str(value).lower() in {"true", "1", "tyes"}
    if not warehouse or not warehouse.get("WarehouseCode") or truthy(warehouse.get("Inactive")):
        raise TransferPolicyError("Warehouse must exist and be active.")
    if require_bin and not bin_record:
        raise TransferPolicyError("A destination bin is required.")
    if bin_record:
        if bin_record.get("Warehouse") != warehouse["WarehouseCode"]:
            raise TransferPolicyError("Bin does not belong to the selected warehouse.")
        if not bin_record.get("AbsEntry") or not bin_record.get("BinCode") or truthy(bin_record.get("Inactive")):
            raise TransferPolicyError("Bin must exist and be active.")
        if warehouse.get("EnableBinLocations") is not None and not truthy(warehouse["EnableBinLocations"]):
            raise TransferPolicyError("Warehouse does not enable bins.")
        if physical and truthy(bin_record.get("IsSystemBin")):
            raise TransferPolicyError("A system bin is not a physical position.")
