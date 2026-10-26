"""Explicit per-stage configuration and fresh, read-only SAP validation."""
from copy import deepcopy
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from api.models_transfer_policy import TransferPolicyRevision
from api.services.cache_service import sap_master_namespace
from api.services.transfer_policy_service import (
    TransferPolicyError, TransferPolicyResolver, VALID_STAGES,
    STAGE_1_TO_INTERMEDIATE, STAGE_2_TO_FRIDGE, STAGE_3_FROM_FRIDGE, STAGE_4_TO_DESTINATION,
    validate_master_data_boundary,
)

SNAPSHOT_KEY = "_transfer_policy"


def company_scope():
    return sap_master_namespace("transfer-policy")


def sap_boolean(record, field):
    value = str(record.get(field)).lower()
    if value not in {"tyes", "tno", "true", "false", "1", "0"}:
        raise TransferPolicyError(f"SAP {field} safety metadata is unavailable.")
    return value in {"tyes", "true", "1"}


def normalize_configuration(stage, configuration, *, legacy_stage2_bins=False):
    if stage not in VALID_STAGES:
        raise TransferPolicyError("Unknown stage; BOTH is an authorization value only.")
    if not isinstance(configuration, dict):
        raise TransferPolicyError("configuration must be an object.")
    default = TransferPolicyResolver(use_mock=True).resolve(include_persisted=False).config["stages"][stage]
    allowed = {"enabled", "label", "description", "route_pairs", "source_bin_policy", "destination_bin_policy",
               "source_position_required", "destination_position_policy", "physical_effect", "quantity_policy",
               "allowed_source_bins", "allowed_destination_bins", "source_physical_purpose", "destination_physical_purpose"}
    if stage == STAGE_4_TO_DESTINATION:
        allowed.add("intermediate_warehouse")
    if set(configuration) - allowed:
        raise TransferPolicyError("Unknown configuration fields: " + ", ".join(sorted(set(configuration) - allowed)))
    result = {key: deepcopy(default[key]) for key in allowed if key in default}
    result.update(deepcopy(configuration))
    if stage in {STAGE_1_TO_INTERMEDIATE, STAGE_2_TO_FRIDGE, STAGE_4_TO_DESTINATION}:
        # These describe the existing posting paths, not administrator capabilities.
        for field in ("source_position_required", "destination_position_policy", "physical_effect", "quantity_policy", "source_bin_policy", "destination_bin_policy"):
            result[field] = deepcopy(default[field])
    if type(result["enabled"]) is not bool or type(result["source_position_required"]) is not bool:
        raise TransferPolicyError("enabled and source_position_required must be booleans.")
    if any(not isinstance(result[field], str) for field in ("label", "description", "source_bin_policy", "destination_bin_policy", "destination_position_policy", "physical_effect", "quantity_policy")):
        raise TransferPolicyError("Policy metadata and capability fields must be strings.")
    for field in ("source_physical_purpose", "destination_physical_purpose"):
        if field in result and (not isinstance(result[field], str) or result[field] not in {"cold_storage", "shipping_dock", "none"}):
            raise TransferPolicyError("Unknown explicit physical purpose.")
    if stage == STAGE_4_TO_DESTINATION:
        # Read older revisions without rewriting them; new revisions store no routes.
        source = configuration.get("intermediate_warehouse")
        if source is None:
            sources = {p.get("from_warehouse") for p in (result.get("route_pairs") or []) if isinstance(p, dict)}
            source = next(iter(sources), "") if len(sources) <= 1 else ""
        if not isinstance(source, str) or source != source.strip():
            raise TransferPolicyError("Intermediate Warehouse must be an exact warehouse code.")
        result["intermediate_warehouse"] = source
        result.pop("route_pairs", None)
        result["allowed_source_bins"] = {}
        result["allowed_destination_bins"] = {}
        return result
    pairs = result.get("route_pairs")
    if not isinstance(pairs, list):
        raise TransferPolicyError("An explicit route_pairs list is required.")
    seen = set()
    destination_types = {}
    for pair in pairs:
        if not isinstance(pair, dict) or set(pair) - {"from_warehouse", "to_warehouse", "destination_type"}:
            raise TransferPolicyError("Invalid route pair fields.")
        source, destination = pair.get("from_warehouse"), pair.get("to_warehouse")
        if not isinstance(source, str) or not isinstance(destination, str) or not source.strip() or not destination.strip():
            raise TransferPolicyError("Both exact warehouse codes are required.")
        if source != source.strip() or destination != destination.strip() or source == destination:
            raise TransferPolicyError("Contradictory or non-exact warehouse route.")
        route = (source, destination)
        if route in seen:
            raise TransferPolicyError("Duplicate route pair.")
        seen.add(route)
        if stage == STAGE_2_TO_FRIDGE and "destination_type" in pair and (not isinstance(pair["destination_type"], str) or pair["destination_type"] not in {"intermediate", "fridge"}):
            raise TransferPolicyError("Stage 2 routes require an explicit destination_type.")
        if stage == STAGE_2_TO_FRIDGE and "destination_type" in pair:
            if destination in destination_types and destination_types[destination] != pair["destination_type"]:
                raise TransferPolicyError("Contradictory physical purposes for one destination warehouse.")
            destination_types[destination] = pair["destination_type"]
    for field, endpoint in (("allowed_source_bins", "from_warehouse"), ("allowed_destination_bins", "to_warehouse")):
        mappings = result.setdefault(field, {})
        if not isinstance(mappings, dict):
            raise TransferPolicyError(f"{field} must be a warehouse-to-bin-list object.")
        endpoints = {p[endpoint] for p in pairs}
        for warehouse, bins in mappings.items():
            if warehouse not in endpoints or not isinstance(bins, list):
                raise TransferPolicyError("Bin mapping is outside configured routes.")
            for entry in bins:
                if not isinstance(entry, dict) or set(entry) - {"bin_code", "abs_entry"} or not isinstance(entry.get("bin_code"), str) or not entry["bin_code"].strip():
                    raise TransferPolicyError("Each bin mapping requires an exact bin_code and optional abs_entry.")
                if entry["bin_code"] != entry["bin_code"].strip():
                    raise TransferPolicyError("Bin codes must be exact.")
    if stage == STAGE_2_TO_FRIDGE and not legacy_stage2_bins:
        # SAP bin and pallet-position identity are selected on the movement.
        result["allowed_destination_bins"] = {}
    return result


