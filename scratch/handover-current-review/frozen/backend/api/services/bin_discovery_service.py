"""
Dynamic SAP Cold Storage & Bin Discovery Service.

Discovers SAP Business One Bin Locations dynamically with complete OData pagination,
preserves all sublevel metadata (Sublevel1-4), AbsEntry, BinCode, status flags, and
transforms flat SAP records into a generic, multi-tier hierarchy without hardcoding
warehouses, chambers, racks, or counts.
"""
import logging
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from api.services.cache_service import (
    build_cache_key,
    cache_get,
    cache_set,
    sap_master_namespace,
)

logger = logging.getLogger(__name__)


def _is_truthy(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() in ("true", "1", "yes", "tyes")


class BinDiscoveryService:
    """
    Reusable dynamic service for discovering SAP Bin Locations and
    constructing multi-tier generic hierarchies in memory.
    """

    def __init__(self, sap_client=None):
        self.sap_client = sap_client

    def _get_sap_client(self):
        if self.sap_client is not None:
            return self.sap_client
        from api.views import sap
        return sap

    def discover_bin_locations(
        self, warehouse_code: str, force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Retrieves ALL SAP Bin Locations for a warehouse with complete pagination.
        Uses Django cache with TTL defined by sap_bin_locations (default 600s).
        """
        warehouse_code = str(warehouse_code or "").strip()
        if not warehouse_code:
            return []

        cache_key = build_cache_key(
            sap_master_namespace("bin-locations-raw"), warehouse_code
        )
        if not force_refresh:
            cached = cache_get(cache_key)
            if cached is not None and isinstance(cached, list):
                return cached

        sap_client = self._get_sap_client()
        result = sap_client.get_bin_locations_by_warehouse(warehouse_code)
        if isinstance(result, dict) and result.get("error"):
            logger.error(
                "SAP bin discovery error for %s: %s", warehouse_code, result.get("error")
            )
            raise RuntimeError(f"SAP error: {result.get('error')}")

        if isinstance(result, dict):
            rows = result.get("value", [])
        elif isinstance(result, list):
            rows = result
        else:
            rows = []

        # Cache the complete raw list
        cache_set(
            sap_master_namespace("bin-locations-raw"),
            cache_key,
            rows,
            "sap_bin_locations",
        )
        return rows

    def build_hierarchy(
        self, bin_records: List[Dict[str, Any]], warehouse_code: str = ""
    ) -> Dict[str, Any]:
        """
        Transforms a flat list of SAP Bin Location records into a multi-tier generic hierarchy.

        Preserves SAP generic hierarchy without hardcoded domain labels (fridge/chamber/rack/floor).
        Supports irregular branch depths (e.g. Sublevel1 only, Sublevel1+2, etc.).
        """
        total_bins = len(bin_records)
        active_bins = 0
        inactive_bins = 0
        system_bins = 0
        physical_bins = 0

        # We build a generic nested dict structure using OrderedDict
        # to preserve natural SAP ordering.
        root_nodes: Dict[str, Dict[str, Any]] = OrderedDict()

        for record in bin_records:
            abs_entry = record.get("AbsEntry")
            bin_code = record.get("BinCode") or ""
            desc = record.get("Description") or ""

            # Status flags
            inactive_val = record.get("Inactive")
            is_inactive = _is_truthy(inactive_val)
            if is_inactive:
                inactive_bins += 1
            else:
                active_bins += 1

            is_sys_val = record.get("IsSystemBin")
            if is_sys_val is None:
                is_sys_val = record.get("SystemBin")
            is_system = _is_truthy(is_sys_val) or "SYSTEM" in bin_code.upper()
            if is_system:
                system_bins += 1
            else:
                physical_bins += 1

            bin_item = {
                "bin_code": bin_code,
                "abs_entry": abs_entry,
                "description": desc,
                "inactive": is_inactive,
                "is_system_bin": is_system,
            }

            s1 = record.get("Sublevel1")
            s2 = record.get("Sublevel2")
            s3 = record.get("Sublevel3")
            s4 = record.get("Sublevel4")

            # Clean sublevel strings
            s1_str = str(s1).strip() if s1 is not None and str(s1).strip() else None
            s2_str = str(s2).strip() if s2 is not None and str(s2).strip() else None
            s3_str = str(s3).strip() if s3 is not None and str(s3).strip() else None
            s4_str = str(s4).strip() if s4 is not None and str(s4).strip() else None

            # Sublevel 1
            if not s1_str:
                s1_str = "_UNASSIGNED_"

            if s1_str not in root_nodes:
                root_nodes[s1_str] = {
                    "code": s1_str,
                    "sublevel": 1,
                    "children": OrderedDict(),
                    "bins": [],
                }
            curr_node = root_nodes[s1_str]

            # If there is no Sublevel 2, attach bin at Sublevel 1
            if not s2_str:
                curr_node["bins"].append(bin_item)
                continue

            # Sublevel 2
            if s2_str not in curr_node["children"]:
                curr_node["children"][s2_str] = {
                    "code": s2_str,
                    "sublevel": 2,
                    "children": OrderedDict(),
                    "bins": [],
                }
            curr_node = curr_node["children"][s2_str]

            # If there is no Sublevel 3, attach bin at Sublevel 2
            if not s3_str:
                curr_node["bins"].append(bin_item)
                continue

            # Sublevel 3
            if s3_str not in curr_node["children"]:
                curr_node["children"][s3_str] = {
                    "code": s3_str,
                    "sublevel": 3,
                    "children": OrderedDict(),
                    "bins": [],
                }
            curr_node = curr_node["children"][s3_str]

            # If there is no Sublevel 4, attach bin at Sublevel 3
            if not s4_str:
                curr_node["bins"].append(bin_item)
                continue

            # Sublevel 4
            if s4_str not in curr_node["children"]:
                curr_node["children"][s4_str] = {
                    "code": s4_str,
                    "sublevel": 4,
                    "children": OrderedDict(),
                    "bins": [],
                }
            curr_node = curr_node["children"][s4_str]
            curr_node["bins"].append(bin_item)

        # Recursively convert OrderedDict children to lists
        def _serialize_node(node: Dict[str, Any]) -> Dict[str, Any]:
            children_dict = node.get("children", {})
            serialized_children = [
                _serialize_node(child) for child in children_dict.values()
            ]
            return {
                "code": node["code"],
                "sublevel": node["sublevel"],
                "children": serialized_children,
                "bins": node["bins"],
            }

        hierarchy_list = [_serialize_node(r) for r in root_nodes.values()]

        return {
            "warehouse_code": warehouse_code,
            "total_bins": total_bins,
            "active_bins": active_bins,
            "inactive_bins": inactive_bins,
            "system_bins": system_bins,
            "physical_bins": physical_bins,
            "hierarchy": hierarchy_list,
        }

    def get_warehouse_hierarchy(
        self, warehouse_code: str, force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Discovers bins and builds the cached hierarchy for the given warehouse.
        """
        warehouse_code = str(warehouse_code or "").strip()
        cache_key = build_cache_key(
            sap_master_namespace("cold-storage-hierarchy"), warehouse_code
        )

        if not force_refresh:
            cached = cache_get(cache_key)
            if cached is not None and isinstance(cached, dict):
                return cached

        raw_bins = self.discover_bin_locations(warehouse_code, force_refresh=force_refresh)
        hierarchy = self.build_hierarchy(raw_bins, warehouse_code=warehouse_code)

        cache_set(
            sap_master_namespace("cold-storage-hierarchy"),
            cache_key,
            hierarchy,
            "sap_bin_locations",
        )
        return hierarchy


def get_bin_discovery_service(sap_client=None) -> BinDiscoveryService:
    return BinDiscoveryService(sap_client=sap_client)
