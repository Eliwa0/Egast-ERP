"""
Cold Storage Physical Layout & Pallet Position Service.

Coordinates between dynamic SAP Bin discovery and the physical position layer.
Ensures every physical position is strictly tied to a real SAP Bin (warehouse, bin_code, abs_entry).
Provides concurrency-safe reservation and release mechanisms.
"""
import logging
from typing import Any, Dict, List, Optional
from django.db import transaction
from django.utils import timezone

from api.models import PendingReceiptBatch
from api.models_cold_storage import ColdStorageBinLayout, ColdStoragePalletPosition
from api.services.bin_discovery_service import get_bin_discovery_service

logger = logging.getLogger(__name__)


# Warehouse-specific physical capacity configuration registry.
# Explicitly scoped per warehouse - NOT global constants.
# Warehouses not in this registry will discover all SAP Bins, but their physical capacity
# will be flagged as CAPACITY_SOURCE_UNCONFIGURED until explicitly defined.
WAREHOUSE_CAPACITY_PROFILES = {
    "20201": {
        # Profile for 20201 (موالح A - ثلاجة ايجاست 2)
        "channel_capacities": {
            # Drive-in rack channels in Chambers 1..3 have physical depth 17
            "R01": 17,
            "R02": 17,
            "R03": 17,
            # Drive-in rack channels in Chambers 6..10 have physical depth 12
            "R06": 12,
            "R07": 12,
            "R08": 12,
            "R09": 12,
            "R10": 12,
        },
        # General un-subdivided chambers in 20201 have 1 bulk SAP location
        "bulk_capacity": 1,
        "corridor_capacity": 1,
    }
}


