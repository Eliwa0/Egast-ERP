"""Bounded, read-only SAP lookups. Existing catalog endpoints opt in explicitly."""
from urllib.parse import urlencode

from .cache_service import build_cache_key, cache_get, cache_set, sap_master_namespace, cache_load_guard
from api.performance import record_cache


def is_lookup(request):
    return request.query_params.get("lookup") == "1"


def lookup_parameters(request):
    query = str(request.query_params.get("search") or "").strip()[:120]
    code = str(request.query_params.get("code") or "").strip()[:120]
    try:
        limit = min(50, max(1, int(request.query_params.get("limit", 25))))
    except (ValueError, TypeError):
        raise ValueError("Invalid lookup limit")
    return query, code, limit


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def lookup_offset(request):
    try:
        return max(0, int(request.query_params.get("offset", 0)))
    except (ValueError, TypeError):
        raise ValueError("Invalid lookup offset")


def lookup_response(request, sap, kind, key, *, wrapped=False, warehouse="", allowed_codes=None):
    from rest_framework.response import Response
    try:
        rows = search_master_data(request, sap, kind, warehouse=warehouse, allowed_codes=allowed_codes)
        data = {key: rows}
        _, _, bound = lookup_parameters(request)
        offset = lookup_offset(request)
        data["next_offset"] = offset + len(rows) if len(rows) == bound else None
        if warehouse:
            data["warehouse_code"] = warehouse
        return Response({"success": True, **({"data": data} if wrapped else data)})
    except ValueError as exc:
        return Response({"success": False, "error": str(exc)}, status=400)
    except Exception:
        return Response({"success": False, "error": "Unable to search SAP master data."}, status=503)


def query_rows(sap, entity, fields, filters, order, limit, offset=0):
    endpoint = entity + "?" + urlencode({
        "$select": fields, **({"$filter": " and ".join(filters)} if filters else {}),
        "$orderby": order, "$top": limit, **({"$skip": offset} if offset else {}),
    })
    # SAP may paginate below $top. Follow only until the requested bound.
    rows, seen = [], set()
    while endpoint and len(rows) < limit:
        if endpoint in seen:
            raise RuntimeError("Repeated SAP lookup page")
        seen.add(endpoint)
        result = sap._request("GET", endpoint)
        if not isinstance(result, dict) or result.get("error"):
            raise RuntimeError("SAP master-data search is unavailable")
        rows.extend(result.get("value") or [])
        endpoint = result.get("@odata.nextLink") or result.get("odata.nextLink")
        if endpoint:
            endpoint = str(endpoint).split("/b1s/v2/")[-1].split("/b1s/v1/")[-1].lstrip("/")
    return rows[:limit]


def search_master_data(request, sap, kind, *, warehouse="", allowed_codes=None):
    query, code, limit = lookup_parameters(request)
    offset = lookup_offset(request)
    group = str(request.query_params.get("item_group_code") or "").strip()
    browse = (
        kind in {"warehouses", "bins"} and request.query_params.get("initial") == "1"
    ) or (
        kind in {"items", "scale-items"} and group and (request.query_params.get("initial") == "1" or request.query_params.get("browse") == "1")
    )
    if kind in {"items", "scale-items"} and not code:
        code = str(request.query_params.get("item_code") or "").strip()[:120]
    probe = kind == "bins" and request.query_params.get("probe") == "1"
    if probe:
        limit = 1
    if not probe and not browse and not code and (not group if kind in {"items", "scale-items"} else True) and len(query) < 2:
        return []
    namespace = sap_master_namespace("autocomplete")
    key = build_cache_key(namespace, kind, warehouse, group, query, code, limit, offset, browse,
                          request.query_params.get("workflow", ""), request.query_params.get("group_name", ""),
                          tuple(sorted(allowed_codes)) if allowed_codes is not None else "all")
    with cache_load_guard(key):
        cached = cache_get(key)
        if cached is not None:
            return cached
        record_cache('loader')
        filters = []
        if kind == "warehouses":
            entity, fields, code_field, name_field = "Warehouses", "WarehouseCode,WarehouseName,Inactive", "WarehouseCode", "WarehouseName"
            if allowed_codes is not None:
                if not allowed_codes:
                    return []
                filters.append("(" + " or ".join(f"WarehouseCode eq {literal(c)}" for c in allowed_codes) + ")")
        elif kind == "bins":
            entity, fields, code_field, name_field = "BinLocations", "AbsEntry,BinCode,Warehouse,Description,Inactive,IsSystemBin", "BinCode", "Description"
            filters.append(f"Warehouse eq {literal(warehouse)}")
        elif kind in {"items", "scale-items"}:
            entity, fields, code_field, name_field = "Items", "ItemCode,ItemName,ItemsGroupCode,InventoryUOM", "ItemCode", "ItemName"
            if group:
                filters.append(f"ItemsGroupCode eq {int(group)}")
            if kind == "scale-items":
                filters.append("startswith(ItemCode, '27')")
        elif kind in {"farms", "contractors"}:
            names = ["مقاول عمال"] if kind == "contractors" else ["مزارع الشركة", "موردين خام"]
            requested_group = request.query_params.get("group_name", "")
            if requested_group:
                if requested_group not in names:
                    return []
                names = [requested_group]
            groups = query_rows(sap, "BusinessPartnerGroups", "Code,Name",
                                ["(" + " or ".join(f"Name eq {literal(n)}" for n in names) + ")"], "Code", 10)
            group_names = {int(row["Code"]): row.get("Name", "") for row in groups}
            if not group_names:
                return []
            filters.extend(["CardType eq 'cSupplier'", "(" + " or ".join(f"GroupCode eq {g}" for g in group_names) + ")"])
            entity, fields, code_field, name_field = "BusinessPartners", "CardCode,CardName,GroupCode,Currency", "CardCode", "CardName"
        else:
            raise ValueError("Unsupported master-data lookup")
        if not probe and (code or query):
            filters.append(f"{code_field} eq {literal(code)}" if code else
                           f"(contains({code_field}, {literal(query)}) or contains({name_field}, {literal(query)}))")
        raw = query_rows(sap, entity, fields, filters, code_field, limit, offset)
        rows = []
        for row in raw:
            c, n = row.get(code_field), row.get(name_field) or row.get(code_field)
            if not c:
                continue
            if kind == "warehouses":
                rows.append({"code": c, "name": n, "inactive": row.get("Inactive") not in ("tNO", False)})
            elif kind == "bins":
                if str(row.get("Warehouse") or "") != str(warehouse):
                    continue
                rows.append({"code": c, "name": n, "description": row.get("Description") or "",
                             "absEntry": row.get("AbsEntry"), "warehouse": row.get("Warehouse"),
                             "inactive": row.get("Inactive") in ("tYES", True),
                             "is_system_bin": row.get("IsSystemBin") in ("tYES", True) or "SYSTEM" in str(c).upper()})
            elif kind.endswith("items"):
                uom = str(row.get("InventoryUOM") or "").strip()
                rows.append({"item_code": c, "item_name": n, "item_group_code": str(row.get("ItemsGroupCode") or ""),
                             "uom_code": uom, "uom_name": uom, "farm_origin": "", "raw_material_type": ""})
            else:
                prefix = "contractor" if kind == "contractors" else "farm"
                rows.append({f"{prefix}Code": c, f"{prefix}Name": n, "code": c, "name": n,
                             "GroupName": group_names.get(row.get("GroupCode"), ""), "currency": row.get("Currency") or ""})
        cache_set(namespace, key, rows, "sap_items")
        return rows