def validate_configuration(stage, config, sap, *, activation=False, legacy_stage2_bins=False):
    """Incomplete intent is a draft; invalid explicit master-data mappings are errors."""
    config = normalize_configuration(stage, config, legacy_stage2_bins=legacy_stage2_bins)
    if stage == STAGE_4_TO_DESTINATION:
        code = config["intermediate_warehouse"]
        if not code:
            if activation:
                raise TransferPolicyError("Intermediate Warehouse is required.")
            return config, ["Intermediate Warehouse is required."]
        try:
            record = sap.get_warehouse_details(code)
            if not isinstance(record, dict) or record.get("WarehouseCode") != code:
                raise TransferPolicyError("Intermediate Warehouse must exist with its exact SAP code.")
            validate_master_data_boundary(record)
            if sap_boolean(record, "Inactive"):
                raise TransferPolicyError("Intermediate Warehouse must be active.")
            if sap_boolean(record, "EnableBinLocations"):
                raise TransferPolicyError("Intermediate Warehouse cannot require source bins for this warehouse-to-warehouse stage.")
        except TransferPolicyError:
            raise
        except Exception as exc:
            raise TransferPolicyError("SAP master-data validation is unavailable; fail closed.") from exc
        return config, []
    incomplete = []
    baseline = TransferPolicyResolver(use_mock=True).resolve(include_persisted=False).config["stages"][stage]
    for field in ("source_position_required", "destination_position_policy", "physical_effect", "quantity_policy", "source_bin_policy"):
        if config[field] != baseline[field]:
            incomplete.append(f"Unsupported Phase 2 execution capability: {field}.")
    if config["destination_bin_policy"] not in {baseline["destination_bin_policy"], "required"}:
        incomplete.append("Unsupported destination_bin_policy.")
    if stage == STAGE_1_TO_INTERMEDIATE and config["destination_bin_policy"] != "unused":
        incomplete.append("Stage 1 does not post destination bin allocations.")
    if stage == STAGE_1_TO_INTERMEDIATE and any(config[field].get(code) for field in ("allowed_source_bins", "allowed_destination_bins") for code in config[field]):
        incomplete.append("Stage 1 does not post bin allocations; configure a warehouse-to-warehouse route only.")
    if stage == STAGE_2_TO_FRIDGE and any(config["allowed_source_bins"].values()):
        incomplete.append("Stage 2 does not post source bin allocations.")
    if not config["route_pairs"]:
        incomplete.append("At least one explicit route is required.")
    warehouses = {}
    try:
        for pair in config["route_pairs"]:
            for code in (pair["from_warehouse"], pair["to_warehouse"]):
                if code not in warehouses:
                    record = sap.get_warehouse_details(code)
                    if not isinstance(record, dict) or record.get("WarehouseCode") != code:
                        raise TransferPolicyError(f"Warehouse {code} does not exist with that exact code.")
                    validate_master_data_boundary(record)
                    if "EnableBinLocations" not in record or "Inactive" not in record:
                        raise TransferPolicyError("SAP warehouse bin metadata is unavailable.")
                    sap_boolean(record, "Inactive")
                    if sap_boolean(record, "EnableBinLocations"):
                        sap_boolean(record, "DefaultBinEnforced")
                    warehouses[code] = record
        if stage == STAGE_2_TO_FRIDGE:
            for pair in config["route_pairs"]:
                binned = sap_boolean(warehouses[pair["to_warehouse"]], "EnableBinLocations")
                expected_type = "fridge" if binned else "intermediate"
                if pair.get("destination_type", expected_type) != expected_type:
                    incomplete.append("Stage 2 destination_type and SAP bin enablement disagree.")
                pair.setdefault("destination_type", expected_type)
            config["source_physical_purpose"] = "none"
            config["destination_physical_purpose"] = "cold_storage" if any(p["destination_type"] == "fridge" for p in config["route_pairs"]) else "none"
        for field, endpoint, purpose in (("allowed_source_bins", "from_warehouse", "source_physical_purpose"), ("allowed_destination_bins", "to_warehouse", "destination_physical_purpose")):
            for code, mappings in config[field].items():
                rows = sap.get_bin_locations_by_warehouse(code)
                if isinstance(rows, dict):
                    if rows.get("error") or not isinstance(rows.get("value"), list):
                        raise TransferPolicyError("SAP bin lookup failed; partial results cannot validate a policy.")
                    rows = rows["value"]
                if not isinstance(rows, list):
                    raise TransferPolicyError("SAP bin metadata is unavailable.")
                for mapping in mappings:
                    row = next((r for r in rows if r.get("BinCode") == mapping["bin_code"]), None)
                    if not row:
                        raise TransferPolicyError(f"Bin {mapping['bin_code']} does not exist.")
                    validate_master_data_boundary(warehouses[code], row, physical=bool(config.get(purpose)))
                    if "Inactive" not in row or "IsSystemBin" not in row:
                        raise TransferPolicyError("SAP bin safety metadata is unavailable.")
                    sap_boolean(row, "Inactive")
                    sap_boolean(row, "IsSystemBin")
                    if not isinstance(row.get("AbsEntry"), int) or isinstance(row["AbsEntry"], bool) or row["AbsEntry"] <= 0:
                        raise TransferPolicyError("SAP bin AbsEntry must be a positive integer.")
                    if mapping.get("abs_entry") is not None and str(mapping["abs_entry"]) != str(row.get("AbsEntry")):
                        raise TransferPolicyError("Configured bin AbsEntry no longer matches SAP.")
                    mapping["abs_entry"] = row["AbsEntry"]
                    if str(row.get("IsSystemBin")).lower() in {"tyes", "true", "1"}:
                        raise TransferPolicyError("System bins cannot be configured as Transfer physical endpoints.")
                    if str(warehouses[code].get("DefaultBinEnforced")).lower() in {"tyes", "true", "1"} and str(warehouses[code].get("DefaultBin")) != str(row["AbsEntry"]):
                        raise TransferPolicyError("Configured bin conflicts with SAP enforced default bin.")
        for pair in config["route_pairs"]:
            for endpoint, field, bin_policy, purpose in (
                ("from_warehouse", "allowed_source_bins", "source_bin_policy", "source_physical_purpose"),
                ("to_warehouse", "allowed_destination_bins", "destination_bin_policy", "destination_physical_purpose"),
            ):
                code = pair[endpoint]
                binned = str(warehouses[code]["EnableBinLocations"]).lower() in {"tyes", "true", "1"}
                required = config[bin_policy] == "required" or (binned and config[bin_policy] != "unused")
                if binned and config[bin_policy] == "unused" and stage == STAGE_3_FROM_FRIDGE:
                    incomplete.append(f"{code}: current stage cannot post bin allocations at this endpoint.")
                transaction_destination = stage == STAGE_2_TO_FRIDGE and endpoint == "to_warehouse" and not legacy_stage2_bins
                if required and not transaction_destination and not config[field].get(code):
                    incomplete.append(f"{code}: verified explicit bins are required; SAP defaults are not substituted.")
                physical = (endpoint == "from_warehouse" and stage == STAGE_3_FROM_FRIDGE) or (endpoint == "to_warehouse" and stage == STAGE_2_TO_FRIDGE and pair.get("destination_type") == "fridge")
                if physical:
                    if config.get(purpose) != "cold_storage":
                        incomplete.append(f"{code}: explicit cold_storage physical purpose is required.")
                    from api.models_cold_storage import ColdStorageBinLayout
                    if transaction_destination and not ColdStorageBinLayout.objects.filter(warehouse_code=code, allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE).exists():
                        incomplete.append(f"{code}: allocatable physical layout is required for transfer-time position selection.")
                    for mapping in config[field].get(code, []):
                        if not ColdStorageBinLayout.objects.filter(warehouse_code=code, bin_code=mapping["bin_code"], sap_bin_abs_entry=mapping["abs_entry"], allocation_type=ColdStorageBinLayout.ALLOC_ALLOCATABLE).exists():
                            incomplete.append(f"{code}/{mapping['bin_code']}: allocatable physical layout is required.")
                if stage == STAGE_2_TO_FRIDGE and endpoint == "to_warehouse":
                    if (pair["destination_type"] == "fridge") != binned:
                        incomplete.append("Stage 2 destination_type and SAP bin enablement disagree.")
        if stage == STAGE_3_FROM_FRIDGE and any(p["to_warehouse"] == "20202" for p in config["route_pairs"]):
            incomplete.append("Shipping Dock arrival is outside Phase 2; Stage 3 to 20202 remains draft.")
    except TransferPolicyError:
        raise
    except Exception as exc:
        raise TransferPolicyError("SAP master-data validation is unavailable; fail closed.") from exc
    if activation and incomplete:
        raise TransferPolicyError(" ".join(dict.fromkeys(incomplete)))
    return config, list(dict.fromkeys(incomplete))


