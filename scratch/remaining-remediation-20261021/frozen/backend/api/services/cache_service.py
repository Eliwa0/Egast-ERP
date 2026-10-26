import hashlib
import json
import logging
import os
import time
from threading import Lock
from contextlib import contextmanager

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)
from api.performance import record_cache

_LOAD_LOCKS = {}
_LOAD_LOCKS_GUARD = Lock()


@contextmanager
def cache_load_guard(key):
    # Refcounts include waiters; never replace a lock while a waiter still owns it.
    # This merges loads within a worker. Redis data sharing remains independent.
    with _LOAD_LOCKS_GUARD:
        entry = _LOAD_LOCKS.setdefault(key, [Lock(), 0])
        entry[1] += 1
    acquired = entry[0].acquire(blocking=False)
    if not acquired:
        record_cache('wait')
        entry[0].acquire()
    try:
        yield
    finally:
        entry[0].release()
        with _LOAD_LOCKS_GUARD:
            entry[1] -= 1
            if entry[1] == 0:
                del _LOAD_LOCKS[key]

CACHE_VERSION = "v1"
_MISSING = object()

# Emergency-only fallback used when the configured Django cache backend is
# unavailable. Redis remains the source of cached data in normal operation; this
# process-local cache is not shared across workers or servers and exists only to
# prevent repeated expensive SAP reads during a cache outage.
_LOCAL_FALLBACK_CACHE = {}
_LOCAL_NAMESPACE_KEYS = {}
_LOCAL_FALLBACK_LOCK = Lock()

CACHE_TIMEOUT_NAMES = {
    "sap_item_groups": "CACHE_TIMEOUT_SAP_ITEM_GROUPS",
    "sap_items": "CACHE_TIMEOUT_SAP_ITEMS",
    "sap_farms": "CACHE_TIMEOUT_SAP_FARMS",
    "sap_contractors": "CACHE_TIMEOUT_SAP_CONTRACTORS",
    "batch_udf_metadata": "CACHE_TIMEOUT_BATCH_UDF_METADATA",
    "quality_categories": "CACHE_TIMEOUT_QUALITY_CATEGORIES",
    "inspection_stages": "CACHE_TIMEOUT_INSPECTION_STAGES",
    "quality_criteria": "CACHE_TIMEOUT_QUALITY_CRITERIA",
    "inspection_quality_criteria": "CACHE_TIMEOUT_INSPECTION_QUALITY_CRITERIA",
    "item_quality_criteria": "CACHE_TIMEOUT_ITEM_QUALITY_CRITERIA",
    "sap_warehouses": "CACHE_TIMEOUT_SAP_WAREHOUSES",
    "sap_bin_locations": "CACHE_TIMEOUT_SAP_BIN_LOCATIONS",
    "sap_uoms": "CACHE_TIMEOUT_SAP_UOMS",
    "sap_uom_options": "CACHE_TIMEOUT_SAP_UOM_OPTIONS",
    "sap_company_options": "CACHE_TIMEOUT_SAP_COMPANY_OPTIONS",
    "sap_currencies": "CACHE_TIMEOUT_SAP_CURRENCIES",
    "sap_warehouse_locations": "CACHE_TIMEOUT_SAP_WAREHOUSE_LOCATIONS",
    "sap_tax_codes": "CACHE_TIMEOUT_SAP_TAX_CODES",
    "sap_cost_centers": "CACHE_TIMEOUT_SAP_COST_CENTERS",
    "sap_quotation_metadata": "CACHE_TIMEOUT_SAP_QUOTATION_METADATA",
    "sap_customers": "CACHE_TIMEOUT_SAP_CUSTOMERS",
}