class ColdStorageLayoutService:
    """
    Service managing physical pallet-position layouts, capacity configuration,
    and concurrency-safe position reservations.
    """

    def __init__(self, bin_discovery_service=None):
        self.discovery_service = bin_discovery_service or get_bin_discovery_service()

    @staticmethod
    def classify_sap_bin(record: Dict[str, Any]) -> str:
        """
        Classifies a raw SAP Bin Location record into exactly one category:
        - SYSTEM: System virtual bin location
        - PHYSICAL_CHANNEL: Multi-depth drive-in rack channel (has both sublevel 3 and sublevel 4)
        - BULK_OR_GENERAL: Bulk floor or general section bin (neither sublevel 3 nor sublevel 4)
        - CORRIDOR_OR_AISLE: Transit aisle or corridor bin (has sublevel 3 indicating aisle/corridor, no sublevel 4)
        - OTHER: Any bin not matching the above
        """
        bin_code = str(record.get("BinCode") or "").strip()
        is_sys_val = record.get("IsSystemBin")
        if is_sys_val is None:
            is_sys_val = record.get("SystemBin")

        from api.services.bin_discovery_service import _is_truthy
        is_system = (
            _is_truthy(is_sys_val)
            or "SYSTEM" in bin_code.upper()
            or "SYSTEM" in str(record.get("Sublevel1") or "").upper()
        )
        if is_system:
            return ColdStorageBinLayout.CLASS_SYSTEM

        s1 = record.get("Sublevel1")
        s2 = record.get("Sublevel2")
        s3 = record.get("Sublevel3")
        s4 = record.get("Sublevel4")

        # Fallback: if sublevels are not present in record, parse from bin_code if segmented
        if not s1 and not s2 and not s3 and not s4 and "-" in bin_code:
            parts = bin_code.split("-")
            if len(parts) >= 2:
                s1 = parts[1]
            if len(parts) >= 3:
                s2 = parts[2]
            if len(parts) >= 4:
                s3 = parts[3]
            if len(parts) >= 5:
                s4 = parts[4]

        has_s3 = bool(str(s3 or "").strip() and str(s3) != "None")
        has_s4 = bool(str(s4 or "").strip() and str(s4) != "None")
        desc = str(record.get("Description") or "")

        s3_val = str(s3 or "").strip().upper()
        if has_s3 and not has_s4:
            if s3_val.startswith("B") or "AISLE" in s3_val or "CORRIDOR" in s3_val or "طرق" in desc:
                return ColdStorageBinLayout.CLASS_CORRIDOR_OR_AISLE
            return ColdStorageBinLayout.CLASS_OTHER

        if not has_s3 and not has_s4:
            return ColdStorageBinLayout.CLASS_BULK_OR_GENERAL

        if has_s3 and has_s4:
            return ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL

        return ColdStorageBinLayout.CLASS_OTHER

    def determine_channel_and_capacity(
        self,
        warehouse_code: str,
        bin_code: str,
        classification: str,
        sublevel1: Optional[str] = None,
        sublevel2: Optional[str] = None,
        sublevel3: Optional[str] = None,
        sublevel4: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Determines the channel type, capacity, capacity source, and allocation type without global assumptions.
        Uses scoped warehouse configuration profiles where available.
        For unconfigured channels/warehouses, sets capacity_source = UNCONFIGURED, allocation_type = UNCONFIGURED.
        """
        warehouse_code = str(warehouse_code or "").strip()
        if not sublevel2 and "-" in bin_code:
            parts = bin_code.split("-")
            if len(parts) >= 3:
                sublevel2 = parts[2]

        # 1. System bins
        if classification == ColdStorageBinLayout.CLASS_SYSTEM:
            return {
                "channel_type": ColdStorageBinLayout.CHANNEL_BULK,
                "capacity": 1,
                "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_SYSTEM,
                "allocation_type": ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE,
            }

        # 2. Corridor bins (e.g. B01)
        if classification == ColdStorageBinLayout.CLASS_CORRIDOR_OR_AISLE:
            return {
                "channel_type": ColdStorageBinLayout.CHANNEL_CORRIDOR,
                "capacity": 1,
                "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_DEFAULT,
                "allocation_type": ColdStorageBinLayout.ALLOC_STAGING_ONLY,
            }

        # 3. Bulk / General Area bins (e.g. R04, R05, F02-R01..R04, RP1)
        if classification == ColdStorageBinLayout.CLASS_BULK_OR_GENERAL:
            return {
                "channel_type": ColdStorageBinLayout.CHANNEL_BULK,
                "capacity": 1,
                "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_DEFAULT,
                "allocation_type": ColdStorageBinLayout.ALLOC_UNCONFIGURED,
            }

        # 4. Physical Multi-Depth Channels
        if classification == ColdStorageBinLayout.CLASS_PHYSICAL_CHANNEL:
            profile = WAREHOUSE_CAPACITY_PROFILES.get(warehouse_code)
            if profile:
                s2 = str(sublevel2 or "").strip().upper()
                known_cap = profile.get("channel_capacities", {}).get(s2)
                if known_cap:
                    return {
                        "channel_type": ColdStorageBinLayout.CHANNEL_STANDARD,
                        "capacity": known_cap,
                        "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED,
                        "allocation_type": ColdStorageBinLayout.ALLOC_ALLOCATABLE,
                    }

            # Unconfigured warehouse or unconfigured chamber channel:
            # DO NOT guess 17 or 12! Mark explicitly as UNCONFIGURED.
            return {
                "channel_type": ColdStorageBinLayout.CHANNEL_STANDARD,
                "capacity": 1,
                "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_UNCONFIGURED,
                "allocation_type": ColdStorageBinLayout.ALLOC_UNCONFIGURED,
            }

        # 5. Other / Unclassified
        return {
            "channel_type": ColdStorageBinLayout.CHANNEL_STANDARD,
            "capacity": 1,
            "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_UNCONFIGURED,
            "allocation_type": ColdStorageBinLayout.ALLOC_UNCONFIGURED,
        }

    def determine_default_channel_and_capacity(
        self,
        bin_code: str,
        sublevel1: Optional[str] = None,
        sublevel2: Optional[str] = None,
        sublevel3: Optional[str] = None,
        sublevel4: Optional[str] = None,
        is_system_bin: bool = False,
        warehouse_code: str = "",
    ) -> Dict[str, Any]:
        """
        Backward-compatible helper delegating to classify_sap_bin and determine_channel_and_capacity.
        """
        record = {
            "BinCode": bin_code,
            "Sublevel1": sublevel1,
            "Sublevel2": sublevel2,
            "Sublevel3": sublevel3,
            "Sublevel4": sublevel4,
            "IsSystemBin": is_system_bin,
        }
        classification = self.classify_sap_bin(record)
        return self.determine_channel_and_capacity(
            warehouse_code=warehouse_code,
            bin_code=bin_code,
            classification=classification,
            sublevel1=sublevel1,
            sublevel2=sublevel2,
            sublevel3=sublevel3,
            sublevel4=sublevel4,
        )

    def get_or_create_bin_layout(
        self,
        warehouse_code: str,
        bin_code: str,
        sap_bin_abs_entry: int,
        sublevel1: str = "",
        sublevel2: str = "",
        sublevel3: str = "",
        sublevel4: str = "",
        capacity: Optional[int] = None,
        capacity_source: Optional[str] = None,
        allocation_type: Optional[str] = None,
        channel_type: Optional[str] = None,
        sap_bin_classification: Optional[str] = None,
        is_system_bin: bool = False,
    ) -> ColdStorageBinLayout:
        """
        Retrieves or initializes a ColdStorageBinLayout and its pallet positions.
        Strict invariant: sap_bin_abs_entry must be a positive integer.
        """
        if not sap_bin_abs_entry or int(sap_bin_abs_entry) <= 0:
            raise ValueError(f"Invalid SAP Bin AbsEntry: {sap_bin_abs_entry}")

        layout = ColdStorageBinLayout.objects.filter(sap_bin_abs_entry=sap_bin_abs_entry).first()
        if layout:
            needs_save = False
            if sap_bin_classification and layout.sap_bin_classification != sap_bin_classification:
                layout.sap_bin_classification = sap_bin_classification
                needs_save = True
            if allocation_type and layout.allocation_type != allocation_type:
                layout.allocation_type = allocation_type
                needs_save = True
            if capacity is not None and layout.capacity != capacity:
                layout.capacity = capacity
                layout.capacity_source = capacity_source or ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED
                if channel_type:
                    layout.channel_type = channel_type
                needs_save = True
            elif capacity_source and layout.capacity_source != capacity_source:
                layout.capacity_source = capacity_source
                needs_save = True
            if needs_save:
                layout.save()
            return layout

        record = {
            "BinCode": bin_code,
            "Sublevel1": sublevel1,
            "Sublevel2": sublevel2,
            "Sublevel3": sublevel3,
            "Sublevel4": sublevel4,
            "IsSystemBin": is_system_bin,
        }
        classification = sap_bin_classification or self.classify_sap_bin(record)
        defaults = self.determine_channel_and_capacity(
            warehouse_code=warehouse_code,
            bin_code=bin_code,
            classification=classification,
            sublevel1=sublevel1,
            sublevel2=sublevel2,
            sublevel3=sublevel3,
            sublevel4=sublevel4,
        )

        final_capacity = capacity if capacity is not None else defaults["capacity"]
        final_source = (
            capacity_source
            if capacity_source is not None
            else (ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED if capacity is not None else defaults["capacity_source"])
        )
        final_alloc = allocation_type or defaults["allocation_type"]
        final_channel_type = channel_type or defaults["channel_type"]

        layout = ColdStorageBinLayout.objects.create(
            warehouse_code=warehouse_code,
            bin_code=bin_code,
            sap_bin_abs_entry=sap_bin_abs_entry,
            sublevel1=sublevel1 or "",
            sublevel2=sublevel2 or "",
            sublevel3=sublevel3 or "",
            sublevel4=sublevel4 or "",
            sap_bin_classification=classification,
            allocation_type=final_alloc,
            channel_type=final_channel_type,
            capacity=final_capacity,
            capacity_source=final_source,
        )
        return layout

    def ensure_warehouse_layouts(self, warehouse_code: str) -> Dict[int, ColdStorageBinLayout]:
        """
        Discovers raw bins for warehouse and ensures ColdStorageBinLayout exists
        for all discovered bins. Preserves existing positions and reservations.
        """
        warehouse_code = str(warehouse_code or "").strip()
        raw_bins = self.discovery_service.discover_bin_locations(warehouse_code)
        existing = {
            l.sap_bin_abs_entry: l
            for l in ColdStorageBinLayout.objects.filter(warehouse_code=warehouse_code)
        }

        created_or_found = dict(existing)
        new_layouts = []

        for r in raw_bins:
            abs_entry = r.get("AbsEntry")
            if not abs_entry:
                continue

            bin_code = r.get("BinCode") or ""
            classification = self.classify_sap_bin(r)
            s1 = str(r.get("Sublevel1") or "").strip()
            s2 = str(r.get("Sublevel2") or "").strip()
            s3 = str(r.get("Sublevel3") or "").strip()
            s4 = str(r.get("Sublevel4") or "").strip()

            defaults = self.determine_channel_and_capacity(
                warehouse_code=warehouse_code,
                bin_code=bin_code,
                classification=classification,
                sublevel1=s1,
                sublevel2=s2,
                sublevel3=s3,
                sublevel4=s4,
            )

            if abs_entry in created_or_found:
                existing_layout = created_or_found[abs_entry]
                needs_save = False
                if not existing_layout.sublevel1 and s1:
                    existing_layout.sublevel1 = s1
                    needs_save = True
                if not existing_layout.sublevel2 and s2:
                    existing_layout.sublevel2 = s2
                    needs_save = True
                if not existing_layout.sublevel3 and s3:
                    existing_layout.sublevel3 = s3
                    needs_save = True
                if not existing_layout.sublevel4 and s4:
                    existing_layout.sublevel4 = s4
                    needs_save = True
                if existing_layout.sap_bin_classification != classification:
                    existing_layout.sap_bin_classification = classification
                    needs_save = True
                if existing_layout.allocation_type != defaults["allocation_type"]:
                    existing_layout.allocation_type = defaults["allocation_type"]
                    needs_save = True
                if existing_layout.capacity_source != defaults["capacity_source"]:
                    if existing_layout.capacity == defaults["capacity"]:
                        existing_layout.capacity_source = defaults["capacity_source"]
                        needs_save = True
                if needs_save:
                    existing_layout.save()
                continue

            layout = ColdStorageBinLayout(
                warehouse_code=warehouse_code,
                bin_code=bin_code,
                sap_bin_abs_entry=abs_entry,
                sublevel1=s1,
                sublevel2=s2,
                sublevel3=s3,
                sublevel4=s4,
                sap_bin_classification=classification,
                allocation_type=defaults["allocation_type"],
                channel_type=defaults["channel_type"],
                capacity=defaults["capacity"],
                capacity_source=defaults["capacity_source"],
            )
            layout.clean()
            new_layouts.append(layout)

        if new_layouts:
            with transaction.atomic():
                for l in new_layouts:
                    l.save()
                    created_or_found[l.sap_bin_abs_entry] = l

        return created_or_found

    @staticmethod
    def _get_batch_size_map(positions) -> Dict[str, str]:
        """Return the latest recorded U_Size value for each occupied batch."""
        batch_numbers = {
            str(pos.current_batch_number or "").strip()
            for pos in positions
            if str(pos.current_batch_number or "").strip()
        }
        if not batch_numbers:
            return {}

        sizes: Dict[str, str] = {}
        rows = (
            PendingReceiptBatch.objects
            .filter(batch_number__in=batch_numbers)
            .exclude(size="")
            .order_by("batch_number", "-updated_at", "-id")
            .values_list("batch_number", "size")
        )
        for batch_number, size in rows:
            sizes.setdefault(str(batch_number).strip(), str(size).strip())
        return sizes

    def serialize_position(
        self,
        pos: ColdStoragePalletPosition,
        batch_sizes: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        batch_number = str(pos.current_batch_number or "").strip()
        return {
            "id": pos.id,
            "position_index": pos.position_index,
            "position_code": pos.position_code,
            "status": pos.status,
            "reserved_by": pos.reserved_by.username if pos.reserved_by else None,
            "reserved_at": pos.reserved_at.isoformat() if pos.reserved_at else None,
            "reservation_reference": pos.reservation_reference,
            "transfer_reference": pos.transfer_reference,
            "current_batch_number": pos.current_batch_number,
            "current_batch_size": (batch_sizes or {}).get(batch_number, ""),
            "notes": pos.notes,
        }

    def get_bin_positions(self, sap_bin_abs_entry: int) -> Dict[str, Any]:
        """
        Returns physical positions and occupancy state for a specific SAP Bin AbsEntry.
        """
        abs_entry = int(sap_bin_abs_entry)
        layout = ColdStorageBinLayout.objects.filter(sap_bin_abs_entry=abs_entry).first()

        if not layout:
            # Attempt to find bin in raw discovery
            # Scan all warehouses or fallback
            raise ValueError(f"No physical layout configured for SAP Bin AbsEntry {abs_entry}")

        positions = list(layout.positions.all().order_by("position_index"))
        batch_sizes = self._get_batch_size_map(positions)
        serialized_positions = [
            self.serialize_position(p, batch_sizes=batch_sizes) for p in positions
        ]

        counts = {
            "total": layout.capacity,
            "available": 0,
            "reserved": 0,
            "occupied": 0,
            "reserved_outbound": 0,
            "maintenance": 0,
        }
        for p in serialized_positions:
            st = p["status"].lower()
            if st in counts:
                counts[st] += 1

        return {
            "warehouse_code": layout.warehouse_code,
            "bin_code": layout.bin_code,
            "sap_bin_abs_entry": layout.sap_bin_abs_entry,
            "sap_bin_classification": layout.sap_bin_classification,
            "allocation_type": layout.allocation_type,
            "is_allocatable": layout.is_allocatable,
            "is_staging_only": layout.is_staging_only,
            "is_unconfigured": layout.is_unconfigured,
            "channel_type": layout.channel_type,
            "capacity": layout.capacity,
            "capacity_source": layout.capacity_source,
            "is_capacity_configured": layout.capacity_source in (
                ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED,
                ColdStorageBinLayout.CAPACITY_SOURCE_DEFAULT,
            ),
            "sublevel1": layout.sublevel1,
            "sublevel2": layout.sublevel2,
            "sublevel3": layout.sublevel3,
            "sublevel4": layout.sublevel4,
            "occupancy": counts,
            "positions": serialized_positions,
        }

    def get_warehouse_layout(
        self, warehouse_code: str, force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Discovers SAP hierarchy for warehouse and enriches every bin node
        with its physical capacity, pallet positions, and live occupancy status.
        """
        warehouse_code = str(warehouse_code or "").strip()
        # Ensure database layouts exist
        layouts_map = self.ensure_warehouse_layouts(warehouse_code)

        # Prefetch positions for this warehouse
        all_positions = list(ColdStoragePalletPosition.objects.filter(
            warehouse_code=warehouse_code
        ).select_related("reserved_by").order_by("position_index"))
        batch_sizes = self._get_batch_size_map(all_positions)

        positions_by_abs: Dict[int, List[Dict[str, Any]]] = {}
        for p in all_positions:
            if p.sap_bin_abs_entry not in positions_by_abs:
                positions_by_abs[p.sap_bin_abs_entry] = []
            positions_by_abs[p.sap_bin_abs_entry].append(
                self.serialize_position(p, batch_sizes=batch_sizes)
            )

        # Get base hierarchy
        hierarchy_data = self.discovery_service.get_warehouse_hierarchy(
            warehouse_code, force_refresh=force_refresh
        )

        total_warehouse_capacity = 0
        warehouse_occupancy = {
            "total": 0,
            "available": 0,
            "reserved": 0,
            "occupied": 0,
            "reserved_outbound": 0,
            "maintenance": 0,
        }

        # Recursively enrich bin items in hierarchy
        def _enrich_node(node: Dict[str, Any]):
            nonlocal total_warehouse_capacity
            # Enrich bins attached to this node
            enriched_bins = []
            for b in node.get("bins", []):
                abs_entry = b.get("abs_entry")
                layout = layouts_map.get(abs_entry)
                positions = positions_by_abs.get(abs_entry, [])

                cap = layout.capacity if layout else len(positions) or 1
                channel_type = layout.channel_type if layout else ColdStorageBinLayout.CHANNEL_STANDARD
                classification = layout.sap_bin_classification if layout else ColdStorageBinLayout.CLASS_OTHER
                source = layout.capacity_source if layout else ColdStorageBinLayout.CAPACITY_SOURCE_UNCONFIGURED
                alloc_type = layout.allocation_type if layout else ColdStorageBinLayout.ALLOC_UNCONFIGURED
                is_allocatable = layout.is_allocatable if layout else False
                is_staging_only = layout.is_staging_only if layout else False
                is_unconfigured = layout.is_unconfigured if layout else False

                bin_occ = {
                    "total": cap,
                    "available": 0,
                    "reserved": 0,
                    "occupied": 0,
                    "reserved_outbound": 0,
                    "maintenance": 0,
                }
                for p in positions:
                    st = p["status"].lower()
                    if st in bin_occ:
                        bin_occ[st] += 1
                        if not b.get("is_system_bin"):
                            warehouse_occupancy[st] += 1

                if not b.get("is_system_bin"):
                    total_warehouse_capacity += cap
                    warehouse_occupancy["total"] += cap

                enriched_bin = {
                    **b,
                    "sap_bin_classification": classification,
                    "allocation_type": alloc_type,
                    "is_allocatable": is_allocatable,
                    "is_staging_only": is_staging_only,
                    "is_unconfigured": is_unconfigured,
                    "capacity": cap,
                    "capacity_source": source,
                    "is_capacity_configured": source in (
                        ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED,
                        ColdStorageBinLayout.CAPACITY_SOURCE_DEFAULT,
                    ),
                    "channel_type": channel_type,
                    "occupancy": bin_occ,
                    "positions": positions,
                }
                enriched_bins.append(enriched_bin)

            node["bins"] = enriched_bins

            # Recursively enrich children
            for child in node.get("children", []):
                _enrich_node(child)

        for root in hierarchy_data.get("hierarchy", []):
            _enrich_node(root)

        return {
            "warehouse_code": warehouse_code,
            "total_bins": hierarchy_data.get("total_bins", 0),
            "physical_bins": hierarchy_data.get("physical_bins", 0),
            "system_bins": hierarchy_data.get("system_bins", 0),
            "total_capacity": total_warehouse_capacity,
            "occupancy": warehouse_occupancy,
            "hierarchy": hierarchy_data.get("hierarchy", []),
        }

    def reserve_position(
        self,
        position_id: int,
        user=None,
        reference: str = "",
        transfer_reference: str = "",
    ) -> Dict[str, Any]:
        """
        Concurrency-safe atomic reservation of a physical position.
        """
        pos = ColdStoragePalletPosition.reserve_position(
            position_id=position_id,
            user=user,
            reference=reference,
            transfer_reference=transfer_reference,
        )
        return self.serialize_position(pos)

    def release_position(self, position_id: int, user=None) -> Dict[str, Any]:
        """
        Concurrency-safe release of a reservation.
        """
        pos = ColdStoragePalletPosition.release_position(
            position_id=position_id,
            user=user,
        )
        return self.serialize_position(pos)

    def occupy_position(
        self,
        position_id: int,
        user=None,
        batch_number: str = "",
        reference: str = "",
        transfer_reference: str = "",
    ) -> Dict[str, Any]:
        """
        Concurrency-safe occupation of a physical position.
        """
        pos = ColdStoragePalletPosition.occupy_position(
            position_id=position_id,
            user=user,
            batch_number=batch_number,
            reference=reference,
            transfer_reference=transfer_reference,
        )
        return self.serialize_position(pos)

    def vacate_position(self, position_id: int, user=None) -> Dict[str, Any]:
        """
        Concurrency-safe vacating of an occupied position back to AVAILABLE.
        """
        pos = ColdStoragePalletPosition.vacate_position(
            position_id=position_id,
            user=user,
        )
        return self.serialize_position(pos)

    def reserve_position_for_outbound(
        self,
        position_id: int,
        user=None,
        reference: str = "",
        transfer_reference: str = "",
    ) -> Dict[str, Any]:
        """
        Concurrency-safe atomic outbound reservation of an OCCUPIED position.
        Transitions OCCUPIED -> RESERVED_OUTBOUND.
        Preserves current batch number and existing transfer reference.
        """
        pos = ColdStoragePalletPosition.reserve_position_for_outbound(
            position_id=position_id,
            user=user,
            reference=reference,
            transfer_reference=transfer_reference,
        )
        return self.serialize_position(pos)

    def release_outbound_reservation(
        self,
        position_id: int,
        user=None,
    ) -> Dict[str, Any]:
        """
        Concurrency-safe release of an outbound reservation back to OCCUPIED.
        Only RESERVED_OUTBOUND can be released.
        Preserves current batch number and occupancy data.
        """
        pos = ColdStoragePalletPosition.release_outbound_reservation(
            position_id=position_id,
            user=user,
        )
        return self.serialize_position(pos)

    def vacate_outbound_position(
        self,
        position_id: int,
        user=None,
    ) -> Dict[str, Any]:
        """
        Concurrency-safe transition of a RESERVED_OUTBOUND position to AVAILABLE after confirmed SAP success.
        """
        pos = ColdStoragePalletPosition.vacate_outbound_position(
            position_id=position_id,
            user=user,
        )
        return self.serialize_position(pos)

    def set_position_maintenance(
        self, position_id: int, user=None, notes: str = ""
    ) -> Dict[str, Any]:
        """
        Places a physical position into MAINTENANCE / Blocked state.
        """
        pos = ColdStoragePalletPosition.set_maintenance(
            position_id=position_id,
            user=user,
            notes=notes,
        )
        return self.serialize_position(pos)

    def restore_position_maintenance(
        self, position_id: int, user=None
    ) -> Dict[str, Any]:
        """
        Restores a physical position from MAINTENANCE to AVAILABLE.
        """
        pos = ColdStoragePalletPosition.restore_from_maintenance(
            position_id=position_id,
            user=user,
        )
        return self.serialize_position(pos)

    def configure_bin(
        self,
        sap_bin_abs_entry: int,
        capacity: Optional[int] = None,
        allocation_type: Optional[str] = None,
        channel_type: Optional[str] = None,
        notes: str = "",
    ) -> ColdStorageBinLayout:
        """
        Explicitly configures capacity and/or allocation type for a specific SAP Bin Location.
        """
        layout = ColdStorageBinLayout.objects.filter(sap_bin_abs_entry=sap_bin_abs_entry).first()
        if not layout:
            raise ValueError(f"SAP Bin AbsEntry {sap_bin_abs_entry} not found in database.")

        if allocation_type is not None:
            valid_allocs = [
                ColdStorageBinLayout.ALLOC_ALLOCATABLE,
                ColdStorageBinLayout.ALLOC_STAGING_ONLY,
                ColdStorageBinLayout.ALLOC_NON_ALLOCATABLE,
                ColdStorageBinLayout.ALLOC_UNCONFIGURED,
            ]
            if allocation_type not in valid_allocs:
                raise ValueError(
                    f"Invalid allocation_type '{allocation_type}'. Must be one of: {valid_allocs}"
                )
            layout.allocation_type = allocation_type

        if capacity is not None:
            if int(capacity) <= 0:
                raise ValueError("Capacity must be a positive integer.")
            layout.capacity = int(capacity)
            layout.capacity_source = ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED

        if channel_type:
            layout.channel_type = channel_type

        if notes:
            layout.notes = notes

        layout.save()
        return layout

    def configure_bin_capacity(
        self,
        warehouse_code: str,
        bin_code: str,
        sap_bin_abs_entry: int,
        capacity: int,
        channel_type: Optional[str] = None,
        notes: str = "",
    ) -> ColdStorageBinLayout:
        """
        Explicitly configures capacity for a specific SAP Bin Location.
        """
        layout, _ = ColdStorageBinLayout.objects.get_or_create(
            sap_bin_abs_entry=sap_bin_abs_entry,
            defaults={
                "warehouse_code": warehouse_code,
                "bin_code": bin_code,
                "capacity": capacity,
                "capacity_source": ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED,
                "channel_type": channel_type or ColdStorageBinLayout.CHANNEL_STANDARD,
                "notes": notes,
            },
        )
        layout.capacity = capacity
        layout.capacity_source = ColdStorageBinLayout.CAPACITY_SOURCE_CONFIGURED
        if channel_type:
            layout.channel_type = channel_type
        if notes:
            layout.notes = notes
        layout.save()
        return layout

    def resolve_bin_layout(
        self,
        warehouse_code: str,
        sap_bin_abs_entry: Optional[int] = None,
        bin_code: Optional[str] = None,
        sublevel1: Optional[str] = None,
        sublevel2: Optional[str] = None,
        sublevel3: Optional[str] = None,
        sublevel4: Optional[str] = None,
    ) -> ColdStorageBinLayout:
        """
        Resolves a ColdStorageBinLayout by AbsEntry, bin_code, or hierarchical sublevels.
        Ensures layout existence if not yet synced.
        """
        warehouse_code = str(warehouse_code or "").strip()
        layout = None

        if sap_bin_abs_entry:
            layout = ColdStorageBinLayout.objects.filter(sap_bin_abs_entry=sap_bin_abs_entry).first()

        if not layout and bin_code:
            layout = ColdStorageBinLayout.objects.filter(
                warehouse_code=warehouse_code, bin_code=bin_code.strip()
            ).first()

        if not layout and sublevel2 and sublevel3 and sublevel4:
            qs = ColdStorageBinLayout.objects.filter(
                warehouse_code=warehouse_code,
                sublevel2=str(sublevel2).strip(),
                sublevel3=str(sublevel3).strip(),
                sublevel4=str(sublevel4).strip(),
            )
            if sublevel1:
                qs = qs.filter(sublevel1=str(sublevel1).strip())
            layout = qs.first()

        if not layout and warehouse_code:
            # Sync layouts from discovery service and retry
            self.ensure_warehouse_layouts(warehouse_code)
            if sap_bin_abs_entry:
                layout = ColdStorageBinLayout.objects.filter(sap_bin_abs_entry=sap_bin_abs_entry).first()
            elif bin_code:
                layout = ColdStorageBinLayout.objects.filter(
                    warehouse_code=warehouse_code, bin_code=bin_code.strip()
                ).first()
            elif sublevel2 and sublevel3 and sublevel4:
                qs = ColdStorageBinLayout.objects.filter(
                    warehouse_code=warehouse_code,
                    sublevel2=str(sublevel2).strip(),
                    sublevel3=str(sublevel3).strip(),
                    sublevel4=str(sublevel4).strip(),
                )
                if sublevel1:
                    qs = qs.filter(sublevel1=str(sublevel1).strip())
                layout = qs.first()

        if not layout:
            identifier = (
                f"AbsEntry #{sap_bin_abs_entry}" if sap_bin_abs_entry
                else (bin_code or f"{warehouse_code}-{sublevel1}-{sublevel2}-{sublevel3}-{sublevel4}")
            )
            raise ValueError(f"Cold storage bin layout '{identifier}' was not found in warehouse '{warehouse_code}'.")

        return layout

    def preview_sequential_allocation(
        self,
        warehouse_code: str,
        sap_bin_abs_entry: Optional[int] = None,
        bin_code: Optional[str] = None,
        sublevel1: Optional[str] = None,
        sublevel2: Optional[str] = None,
        sublevel3: Optional[str] = None,
        sublevel4: Optional[str] = None,
        pallet_count: int = 1,
        batches: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        """
        Determines sequential pallet slot placement within the chosen Rack + Level without committing.
        Returns total capacity, available count, required count, shortage, and planned allocations in
        strict position_index ASC order.
        """
        layout = self.resolve_bin_layout(
            warehouse_code=warehouse_code,
            sap_bin_abs_entry=sap_bin_abs_entry,
            bin_code=bin_code,
            sublevel1=sublevel1,
            sublevel2=sublevel2,
            sublevel3=sublevel3,
            sublevel4=sublevel4,
        )

        if layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
            raise ValueError(
                f"Location {layout.bin_code} is {layout.allocation_type} and cannot be allocated for pallet placement."
            )

        # Deterministic sorting: strictly position_index ASC, position_code ASC
        positions = list(
            layout.positions.all().order_by("position_index", "position_code")
        )
        available_positions = [
            p for p in positions if p.status == ColdStoragePalletPosition.AVAILABLE
        ]

        normalized_batches = []
        if batches:
            for b in batches:
                b_num = b.get("batch_number", "") if isinstance(b, dict) else str(b or "").strip()
                normalized_batches.append(b_num)

        required_count = max(int(pallet_count or 1), len(normalized_batches))
        if required_count <= 0:
            raise ValueError("Pallet count must be greater than zero.")

        available_count = len(available_positions)
        shortage = max(0, required_count - available_count)
        can_fully_allocate = available_count >= required_count

        planned_count = min(required_count, available_count)
        planned_allocations = []
        for i in range(planned_count):
            pos = available_positions[i]
            batch_assigned = normalized_batches[i] if i < len(normalized_batches) else ""
            planned_allocations.append({
                "pallet_seq": i + 1,
                "position_id": pos.id,
                "position_index": pos.position_index,
                "position_code": pos.position_code,
                "bin_code": pos.bin_code,
                "sap_bin_abs_entry": pos.sap_bin_abs_entry,
                "batch_number": batch_assigned,
            })

        return {
            "warehouse_code": layout.warehouse_code,
            "bin_code": layout.bin_code,
            "sap_bin_abs_entry": layout.sap_bin_abs_entry,
            "sublevel1": layout.sublevel1,
            "sublevel2": layout.sublevel2,
            "sublevel3": layout.sublevel3,
            "sublevel4": layout.sublevel4,
            "capacity": layout.capacity,
            "total_positions": len(positions),
            "available_count": available_count,
            "occupied_count": len([p for p in positions if p.status == ColdStoragePalletPosition.OCCUPIED]),
            "reserved_count": len([p for p in positions if p.status in (ColdStoragePalletPosition.RESERVED, ColdStoragePalletPosition.RESERVED_OUTBOUND)]),
            "maintenance_count": len([p for p in positions if p.status == ColdStoragePalletPosition.MAINTENANCE]),
            "required_count": required_count,
            "shortage": shortage,
            "can_fully_allocate": can_fully_allocate,
            "planned_allocations": planned_allocations,
            "all_positions": [
                {
                    "position_id": p.id,
                    "position_index": p.position_index,
                    "position_code": p.position_code,
                    "status": p.status,
                    "current_batch_number": p.current_batch_number,
                }
                for p in positions
            ],
        }

    def allocate_sequentially(
        self,
        warehouse_code: str,
        sap_bin_abs_entry: Optional[int] = None,
        bin_code: Optional[str] = None,
        sublevel1: Optional[str] = None,
        sublevel2: Optional[str] = None,
        sublevel3: Optional[str] = None,
        sublevel4: Optional[str] = None,
        pallet_count: int = 1,
        batches: Optional[List[Any]] = None,
        user=None,
        reference: str = "",
        allow_partial: bool = False,
        mode: str = "OCCUPY",
    ) -> Dict[str, Any]:
        """
        Concurrency-safe, atomic sequential pallet slot placement.
        Uses select_for_update() to prevent double assignment / race conditions.
        Strictly sorts available slots by position_index ASC.
        Reuses earlier freed slots before higher ones.
        Raises InsufficientCapacityError if required > available and allow_partial is False.
        """
        normalized_batches = []
        if batches:
            for b in batches:
                b_num = b.get("batch_number", "") if isinstance(b, dict) else str(b or "").strip()
                normalized_batches.append(b_num)

        required_count = max(int(pallet_count or 1), len(normalized_batches))
        if required_count <= 0:
            raise ValueError("Pallet count must be greater than zero.")

        mode = mode.upper()
        if mode not in ("OCCUPY", "RESERVE"):
            mode = "OCCUPY"

        with transaction.atomic():
            layout = self.resolve_bin_layout(
                warehouse_code=warehouse_code,
                sap_bin_abs_entry=sap_bin_abs_entry,
                bin_code=bin_code,
                sublevel1=sublevel1,
                sublevel2=sublevel2,
                sublevel3=sublevel3,
                sublevel4=sublevel4,
            )

            if layout.allocation_type != ColdStorageBinLayout.ALLOC_ALLOCATABLE:
                raise ValueError(
                    f"Location {layout.bin_code} is {layout.allocation_type} and cannot be allocated for pallet placement."
                )

            # Atomic lock on candidate available positions inside this layout
            candidate_positions = list(
                ColdStoragePalletPosition.objects.select_for_update()
                .filter(bin_layout=layout, status=ColdStoragePalletPosition.AVAILABLE)
                .order_by("position_index", "position_code")
            )

            available_count = len(candidate_positions)
            shortage = max(0, required_count - available_count)

            if available_count < required_count and not allow_partial:
                raise InsufficientCapacityError(
                    message=f"Insufficient capacity in bin {layout.bin_code}: required {required_count}, available {available_count}, shortage {shortage}.",
                    available=available_count,
                    required=required_count,
                    shortage=shortage,
                    bin_code=layout.bin_code,
                    sap_bin_abs_entry=layout.sap_bin_abs_entry,
                )

            allocate_count = min(required_count, available_count)
            allocated_positions = []
            now = timezone.now()

            for i in range(allocate_count):
                pos = candidate_positions[i]
                batch_num = normalized_batches[i] if i < len(normalized_batches) else ""

                if mode == "RESERVE":
                    pos.status = ColdStoragePalletPosition.RESERVED
                    pos.reserved_by = user
                    pos.reserved_at = now
                    pos.reservation_reference = str(reference or "").strip()
                    pos.save(update_fields=["status", "reserved_by", "reserved_at", "reservation_reference", "updated_at"])
                else:  # OCCUPY
                    pos.status = ColdStoragePalletPosition.OCCUPIED
                    pos.current_batch_number = batch_num
                    pos.reservation_reference = str(reference or "").strip()
                    pos.reserved_by = user
                    pos.reserved_at = now
                    pos.save(update_fields=[
                        "status", "current_batch_number", "reservation_reference",
                        "reserved_by", "reserved_at", "updated_at"
                    ])

                allocated_positions.append(pos)

                try:
                    from api.models import AuditLog
                    AuditLog.objects.create(
                        user=user,
                        username=user.username if user else "system",
                        action="ALLOCATE_PALLET_SEQUENTIAL",
                        module="COLD_STORAGE",
                        entity_type="ColdStoragePalletPosition",
                        entity_id=str(pos.id),
                        status=AuditLog.STATUS_SUCCESS,
                        details={
                            "bin_code": pos.bin_code,
                            "position_code": pos.position_code,
                            "position_index": pos.position_index,
                            "batch_number": batch_num,
                            "reference": reference,
                            "mode": mode,
                            "pallet_seq": i + 1,
                        },
                    )
                except Exception:
                    logger.exception("Failed to write audit log for position %s allocation", pos.id)

            return {
                "warehouse_code": layout.warehouse_code,
                "bin_code": layout.bin_code,
                "sap_bin_abs_entry": layout.sap_bin_abs_entry,
                "allocated_count": len(allocated_positions),
                "required_count": required_count,
                "shortage": shortage,
                "mode": mode,
                "allocated_positions": [
                    {
                        "pallet_seq": idx + 1,
                        "position_id": p.id,
                        "position_index": p.position_index,
                        "position_code": p.position_code,
                        "bin_code": p.bin_code,
                        "status": p.status,
                        "current_batch_number": p.current_batch_number,
                    }
                    for idx, p in enumerate(allocated_positions)
                ],
            }


class InsufficientCapacityError(ValueError):
    """
    Raised when requested pallet count exceeds available physical positions in a channel.
    """
    def __init__(self, message: str, available: int, required: int, shortage: int, bin_code: str = "", sap_bin_abs_entry: int = 0):
        super().__init__(message)
        self.available = available
        self.required = required
        self.shortage = shortage
        self.bin_code = bin_code
        self.sap_bin_abs_entry = sap_bin_abs_entry


_instance = None

def get_cold_storage_layout_service() -> ColdStorageLayoutService:
    global _instance
    if _instance is None:
        _instance = ColdStorageLayoutService()
    return _instance