def effective_stage(row, legacy, *, administration=False, legacy_stage2_bins=False):
    result = deepcopy(legacy)
    if administration:
        # Retain supported capability metadata, never legacy operational mappings.
        for key in ("route_pairs", "source_warehouses", "destination_warehouses", "from_warehouses", "to_warehouses", "allowed_source_bins", "allowed_destination_bins"):
            result.pop(key, None)
        result["allowed_source_bins"] = {}
        result["allowed_destination_bins"] = {}
        result["ui"] = {key: value for key, value in result["ui"].items() if key not in {"source", "destination", "destination_by_type", "destination_type_by_warehouse"}}
    result.update(deepcopy(row.configuration))
    if row.stage_key == STAGE_4_TO_DESTINATION:
        result.update(normalize_configuration(row.stage_key, row.configuration))
        sources = [result["intermediate_warehouse"]] if result["intermediate_warehouse"] else []
        destinations = []
    else:
        sources = list(dict.fromkeys(p["from_warehouse"] for p in result["route_pairs"]))
        destinations = list(dict.fromkeys(p["to_warehouse"] for p in result["route_pairs"]))
    result.update(policy_source="persisted_policy", policy_id=row.pk, revision=row.revision,
                  source_warehouses={"allowed": sources}, destination_warehouses={"allowed": destinations},
                  from_warehouses=sources, to_warehouses=destinations)
    result["ui"]["source"] = {"mode": "codes", "codes": sources}
    result["ui"]["destination"] = {"mode": "codes", "codes": destinations}
    if row.stage_key == STAGE_4_TO_DESTINATION:
        # This stage fixes only the policy source; destination is a transaction choice.
        result["route_pairs"] = None
        result["destination_warehouses"] = {"allowed": None}
        result["to_warehouses"] = []
        result["ui"]["destination"] = {"mode": "all", "exclude_source": True}
    if row.stage_key == STAGE_2_TO_FRIDGE:
        if not legacy_stage2_bins:
            result["allowed_destination_bins"] = {}
            result["ui"]["destination_selection_policy"] = "transaction_position"
            result["ui"]["destination_position_required_types"] = ["fridge"]
        result["ui"]["destination_by_type"] = {t: {"mode": "codes", "codes": list(dict.fromkeys(p["to_warehouse"] for p in result["route_pairs"] if p.get("destination_type") == t))} for t in ("intermediate", "fridge")}
        result["ui"]["destination_type_by_warehouse"] = {"codes": result["ui"]["destination_by_type"]["intermediate"]["codes"], "matched": "intermediate", "other": "fridge"}
    return result