CACHE_KEY_DOCUMENTATION = {
    "sap:item-groups:{workflow}": {
        "timeout": "CACHE_TIMEOUT_SAP_ITEM_GROUPS",
        "invalidation": "TTL only; SAP Business One owns item group master data.",
    },
    "sap:items:{mode}:{params_hash}": {
        "timeout": "CACHE_TIMEOUT_SAP_ITEMS",
        "invalidation": "TTL only; SAP Business One owns item master data.",
    },
    "sap:farms:quality": {
        "timeout": "CACHE_TIMEOUT_SAP_FARMS",
        "invalidation": "TTL only; SAP Business One owns vendor master data.",
    },
    "sap:contractors:quality": {
        "timeout": "CACHE_TIMEOUT_SAP_CONTRACTORS",
        "invalidation": "TTL only; SAP Business One owns vendor master data.",
    },
    "sap:batch-udf-metadata": {
        "timeout": "CACHE_TIMEOUT_BATCH_UDF_METADATA",
        "invalidation": "TTL only; SAP Business One owns UDF metadata.",
    },
    "quality:categories:{query_hash}": {
        "timeout": "CACHE_TIMEOUT_QUALITY_CATEGORIES",
        "invalidation": "Invalidated on QualityCategory create/update.",
    },
    "quality:inspection-stages:{query_hash}": {
        "timeout": "CACHE_TIMEOUT_INSPECTION_STAGES",
        "invalidation": "Invalidated on InspectionStage create/update/delete.",
    },
    "quality:criteria:{query_hash}": {
        "timeout": "CACHE_TIMEOUT_QUALITY_CRITERIA",
        "invalidation": "Invalidated on QualityCriterion create/update/delete and QualityCategory/InspectionStage changes.",
    },
    "quality:inspection-criteria:{stage}:{item_code}": {
        "timeout": "CACHE_TIMEOUT_INSPECTION_QUALITY_CRITERIA",
        "invalidation": "Invalidated on QualityCriterion, QualityCategory, InspectionStage, or ItemQualityCriterion changes.",
    },
    "quality:item-criteria:{query_hash}": {
        "timeout": "CACHE_TIMEOUT_ITEM_QUALITY_CRITERIA",
        "invalidation": "Invalidated on ItemQualityCriterion create/update/delete and related rule changes.",
    },
    "sap:warehouses:{company}": {
        "timeout": "CACHE_TIMEOUT_SAP_WAREHOUSES",
        "invalidation": "TTL only; SAP Business One owns warehouse master data.",
    },
    "sap:bin-locations:{company}:{warehouse_code}": {
        "timeout": "CACHE_TIMEOUT_SAP_BIN_LOCATIONS",
        "invalidation": "TTL only; SAP Business One owns bin location master data.",
    },
    "sap:uoms:{company}": {
        "timeout": "CACHE_TIMEOUT_SAP_UOMS",
        "invalidation": "TTL only; SAP Business One owns UOM master data.",
    },
    "sap:uom-options:{company}": {
        "timeout": "CACHE_TIMEOUT_SAP_UOM_OPTIONS",
        "invalidation": "TTL only; SAP Business One owns UOM master data.",
    },
    "sap:company-options:{company}": {
        "timeout": "CACHE_TIMEOUT_SAP_COMPANY_OPTIONS",
        "invalidation": "TTL only; SAP Business One owns company master data.",
    },
    "sap:currencies:{company}": {
        "timeout": "CACHE_TIMEOUT_SAP_CURRENCIES",
        "invalidation": "TTL only; SAP Business One owns currency master data.",
    },
    "sap:warehouse-locations:{company}": {
        "timeout": "CACHE_TIMEOUT_SAP_WAREHOUSE_LOCATIONS",
        "invalidation": "TTL only; SAP Business One owns warehouse location (OLOC) master data.",
    },
    "sap:cost-centers:{company}:{dimension}": {
        "timeout": "CACHE_TIMEOUT_SAP_COST_CENTERS",
        "invalidation": "TTL only; SAP Business One owns profit center (OPRC) master data.",
    },
}


def get_timeout(timeout_name):
    timeout_settings = getattr(settings, "APP_CACHE_TIMEOUTS", {})
    return int(timeout_settings.get(timeout_name, getattr(settings, "CACHE_DEFAULT_TIMEOUT", 300)))


def sap_master_namespace(domain):
    """SAP master-data cache namespace scoped to the active SAP company/environment.

    Keys built from this namespace are isolated per SAP company so cached master
    data from one company can never leak into another.
    """
    company = os.environ.get("SAP_COMPANY_DB") or getattr(settings, "SAP_COMPANY_DB", "") or "default"
    endpoint = os.environ.get("SAP_BASE_URL") or getattr(settings, "SAP_BASE_URL", "")
    endpoint_digest = hashlib.sha256(endpoint.rstrip("/").encode("utf-8")).hexdigest()[:20]
    return f"sap:{domain}:{endpoint_digest}:{company}"