def capture_contract(payload, resolver):
    payload = deepcopy(payload)
    payload.pop(SNAPSHOT_KEY, None)
    resolved = resolver.resolve()
    stage = resolved.config["stages"].get(payload.get("transfer_stage"), {})
    if stage.get("policy_source") == "persisted_policy":
        resolved.validate_route(payload)
        row = TransferPolicyRevision.objects.get(pk=stage["policy_id"], company_scope=company_scope())
        validate_configuration(row.stage_key, row.configuration, resolver.sap_client, activation=True)
        payload[SNAPSHOT_KEY] = {
            "policy_version": resolved.config["policy_version"],
            "policy_source": "persisted_policy", "company_scope": resolved.config["company_scope"],
            "stages": {payload["transfer_stage"]: deepcopy(stage)},
            "intermediate_warehouses": [], "fridge_warehouses": [],
        }
    return payload


def resolve_contract(payload, resolver):
    from api.services.transfer_policy_service import ResolvedTransferPolicy
    snapshot = payload.get(SNAPSHOT_KEY)
    if snapshot is None:
        return resolver.resolve(include_persisted=False)
    if not isinstance(snapshot, dict) or snapshot.get("company_scope") != company_scope():
        raise TransferPolicyError("Stored Transfer contract belongs to another SAP company/endpoint.")
    resolved = ResolvedTransferPolicy(deepcopy(snapshot))
    stage = resolved.stage(payload.get("transfer_stage"))
    row = TransferPolicyRevision.objects.filter(pk=stage.get("policy_id"), revision=stage.get("revision"), stage_key=payload.get("transfer_stage"), company_scope=company_scope()).first()
    if row is None:
        raise TransferPolicyError("Stored policy revision is unavailable.")
    legacy_stage2_bins = row.stage_key == STAGE_2_TO_FRIDGE and stage.get("ui", {}).get("destination_selection_policy") != "transaction_position"
    expected = effective_stage(row, TransferPolicyResolver(use_mock=True).resolve(include_persisted=False).config["stages"][row.stage_key], legacy_stage2_bins=legacy_stage2_bins)
    if row.stage_key == STAGE_4_TO_DESTINATION and "intermediate_warehouse" not in stage:
        codes = stage.get("ui", {}).get("source", {}).get("codes", [])
        stage["intermediate_warehouse"] = codes[0] if len(codes) == 1 else ""
    expected_configuration = normalize_configuration(row.stage_key, row.configuration) if row.stage_key == STAGE_4_TO_DESTINATION else row.configuration
    for key in expected_configuration:
        if stage.get(key) != expected.get(key):
            raise TransferPolicyError("Stored movement contract does not match its immutable revision.")
    validate_configuration(row.stage_key, row.configuration, resolver.sap_client, activation=True, legacy_stage2_bins=legacy_stage2_bins)
    return resolved