def build_cache_key(namespace, *parts, **params):
    safe_parts = [CACHE_VERSION, namespace]
    safe_parts.extend(_safe_part(part) for part in parts if part not in (None, ""))
    if params:
        safe_parts.append(_params_digest(params))
    return ":".join(safe_parts)


def cache_get_or_set(namespace, key, loader, timeout_name):
    with cache_load_guard(key):
        return _cache_get_or_load(namespace, key, loader, timeout_name)


def _cache_get_or_load(namespace, key, loader, timeout_name):
    try:
        cached = cache.get(key)
    except Exception as exc:
        logger.warning("Cache read failed for %s: %s", key, exc)
        cached = _local_cache_get(key)
        if cached is not _MISSING:
            record_cache('hit')
            return cached
        record_cache('miss')
        record_cache('loader')
        value = loader()
        _local_cache_set(namespace, key, value, timeout_name)
        return value

    if cached is not None:
        record_cache('hit')
        return cached

    record_cache('miss')
    record_cache('loader')
    value = loader()
    try:
        cache.set(key, value, get_timeout(timeout_name))
        _register_namespace_key(namespace, key)
    except Exception as exc:
        logger.warning("Cache write failed for %s: %s", key, exc)
        _local_cache_set(namespace, key, value, timeout_name)
    return value


def cache_get(key):
    try:
        value = cache.get(key)
        record_cache('hit' if value is not None else 'miss')
        return value
    except Exception as exc:
        logger.warning("Cache read failed for %s: %s", key, exc)
        cached = _local_cache_get(key)
        record_cache('miss' if cached is _MISSING else 'hit')
        return None if cached is _MISSING else cached


def cache_set(namespace, key, value, timeout_name):
    try:
        cache.set(key, value, get_timeout(timeout_name))
        _register_namespace_key(namespace, key)
    except Exception as exc:
        logger.warning("Cache write failed for %s: %s", key, exc)
        _local_cache_set(namespace, key, value, timeout_name)
    return value


def invalidate_cache_namespaces(*namespaces):
    for namespace in namespaces:
        registry_key = _registry_key(namespace)
        try:
            keys = cache.get(registry_key) or []
            if keys:
                cache.delete_many(list(keys))
            cache.delete(registry_key)
        except Exception as exc:
            logger.warning("Cache invalidation failed for %s: %s", namespace, exc)
        _local_cache_delete_namespace(namespace)


def _register_namespace_key(namespace, key):
    registry_key = _registry_key(namespace)
    keys = cache.get(registry_key) or []
    if key in keys:
        return
    keys.append(key)
    cache.set(registry_key, keys, None)


def _registry_key(namespace):
    return build_cache_key("registry", namespace)


def _local_cache_get(key):
    now = time.monotonic()
    with _LOCAL_FALLBACK_LOCK:
        entry = _LOCAL_FALLBACK_CACHE.get(key)
        if entry is None:
            return _MISSING
        expires_at = entry["expires_at"]
        if expires_at is not None and expires_at <= now:
            _LOCAL_FALLBACK_CACHE.pop(key, None)
            for keys in _LOCAL_NAMESPACE_KEYS.values():
                keys.discard(key)
            return _MISSING
        return entry["value"]


def _local_cache_set(namespace, key, value, timeout_name):
    timeout = get_timeout(timeout_name)
    expires_at = None if timeout is None else time.monotonic() + timeout
    with _LOCAL_FALLBACK_LOCK:
        _LOCAL_FALLBACK_CACHE[key] = {"value": value, "expires_at": expires_at}
        _LOCAL_NAMESPACE_KEYS.setdefault(namespace, set()).add(key)


def _local_cache_delete_namespace(namespace):
    with _LOCAL_FALLBACK_LOCK:
        keys = _LOCAL_NAMESPACE_KEYS.pop(namespace, set())
        for key in keys:
            _LOCAL_FALLBACK_CACHE.pop(key, None)


def _safe_part(value):
    text = str(value).strip().lower()
    if len(text) <= 80 and all(character.isalnum() or character in "-_." for character in text):
        return text
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _params_digest(params):
    payload = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]