def create_draft(stage, config, actor, sap):
    config, errors = validate_configuration(stage, config, sap)
    with transaction.atomic():
        revision = (TransferPolicyRevision.objects.filter(company_scope=company_scope(), stage_key=stage).aggregate(n=Max("revision"))["n"] or 0) + 1
        row = TransferPolicyRevision.objects.create(company_scope=company_scope(), stage_key=stage, revision=revision, configuration=config, created_by=actor, updated_by=actor)
    return row, errors


def change_policy(row, actor, sap, *, configuration=None, state=None):
    if row.company_scope != company_scope():
        raise TransferPolicyError("Policy belongs to another SAP company/endpoint.")
    checked = deepcopy(row.configuration)
    errors = []
    if configuration is not None:
        if row.state != row.DRAFT:
            raise TransferPolicyError("Only drafts are editable; create a new revision.")
        checked, errors = validate_configuration(row.stage_key, configuration, sap)
    if state == row.ACTIVE:
        if row.state != row.DRAFT:
            raise TransferPolicyError("Only a draft can be activated.")
        checked, errors = validate_configuration(row.stage_key, checked, sap, activation=True)
    with transaction.atomic():
        locked = TransferPolicyRevision.objects.select_for_update().get(pk=row.pk, company_scope=company_scope())
        if locked.updated_at != row.updated_at or locked.state != row.state:
            raise TransferPolicyError("Policy changed concurrently; reload before editing.")
        if state == row.ACTIVE:
            TransferPolicyRevision.objects.filter(company_scope=company_scope(), stage_key=row.stage_key, state=row.ACTIVE).exclude(pk=row.pk).update(state=row.DISABLED, updated_at=timezone.now(), updated_by=actor)
        locked.configuration = checked
        locked.state = state or locked.state
        locked.updated_by = actor
        locked.save()
    return locked, errors
