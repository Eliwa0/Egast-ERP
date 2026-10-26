import json
import os
import ssl
import threading
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from requests.exceptions import SSLError
from .sap_transport import pooled_request

LIVE_RECEIPT_TRACE_PATH = Path(__file__).resolve().parents[2] / "live_receipt_trace.log"


def _safe_console_text(value):
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def _collect_batch_numbers(receipt_data):
    batch_numbers = []
    for document_line in receipt_data.get("DocumentLines") or []:
        for batch_row in document_line.get("BatchNumbers") or []:
            batch_number = batch_row.get("BatchNumber")
            if batch_number in (None, ""):
                continue
            batch_numbers.append(str(batch_number))
    return batch_numbers


def _append_live_receipt_trace(stage, payload):
    trace_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stage": stage,
        **payload,
    }
    try:
        LIVE_RECEIPT_TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LIVE_RECEIPT_TRACE_PATH.open("a", encoding="utf-8") as trace_file:
            trace_file.write(json.dumps(trace_entry, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"Live receipt trace error: {_safe_console_text(exc)}")


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _required_env(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _sap_ssl_verification():
    raw = os.getenv("SAP_VERIFY_SSL", "true").strip().lower()
    if raw not in {"1", "true", "yes", "on", "0", "false", "no", "off"}:
        raise ImproperlyConfigured("SAP_VERIFY_SSL must be an explicit boolean.")
    verify = raw in {"1", "true", "yes", "on"}
    bundle = os.getenv("SAP_CA_BUNDLE", "").strip()
    if not verify:
        if not settings.DEBUG:
            raise ImproperlyConfigured("SAP_VERIFY_SSL=False requires DEBUG=True; configure SAP_CA_BUNDLE in production.")
        if bundle:
            raise ImproperlyConfigured("SAP_CA_BUNDLE requires SAP_VERIFY_SSL=True.")
        return False
    if not bundle:
        return True
    path = Path(bundle).expanduser()
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    try:
        path = path.resolve(strict=True)
        if not path.is_file():
            raise OSError("Not a file")
        ssl.create_default_context(cafile=str(path))
    except (OSError, ValueError):
        raise ImproperlyConfigured("SAP_CA_BUNDLE must point to a readable, valid PEM CA certificate file.") from None
    return str(path)


class SAPServiceLayer:
    """
    SAP Service Layer client.

    The B1SESSION cache is process-local and scoped by base URL, company DB,
    SAP username, and TLS policy. Each web worker may hold its own SAP session; this is only a
    session reuse optimization, not shared application state.
    """

    _session_lock = threading.RLock()
    _session_cache = {}

    def __init__(self):
        self.base_url = _required_env("SAP_BASE_URL").rstrip("/")
        self.company_db = _required_env("SAP_COMPANY_DB")
        self.username = _required_env("SAP_USERNAME")
        self.password = _required_env("SAP_PASSWORD")
        self.verify_ssl = _sap_ssl_verification()
        self.session_id = None
        self._cookie_header = ""
        self._session_key = (self.base_url, self.company_db, self.username, self.verify_ssl)
        self._load_cached_session()

    @classmethod
    def _clear_session_cache_for_tests(cls):
        with cls._session_lock:
            cls._session_cache.clear()

    def _load_cached_session(self):
        with self._session_lock:
            cached = self._session_cache.get(self._session_key)
            if not cached:
                return False
            self.session_id = cached.get("session_id")
            self._cookie_header = cached.get("cookie_header") or ""
            return bool(self.session_id and self._cookie_header)

    def _store_session(self, response):
        cookies = response.cookies.get_dict() if hasattr(response.cookies, "get_dict") else {}
        session_id = cookies.get("B1SESSION") or response.cookies.get("B1SESSION")
        if not session_id:
            raise Exception("Login succeeded but SAP did not return B1SESSION.")
        cookie_header = "; ".join(
            f"{name}={value}" for name, value in cookies.items() if value
        )
        if "B1SESSION=" not in cookie_header:
            cookie_header = f"B1SESSION={session_id}"
        with self._session_lock:
            self.session_id = session_id
            self._cookie_header = cookie_header
            self._session_cache[self._session_key] = {
                "session_id": session_id,
                "cookie_header": cookie_header,
            }

    def _invalidate_session(self):
        with self._session_lock:
            cached = self._session_cache.get(self._session_key)
            if cached and cached.get("session_id") == self.session_id:
                self._session_cache.pop(self._session_key, None)
            self.session_id = None
            self._cookie_header = ""

    def _ensure_session(self, method=None, endpoint=None):
        if self.session_id and self._cookie_header:
            return False
        if self._load_cached_session():
            return True
        with self._session_lock:
            if self._load_cached_session():
                return True
            self.login()
            return False

    def login(self):
        url = f"{self.base_url}/Login"
        payload = {
            "CompanyDB": self.company_db,
            "UserName": self.username,
            "Password": self.password,
        }
        print("Logging in to SAP...")
        try:
            response = self._http_request('POST', url, json=payload, verify=self.verify_ssl, timeout=30)
            if response.status_code == 200:
                self._store_session(response)
                print("SAP login successful.")
                return True
            else:
                raise Exception(f"Login failed: {response.status_code}")
        except Exception as e:
            print(f"SAP connection error: {type(e).__name__}")
            raise

    def _request(self, method, endpoint, data=None, headers=None, retry_on_unauthorized=True):
        if not (self.session_id and self._cookie_header):
            self._ensure_session(method=method, endpoint=endpoint)
        url = f"{self.base_url}/{endpoint}"
        req_headers = {"Cookie": self._cookie_header or f"B1SESSION={self.session_id}"}
        if headers:
            req_headers.update(headers)
        try:
            response = self._http_request(
                method, url, json=data, headers=req_headers, verify=self.verify_ssl, timeout=30
            )
            if response.status_code == 401 and retry_on_unauthorized:
                print("Session expired, logging in again...")
                self._invalidate_session()
                self._ensure_session(method=method, endpoint=endpoint)
                return self._request(method, endpoint, data, headers=headers, retry_on_unauthorized=False)
            if response.status_code == 204:
                return {}
            result = response.json()
            return result
        except Exception as e:
            print(f"Request error: {str(e)}")
            return {"error": str(e)}

    def _http_request(self, method, url, **kwargs):
        kwargs["verify"] = self.verify_ssl
        try:
            return pooled_request((self._session_key, self.verify_ssl), method, url, **kwargs)
        except SSLError:
            raise SSLError(
                "SAP TLS certificate verification failed. Configure SAP_CA_BUNDLE with a trusted CA "
                "and ensure the certificate matches the SAP hostname. For internal development only, "
                "DEBUG=True and SAP_VERIFY_SSL=False allow unverified TLS."
            ) from None

    def get_item_tracking_flags_bulk(self, item_codes):
        """Fresh master-data flags in bounded batches; legacy fallback for omissions.

        No inventory cache or changed posting checks. SAP Items flags represent the
        same OITM columns used by get_item_tracking_flags.
        """
        from urllib.parse import urlencode
        codes = list(dict.fromkeys(str(code).strip() for code in item_codes if str(code or '').strip()))
        flags = {}
        for start in range(0, len(codes), 40):
            batch = codes[start:start + 40]
            offset = 0
            while offset < len(batch):
                query = urlencode({
                    '$select': 'ItemCode,ManageBatchNumbers,ManageSerialNumbers',
                    '$filter': ' or '.join("ItemCode eq '" + code.replace("'", "''") + "'" for code in batch),
                    '$orderby': 'ItemCode', '$top': len(batch) - offset, '$skip': offset,
                })
                try:
                    result = self._request('GET', 'Items?' + query)
                except Exception:
                    break
                rows = result.get('value') if isinstance(result, dict) and not result.get('error') else None
                if not isinstance(rows, list) or not rows:
                    break
                for row in rows:
                    if not isinstance(row, dict) or row.get('ItemCode') not in batch:
                        continue
                    values = [row.get('ManageBatchNumbers'), row.get('ManageSerialNumbers')]
                    if all(value in ('tYES', 'tNO') for value in values):
                        flags[row['ItemCode']] = dict(manage_batches=values[0] == 'tYES', manage_serials=values[1] == 'tYES')
                offset += len(rows)
                if not (result.get('odata.nextLink') or result.get('@odata.nextLink')):
                    break
            for code in batch:
                if code not in flags:
                    flags[code] = self.get_item_tracking_flags(code)
        return flags

    # ========== Production Orders ==========
    def get_open_production_orders(self):
        sql_code = "OPEN_PROD_ORDERS_V6"
        sql_text = (
            'SELECT '
            'T0."DocEntry", '
            'T0."DocNum" AS "orderNumber", '
            'T0."ItemCode", '
            'T0."ProdName" AS "itemName", '
            'T0."PlannedQty", '
            'T0."CmpltQty" AS "completedQty", '
            'T0."Warehouse", '
            'T0."OcrCode" AS "location", '
            'T0."PostDate", '
            'T0."DueDate", '
            'T0."Status" '
            'FROM "OWOR" T0 '
            'WHERE T0."Status" IN (\'P\', \'R\') '
            'ORDER BY T0."DocNum" DESC'
        )
        print(f"[OPEN-ORDERS] sql_code={sql_code!r}")

        ensure_result = self.ensure_sql_query(sql_code, "Open production orders", sql_text)
        if ensure_result and ensure_result.get("error"):
            raise Exception(f"ensure_sql_query failed: {ensure_result.get('error')}")

        if not self.session_id:
            self.login()
        headers = {"Cookie": f"B1SESSION={self.session_id}"}

        # First page via POST, subsequent pages via GET on nextLink
        first_url = f"{self.base_url}/SQLQueries('{sql_code}')/List?$top=1000"
        response = self._http_request('POST', first_url, json={}, headers=headers, verify=self.verify_ssl, timeout=30)
        if response.status_code == 401:
            self.login()
            headers["Cookie"] = f"B1SESSION={self.session_id}"
            response = self._http_request('POST', first_url, json={}, headers=headers, verify=self.verify_ssl, timeout=30)
        if response.status_code not in (200, 201):
            raise Exception(f"SQLQueries List HTTP {response.status_code}: {response.text}")

        data = response.json()
        if data.get("error"):
            raise Exception(f"SQLQueries List failed: {data.get('error')}")

        all_rows = list(data.get("value", []))
        page_count = 1
        next_link = data.get("odata.nextLink") or data.get("@odata.nextLink")

        while next_link:
            url = next_link if next_link.startswith("http") else f"{self.base_url}/{next_link}"
            resp = self._http_request('GET', url, headers=headers, verify=self.verify_ssl, timeout=30)
            if resp.status_code == 401:
                self.login()
                headers["Cookie"] = f"B1SESSION={self.session_id}"
                resp = self._http_request('GET', url, headers=headers, verify=self.verify_ssl, timeout=30)
            page_data = resp.json()
            all_rows.extend(page_data.get("value", []))
            page_count += 1
            next_link = page_data.get("odata.nextLink") or page_data.get("@odata.nextLink")

        from collections import Counter
        status_counts = dict(Counter(r.get("Status") for r in all_rows))
        print(f"[OPEN-ORDERS] pages={page_count} total_rows={len(all_rows)}")
        print(f"[OPEN-ORDERS] status_counts={status_counts}")
        return all_rows

    def get_production_orders(self, status=None):
        endpoint = "ProductionOrders"
        if status:
            endpoint += f"?$filter=Status eq '{status}'"
        return self._request("GET", endpoint)

    def get_production_order(self, doc_entry):
        endpoint = f"ProductionOrders({doc_entry})"
        return self._request("GET", endpoint)

    def close_production_order(self, doc_entry):
        endpoint = "ProductionOrdersService_Close"
        payload = {"DocEntry": doc_entry}
        return self._request("POST", endpoint, payload)

    # ========== Receipts ==========
    def create_receipt_from_production(self, receipt_data):
        """إنشاء استلام إنتاج في SAP"""
        try:
            endpoint = "InventoryGenEntries"
            batch_numbers = _collect_batch_numbers(receipt_data)
            comments_marker = receipt_data.get("Comments")

            # التأكد من وجود Session نشط
            if not self.session_id:
                self.login()

            url = f"{self.base_url}/{endpoint}"
            headers = {
                "Cookie": f"B1SESSION={self.session_id}",
                "Content-Type": "application/json",
            }

            _append_live_receipt_trace(
                "before_post",
                {
                    "endpoint": endpoint,
                    "url": url,
                    "comments_marker": comments_marker,
                    "batch_numbers": batch_numbers,
                },
            )

            response = self._http_request('POST',
                url, json=receipt_data, headers=headers, verify=self.verify_ssl, timeout=30
            )
            raw_response_body = response.text
            try:
                response_body = response.json()
            except ValueError:
                response_body = None
            created_doc_entry = (
                response_body.get("DocEntry")
                if isinstance(response_body, dict)
                else None
            )
            created_doc_num = (
                response_body.get("DocNum")
                if isinstance(response_body, dict)
                else None
            )
            created_document = (
                created_doc_entry is not None or created_doc_num is not None
            )

            print(f"Response status: {response.status_code}")
            print(f"Response body: {_safe_console_text(raw_response_body)}")
            print(f"Created DocEntry: {_safe_console_text(created_doc_entry)}")
            print(f"Created DocNum: {_safe_console_text(created_doc_num)}")
            _append_live_receipt_trace(
                "after_post",
                {
                    "endpoint": endpoint,
                    "url": url,
                    "comments_marker": comments_marker,
                    "batch_numbers": batch_numbers,
                    "http_status": response.status_code,
                    "raw_response_body": raw_response_body,
                    "response_body": response_body,
                    "created_doc_entry": created_doc_entry,
                    "created_doc_num": created_doc_num,
                    "created_document": created_document,
                },
            )

            if response.status_code in [200, 201]:
                if not created_document:
                    return {
                        "error": (
                            f"SAP returned HTTP {response.status_code} without "
                            f"DocEntry/DocNum: {raw_response_body}"
                        ),
                        "success": False,
                    }
                return response_body
            else:
                return {
                    "error": f"HTTP {response.status_code}: {raw_response_body}",
                    "success": False,
                }

        except Exception as e:
            print(f"Exception: {str(e)}")
            return {"error": str(e), "success": False}

    def create_issue_for_production(self, payload):
        """إنشاء إذن صرف إنتاج في SAP (Goods Issue for Production)"""
        try:
            endpoint = "InventoryGenExits"

            if not self.session_id:
                self.login()

            url = f"{self.base_url}/{endpoint}"
            headers = {
                "Cookie": f"B1SESSION={self.session_id}",
                "Content-Type": "application/json",
            }

            response = self._http_request('POST',
                url, json=payload, headers=headers, verify=self.verify_ssl, timeout=30
            )
            raw_response_body = response.text
            try:
                response_body = response.json()
            except ValueError:
                response_body = None

            created_doc_entry = (
                response_body.get("DocEntry")
                if isinstance(response_body, dict)
                else None
            )
            created_doc_num = (
                response_body.get("DocNum")
                if isinstance(response_body, dict)
                else None
            )
            created_document = (
                created_doc_entry is not None or created_doc_num is not None
            )

            if response.status_code in [200, 201]:
                if not created_document:
                    return {
                        "error": (
                            f"SAP returned HTTP {response.status_code} without "
                            f"DocEntry/DocNum: {raw_response_body}"
                        ),
                        "success": False,
                    }
                return response_body
            else:
                return {
                    "error": f"HTTP {response.status_code}: {raw_response_body}",
                    "success": False,
                }
        except Exception as e:
            print(f"Exception: {str(e)}")
            return {"error": str(e), "success": False}

    def get_issue_for_production(self, doc_entry):
        """Fetch a Goods Issue for Production (InventoryGenExits) by DocEntry from SAP Service Layer."""
        endpoint = f"InventoryGenExits({doc_entry})"
        return self._request("GET", endpoint)

    def get_receipts(self, from_date=None, to_date=None):
        endpoint = "InventoryGenEntries"
        filters = []
        if from_date:
            filters.append(f"DocDate ge '{from_date}'")
        if to_date:
            filters.append(f"DocDate le '{to_date}'")
        if filters:
            endpoint += "?$filter=" + " and ".join(filters)
        return self._request("GET", endpoint)

    def create_purchase_delivery_note(self, payload):
        """Create SAP Business One Purchase GRPO through PurchaseDeliveryNotes."""
        print("[PURCHASE-GRPO] POST PurchaseDeliveryNotes")
        result = self._request("POST", "PurchaseDeliveryNotes", payload)
        print(f"[PURCHASE-GRPO] response={_safe_console_text(result)}")
        return result

    def create_purchase_quotation(self, payload):
        """Create SAP Business One Purchase Quotation through PurchaseQuotations."""
        print("[PURCHASE-QUOTATION] POST PurchaseQuotations")
        result = self._request("POST", "PurchaseQuotations", payload)
        print(f"[PURCHASE-QUOTATION] response={_safe_console_text(result)}")
        return result

    def create_sales_quotation(self, payload):
        """Create SAP Business One Sales Quotation through Quotations (OQUT)."""
        print("[SALES-QUOTATION] POST Quotations")
        result = self._request("POST", "Quotations", payload)
        print(f"[SALES-QUOTATION] response={_safe_console_text(result)}")
        return result


    # ========== Inventory ==========
    def get_item_stock(self, item_code):
        endpoint = f"Items('{item_code}')"
        return self._request("GET", endpoint)

    def get_advanced_gl_account(
        self, item_code, warehouse, posting_date, account_type="iatInventory"
    ):
        payload = {
            "AdvancedGLAccountParams": {
                "ItemCode": item_code,
                "Warehouse": warehouse,
                "PostingDate": posting_date,
                "AccountType": account_type,
            }
        }
        return self._request("POST", "CompanyService_GetAdvancedGLAccount", payload)

    def get_low_stock_items(self, threshold=10):
        endpoint = f"Items?$filter=QuantityOnStock lt {threshold}"
        return self._request("GET", endpoint)

    # ========== Item Information ==========
    def get_item_name(self, item_code):
        try:
            endpoint = f"Items('{item_code}')?$select=ItemName"
            result = self._request("GET", endpoint)
            return result.get("ItemName", item_code)
        except Exception as e:
            print(f"Error fetching item name: {e}")
            return item_code

    def get_item_details(self, item_code):
        try:
            endpoint = f"Items('{item_code}')"
            result = self._request("GET", endpoint)
            price = 0
            if result.get("PriceList") and len(result["PriceList"]) > 0:
                price = result["PriceList"][0].get("Price", 0)
            item_name = result.get("ItemName", "")
            if not item_name or item_name == "":
                item_name = result.get("ItemCode", item_code)
            manage_batches = result.get("ManageBatchNumbers") == "tYES"
            manage_serials = result.get("ManageSerialNumbers") == "tYES"
            return {
                "item_code": item_code,
                "item_name": item_name,
                "price": price,
                "uom": result.get("SalesUnit", "PCS"),
                "uom_name": result.get("UoMName", "Piece"),
                "manage_batch_numbers": manage_batches,
                "manage_serial_numbers": manage_serials,
                "success": True,
            }
        except Exception as e:
            return {
                "item_code": item_code,
                "item_name": item_code,
                "price": 0,
                "uom": "PCS",
                "uom_name": "Piece",
                "success": False,
                "error": str(e),
            }

    # ========== Warehouses & Bin Locations ==========
    def get_warehouse_details(self, warehouse_code):
        """Exact, uncached warehouse metadata for Transfer policy safety checks."""
        escaped = str(warehouse_code).replace("'", "''")
        return self._request("GET", f"Warehouses('{escaped}')")

    def get_warehouses(self):
        if not self.session_id:
            self.login()

        headers = {
            "Cookie": f"B1SESSION={self.session_id}",
            "Prefer": "odata.maxpagesize=1000",
        }

        url = (
            f"{self.base_url}/Warehouses"
            "?$select=WarehouseCode,WarehouseName,Inactive"
            "&$top=1000"
        )

        all_rows = []

        while url:
            response = self._http_request('GET',
                url,
                headers=headers,
                verify=self.verify_ssl,
                timeout=30,
            )

            if response.status_code == 401:
                self.login()
                headers["Cookie"] = f"B1SESSION={self.session_id}"

                response = self._http_request('GET',
                    url,
                    headers=headers,
                    verify=self.verify_ssl,
                    timeout=30,
                )

            if response.status_code != 200:
                return {
                    "error": f"HTTP {response.status_code}: {response.text}",
                    "value": all_rows,
                }

            data = response.json()

            all_rows.extend(data.get("value", []))

            next_link = (
                data.get("odata.nextLink")
                or data.get("@odata.nextLink")
            )

            if next_link:
                if next_link.startswith("http"):
                    url = next_link
                elif next_link.startswith("/"):
                    url = (
                        f"{self.base_url.rsplit('/b1s/', 1)[0]}"
                        f"{next_link}"
                    )
                else:
                    url = f"{self.base_url}/{next_link}"
            else:
                url = None

        return {"value": all_rows}

    def get_bin_locations_by_warehouse(self, warehouse_code):
        if not self.session_id:
            self.login()

        safe_whs = str(warehouse_code).replace("'", "''")
        select_fields = (
            "AbsEntry,BinCode,Warehouse,Description,"
            "Sublevel1,Sublevel2,Sublevel3,Sublevel4,"
            "Inactive,IsSystemBin"
        )
        url = (
            f"{self.base_url}/BinLocations"
            f"?$filter=Warehouse eq '{safe_whs}'"
            f"&$select={select_fields}"
        )
        headers = {
            "Cookie": f"B1SESSION={self.session_id}",
            "Prefer": "odata.maxpagesize=500",
        }

        all_rows = []

        while url:
            response = self._http_request('GET',
                url,
                headers=headers,
                verify=self.verify_ssl,
                timeout=30,
            )

            if response.status_code == 401:
                self.login()
                headers["Cookie"] = f"B1SESSION={self.session_id}"
                response = self._http_request('GET',
                    url,
                    headers=headers,
                    verify=self.verify_ssl,
                    timeout=30,
                )

            if response.status_code != 200:
                return {
                    "error": f"HTTP {response.status_code}: {response.text}",
                    "value": all_rows,
                }

            data = response.json()
            all_rows.extend(data.get("value", []))

            next_link = (
                data.get("odata.nextLink")
                or data.get("@odata.nextLink")
            )

            if next_link:
                if next_link.startswith("http"):
                    url = next_link
                elif next_link.startswith("/"):
                    url = (
                        f"{self.base_url.rsplit('/b1s/', 1)[0]}"
                        f"{next_link}"
                    )
                else:
                    url = f"{self.base_url}/{next_link.lstrip('/')}"
            else:
                url = None

        return {"value": all_rows}

    # ========== Series & Accounts ==========
    def get_series_list(self):
        endpoint = "Series?$filter=ObjectCode eq 202"
        return self._request("GET", endpoint)

    def get_account_codes(self):
        endpoint = "ChartOfAccounts?$filter=AccountType eq 'I'&$top=50"
        return self._request("GET", endpoint)

    def get_user_fields_metadata(self, table_name):
        endpoint = (
            "UserFieldsMD"
            f"?$filter=TableName eq '{table_name}'"
            "&$select=FieldID,Name,Description,DefaultValue,TableName,EditSize,Type"
        )
        return self._request("GET", endpoint)

    def search_user_fields_metadata_by_names(self, names):
        quoted_names = [f"Name eq '{name}'" for name in names if name]
        if not quoted_names:
            return {"value": []}
        endpoint = (
            "UserFieldsMD?$select=FieldID,Name,Description,DefaultValue,TableName,EditSize,Type"
            "&$filter=" + " or ".join(quoted_names)
        )
        return self._request("GET", endpoint)

    def ensure_sql_query(self, sql_code, sql_name, sql_text):
        existing = self._request("GET", f"SQLQueries('{sql_code}')")
        if existing and not existing.get("error"):
            # Update the SQL text in case it changed (e.g. syntax fix for HANA)
            if existing.get("SqlText", "").strip() != sql_text.strip():
                patch_payload = {"SqlName": sql_name, "SqlText": sql_text}
                patch_result = self._request(
                    "PATCH", f"SQLQueries('{sql_code}')", patch_payload
                )
                print(f"[SQL-UPDATE] patched {sql_code!r}: {patch_result}")
            return existing

        payload = {
            "SqlCode": sql_code,
            "SqlName": sql_name,
            "SqlText": sql_text,
        }
        return self._request("POST", "SQLQueries", payload)

    def execute_sql_query(self, sql_code, param_list=None):
        payload = {"ParamList": param_list} if param_list else {}
        initial = self._request("POST", f"SQLQueries('{sql_code}')/List", payload)
        if not isinstance(initial, dict) or initial.get("error"):
            return initial

        all_values = list(initial.get("value") or [])
        next_link = initial.get("odata.nextLink") or initial.get("@odata.nextLink")

        while next_link:
            if next_link.startswith("http"):
                endpoint = next_link.split(self.base_url.rstrip("/") + "/")[-1]
            elif next_link.startswith("/"):
                endpoint = next_link.lstrip("/")
            else:
                endpoint = next_link
            page_data = self._request("GET", endpoint)
            if not isinstance(page_data, dict) or page_data.get("error"):
                break
            all_values.extend(page_data.get("value") or [])
            next_link = page_data.get("odata.nextLink") or page_data.get("@odata.nextLink")

        initial["value"] = all_values
        return initial

    def get_item_tracking_flags(self, item_code):
        """
        Check whether an item is Batch-managed or Serial-managed in SAP (OITM).
        Returns dict: {'manage_batches': bool, 'manage_serials': bool}
        """
        if not item_code:
            return {"manage_batches": False, "manage_serials": False}
        sql = 'SELECT T0."ItemCode", T0."ManBtchNum", T0."ManSerNum" FROM "OITM" T0 WHERE T0."ItemCode" = :itemCode'
        try:
            self.ensure_sql_query('Z_OITM_FLAGS_BY_ITEM', 'OITM Flags By Item', sql)
            clean_code = str(item_code).strip().replace("'", "''")
            res = self.execute_sql_query('Z_OITM_FLAGS_BY_ITEM', f"itemCode='{clean_code}'")
            rows = res.get('value') or []
            if rows:
                row = rows[0]
                return {
                    "manage_batches": str(row.get("ManBtchNum") or "").upper() == "Y",
                    "manage_serials": str(row.get("ManSerNum") or "").upper() == "Y",
                }
        except Exception as exc:
            print(f"[SAP] get_item_tracking_flags error for {item_code}: {exc}")
        return {"manage_batches": False, "manage_serials": False}


    def get_profit_centers(self, dimension=None):
        """Fetch ProfitCenters (Cost Centers / Dimensions 1 & 2) from SAP Service Layer."""
        filters = ["Active eq 'tYES'"]
        if dimension not in (None, ""):
            filters.append(f"InWhichDimension eq {int(dimension)}")
        endpoint = (
            "ProfitCenters?"
            "$select=CenterCode,CenterName,InWhichDimension,Active"
            f"&$filter={' and '.join(filters)}"
            "&$top=1000"
        )
        all_rows = []
        seen_endpoints = set()

        while endpoint:
            if endpoint in seen_endpoints:
                break
            seen_endpoints.add(endpoint)

            result = self._request("GET", endpoint)
            if not isinstance(result, dict) or result.get("error"):
                if all_rows:
                    break
                return result

            all_rows.extend(result.get("value", []))
            next_link = result.get("odata.nextLink") or result.get("@odata.nextLink")
            if next_link:
                if next_link.startswith("http"):
                    endpoint = next_link.split("/b1s/v2/")[-1]
                else:
                    endpoint = next_link.lstrip("/")
            else:
                endpoint = None

        return {"value": all_rows}

    def get_warehouse_locations(self):
        """Fetch WarehouseLocations (table OLOC) from SAP Service Layer."""
        endpoint = "WarehouseLocations"
        all_rows = []
        seen_endpoints = set()

        while endpoint:
            if endpoint in seen_endpoints:
                break
            seen_endpoints.add(endpoint)

            result = self._request("GET", endpoint)
            if not isinstance(result, dict) or result.get("error"):
                if all_rows:
                    break
                return result

            all_rows.extend(result.get("value", []))
            next_link = result.get("odata.nextLink") or result.get("@odata.nextLink")
            if next_link:
                if next_link.startswith("http"):
                    endpoint = next_link.split("/b1s/v2/")[-1]
                else:
                    endpoint = next_link.lstrip("/")
            else:
                endpoint = None

        return {"value": all_rows}

    def get_currencies(self):
        """Fetch Currencies (table OCRN) from SAP Service Layer."""
        endpoint = "Currencies?$select=Code,Name,DocumentsCode,InternationalDescription&$orderby=Code"
        all_rows = []
        seen_endpoints = set()

        while endpoint:
            if endpoint in seen_endpoints:
                break
            seen_endpoints.add(endpoint)

            result = self._request("GET", endpoint)
            if not isinstance(result, dict) or result.get("error"):
                if all_rows:
                    break
                return result

            all_rows.extend(result.get("value", []))
            next_link = result.get("odata.nextLink") or result.get("@odata.nextLink")
            if next_link:
                if next_link.startswith("http"):
                    endpoint = next_link.split("/b1s/v2/")[-1]
                else:
                    endpoint = next_link.lstrip("/")
            else:
                endpoint = None

        return {"value": all_rows}

    def get_all_uoms(self):
        """جلب كل وحدات القياس من UnitOfMeasurements"""
        if not self.session_id:
            self.login()
        
        url = f"{self.base_url}/UnitOfMeasurements?$select=AbsEntry,Code,Name&$orderby=AbsEntry"
        headers = {
            "Cookie": f"B1SESSION={self.session_id}",
            "Prefer": "odata.maxpagesize=500",
        }
        
        all_rows = []
        try:
            while url:
                response = self._http_request('GET', url, headers=headers, verify=self.verify_ssl, timeout=30)
                if response.status_code == 401:
                    self.login()
                    headers["Cookie"] = f"B1SESSION={self.session_id}"
                    response = self._http_request('GET', url, headers=headers, verify=self.verify_ssl, timeout=30)
                
                if response.status_code != 200:
                    return {"error": f"HTTP {response.status_code}: {response.text}"}
                
                data = response.json()
                rows = data.get("value", [])
                all_rows.extend(rows)
                
                next_link = data.get("odata.nextLink") or data.get("@odata.nextLink")
                if next_link:
                    if next_link.startswith("http"):
                        url = next_link
                    else:
                        url = f"{self.base_url}/{next_link}"
                else:
                    url = None
            
            return {"value": all_rows}
        except Exception as e:
            return {"error": str(e)}
    

    # ========== Batch Number Suffix ==========
    def get_next_batch_number_suffix(self, order_number, item_code=None):
        """
        Returns integer N so the next batch number is '{order_number}-{N}'.

        Uses BatchNumberDetails OData with startswith(Batch, prefix) — anchored to the
        beginning of the batch number so batches from other orders that merely CONTAIN
        the prefix as a substring are not included.

        If item_code is provided, an additional filter limits results to that item, which
        prevents batches with the same numeric prefix but belonging to a different item
        from inflating the suffix counter.
        """
        if not self.session_id:
            self.login()

        prefix = f"{order_number}-"
        # startswith is anchored; substringof was too broad (matched mid-string occurrences).
        filter_parts = [f"startswith(Batch,'{prefix}')"]
        if item_code:
            safe_item = str(item_code).replace("'", "''")
            filter_parts.append(f"ItemCode eq '{safe_item}'")
        odata_filter = " and ".join(filter_parts)

        url = (
            f"{self.base_url}/BatchNumberDetails"
            f"?$filter={odata_filter}"
            f"&$select=Batch&$top=500"
        )
        headers = {"Cookie": f"B1SESSION={self.session_id}"}
        all_batches = []

        try:
            while url:
                response = self._http_request('GET', url, headers=headers, verify=self.verify_ssl, timeout=30)
                if response.status_code == 401:
                    self.login()
                    headers["Cookie"] = f"B1SESSION={self.session_id}"
                    response = self._http_request('GET', url, headers=headers, verify=self.verify_ssl, timeout=30)
                data = response.json()
                all_batches.extend(data.get("value", []))
                next_link = data.get("odata.nextLink") or data.get("@odata.nextLink")
                if next_link:
                    url = next_link if next_link.startswith("http") else f"{self.base_url}/{next_link}"
                else:
                    url = None

            max_n = 0
            for row in all_batches:
                batch = str(row.get("Batch", "")).strip()
                # Guard: exact prefix + pure digits only (belt-and-suspenders vs OData quirks)
                if batch.startswith(prefix):
                    suffix = batch[len(prefix):]
                    if suffix.isdigit():
                        max_n = max(max_n, int(suffix))

            return max_n + 1
        except Exception as e:
            raise Exception(f"BatchNumberDetails error: {e}")

    # ========== Next Receipt Number ==========
    def get_next_receipt_number(self):
        endpoint = "Series?$filter=ObjectCode eq 59"
        result = self._request("GET", endpoint)

        series = result.get("value", [])
        if not series:
            return None

        return series[0].get("NextNumber")

    # ========== Transfer: OData batch/item helpers ==========

    def get_batch_number_details(self, batch_number):
        """GET BatchNumberDetails filtered by Batch number — no SQL registration."""
        safe = str(batch_number).replace("'", "''")
        endpoint = f"BatchNumberDetails?$filter=Batch eq '{safe}'"
        return self._request("GET", endpoint)

    def get_item_with_warehouse_stock(self, item_code):
        """GET Item metadata used by Quality/GRPO without unsupported Item expansions."""
        safe = str(item_code).replace("'", "''")
        endpoint = (
            f"Items('{safe}')"
            "?$select=ItemCode,ItemName,InventoryUOM"
        )
        return self._request("GET", endpoint)

    # ========== Batch & Bin Stock Lookup ==========
    def get_batch_bin_stock(self, item_code, warehouse_code=None):
        """
        Fetch in-stock batches from SAP with bin locations (OBBQ / OBTN / OBIN).
        Returns a list of dicts with keys:
          item_code, batch_number, dist_number, warehouse_code, on_hand_qty, quantity,
          bin_abs_entry, bin_code, expiry_date, manufacturing_date, is_system_bin
        """
        clean_code = str(item_code or "").strip().replace("'", "''")
        clean_whs = str(warehouse_code or "").strip().replace("'", "''") if warehouse_code else ""
        rows = []
        if clean_whs:
            try:
                param_whs = f"itemCode='{clean_code}'&whsCode='{clean_whs}'"
                result = self.execute_sql_query("CD_BATCHES_BY_ITEM_WHS", param_whs)
                if isinstance(result, dict) and not result.get("error"):
                    rows = result.get("value") or []
            except Exception:
                pass
            if not rows:
                try:
                    param_whs = f"itemCode='{clean_code}'&whsCode='{clean_whs}'"
                    result_obtq = self.execute_sql_query("CD_BATCHES_OBTQ_WHS", param_whs)
                    if isinstance(result_obtq, dict) and not result_obtq.get("error"):
                        rows = result_obtq.get("value") or []
                except Exception:
                    pass
        if not rows:
            try:
                param_str = f"itemCode='{clean_code}'"
                result = self.execute_sql_query("CD_BATCHES_BY_ITEM", param_str)
                if isinstance(result, dict) and not result.get("error"):
                    rows = result.get("value") or []
            except Exception:
                pass
            if not rows:
                try:
                    result_obtq = self.execute_sql_query("CD_BATCHES_OBTQ", param_str)
                    if isinstance(result_obtq, dict) and not result_obtq.get("error"):
                        rows = result_obtq.get("value") or []
                except Exception:
                    pass

        batches = []
        for r in rows:
            row_whs = str(r.get("WhsCode") or "").strip()
            if warehouse_code and row_whs != warehouse_code:
                continue
            on_hand = float(r.get("OnHandQty") or 0.0)
            if on_hand <= 0:
                continue

            batch_number = str(r.get("BatchNumber") or "").strip()
            bin_code = str(r.get("BinCode") or "").strip()
            bin_abs = r.get("BinAbsEntry")
            try:
                bin_abs = int(bin_abs) if bin_abs is not None else None
            except (ValueError, TypeError):
                bin_abs = None

            raw_sys = str(r.get("SysBin") or "").strip().upper()
            is_system_bin = (raw_sys in ("Y", "TYES", "YES")) or ("SYSTEM-BIN" in bin_code.upper())
            exp_date = r.get("ExpDate")
            mnf_date = r.get("MnfDate")

            batches.append({
                "item_code": r.get("ItemCode") or item_code,
                "batch_number": batch_number,
                "dist_number": batch_number,
                "warehouse_code": row_whs,
                "on_hand_qty": on_hand,
                "quantity": on_hand,
                "bin_abs_entry": bin_abs,
                "bin_code": bin_code,
                "expiry_date": exp_date,
                "manufacturing_date": mnf_date,
                "is_system_bin": is_system_bin,
            })

        batches.sort(key=lambda b: (1 if b["is_system_bin"] else 0, -b["on_hand_qty"]))
        return batches

    # ========== Logout ==========
    def create_stock_transfer(self, payload):
        return self._request("POST", "StockTransfers", payload)

    def logout(self):
        if self.session_id:
            endpoint = "Logout"
            headers = {"Cookie": f"B1SESSION={self.session_id}"}
            try:
                self._http_request('POST',
                    f"{self.base_url}/{endpoint}", headers=headers, verify=self.verify_ssl
                )
                self.session_id = None
                return True
            except Exception:
                return False
        return True

    def get_production_order_full(self, order_number):

        try:
            # جرب البحث بعدة طرق
            endpoints = [
                f"ProductionOrders?$filter=DocumentNumber eq '{order_number}'",
                f"ProductionOrders?$filter=DocNum eq {order_number}",
                f"ProductionOrders?$filter=ProductionOrderNumber eq '{order_number}'",
            ]

            for endpoint in endpoints:
                result = self._request("GET", endpoint)
                orders = result.get("value", [])
                if orders:
                    order = orders[0]
                    # جلب الـ Item Name من جدول الأصناف
                    item_code = order.get("ItemNo") or order.get("ItemCode")
                    if item_code:
                        item_details = self.get_item_details(item_code)
                        order["ItemName_SAP"] = item_details.get("item_name", item_code)

                    # جلب الـ Warehouse من السطر الأول
                    if order.get("ProductionOrderLines"):
                        first_line = order["ProductionOrderLines"][0]
                        order["WarehouseFromLine"] = first_line.get("WarehouseCode")

                    return order
            return None
        except Exception as e:
            print(f"Error: {e}")
            return None



    def get_intermediate_warehouses(self):
        """Auto-detect intermediate transit warehouses by keyword search."""
        result = self.get_warehouses()
        rows = result.get("value", []) if isinstance(result, dict) else []
        keywords = ["stock-in-transit", "transit", "تحت النقل", "وسيط"]
        
        matched = []
        for w in rows:
            code = w.get("WarehouseCode")
            name = w.get("WarehouseName") or ""
            inactive = w.get("Inactive") == "tYES" or w.get("Inactive") is True
            
            if not code:
                continue
                
            is_match = False
            for kw in keywords:
                if kw in code.lower() or kw in name.lower():
                    is_match = True
                    break
            
            if is_match:
                matched.append({
                    "code": code,
                    "name": name,
                    "inactive": inactive
                })
        return matched

    def get_tax_codes(self, category="purchase"):
        """
        Fetch valid Tax Codes from SAP Service Layer VatGroups.
        Filtered by:
          - Category eq 'bovcInputTax' for Purchase / AP / GRPO
          - Category eq 'bovcOutputTax' for Sales / AR documents
          - Inactive eq 'tNO' (Active tax codes only)
        """
        sap_category = "bovcOutputTax" if category == "sales" else "bovcInputTax"
        endpoint = (
            f"VatGroups?$filter=Category eq '{sap_category}' and Inactive eq 'tNO'&$orderby=Code"
        )
        all_rows = []
        seen_endpoints = set()

        while endpoint:
            if endpoint in seen_endpoints:
                break
            seen_endpoints.add(endpoint)

            result = self._request("GET", endpoint)
            if not isinstance(result, dict) or result.get("error"):
                if all_rows:
                    break
                return result

            all_rows.extend(result.get("value", []))
            next_link = result.get("odata.nextLink") or result.get("@odata.nextLink")
            if next_link:
                if next_link.startswith("http"):
                    endpoint = next_link.split("/b1s/v2/")[-1]
                else:
                    endpoint = next_link.lstrip("/")
            else:
                endpoint = None

        return {"value": all_rows}

    # ========== Sales Documents (READ-ONLY) ==========
    #
    # SAP Business One table mapping enforced for this module:
    #   Sales Quotation -> OQUT (header) / QUT1 (lines)  -> Service Layer `Quotations`
    #   Sales Order     -> ORDR (header) / RDR1 (lines)  -> Service Layer `Orders`
    #   Delivery        -> ODLN (header) / DLN1 (lines)  -> reference only, NOT read here
    #
    # Every method in this section issues `GET` only. No POST / PATCH / PUT / DELETE is
    # ever used against Quotations or Orders, and no SQLQueries handler is registered or
    # executed (registering one would require a SAP write).

    SALES_QUOTATION_ENTITY = "Quotations"
    SALES_ORDER_ENTITY = "Orders"

    # Fields used for the header list view. Kept deliberately small and limited to
    # properties that exist on BOTH Quotations and Orders so one builder serves both.
    # NOTE: `DocStatus` is deliberately absent. SAP B1 rejects it on a Document
    # entity ("Property 'DocStatus' of 'Document' is invalid"), so the integer
    # legacy status column is not selectable through Service Layer here.
    SALES_DOCUMENT_HEADER_FIELDS = (
        "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,"
        "ContactPersonCode,DocumentStatus,DocCurrency,DocTotal,DocTotalFc"
    )

    # Last-resort minimal field set, used only if SAP rejects the full $select.
    SALES_DOCUMENT_FALLBACK_FIELDS = (
        "DocEntry,DocNum,DocDate,CardCode,CardName,DocumentStatus"
    )

    @staticmethod
    def _escape_odata_literal(value):
        """Escape a value for safe interpolation into an OData string literal."""
        return str(value).replace("'", "''")

    def _build_sales_document_filter(
        self,
        doc_date_from=None,
        doc_date_to=None,
        document_status=None,
        card_code=None,
    ):
        """Build an OData $filter for sales document collections.

        Only unambiguous comparisons are generated here. Nothing is defaulted or
        assumed: an omitted argument simply contributes no clause, so SAP applies
        no invented restriction.
        """
        clauses = []
        if doc_date_from:
            clauses.append(f"DocDate ge '{self._escape_odata_literal(doc_date_from)}'")
        if doc_date_to:
            clauses.append(f"DocDate le '{self._escape_odata_literal(doc_date_to)}'")
        if document_status:
            clauses.append(
                f"DocumentStatus eq '{self._escape_odata_literal(document_status)}'"
            )
        if card_code:
            clauses.append(f"CardCode eq '{self._escape_odata_literal(card_code)}'")
        return " and ".join(clauses)

    def get_local_currency(self):
        """Read company currency once per client; never assume a currency code."""
        if not getattr(self, "_sales_local_currency", None):
            result = self._request("GET", "CompanyService_GetAdminInfo")
            currency = result.get("LocalCurrency") if isinstance(result, dict) else None
            if not isinstance(currency, str) or not currency.strip():
                raise ValueError("SAP company local currency is unavailable.")
            self._sales_local_currency = currency.strip()
        return self._sales_local_currency

    def _read_sales_document_collection(
        self,
        entity,
        doc_date_from=None,
        doc_date_to=None,
        document_status=None,
        card_code=None,
        top=None,
        skip=None,
    ):
        """GET a single page of sales document headers.

        Returns the raw SAP envelope (`{value: [...]}`) or `{"error": ...}`, following
        the same contract as every other `SAPServiceLayer` read.
        """
        query_parts = [f"$select={self.SALES_DOCUMENT_HEADER_FIELDS}"]
        query_parts.append("$orderby=DocDate desc,DocNum desc")

        criteria = self._build_sales_document_filter(
            doc_date_from=doc_date_from,
            doc_date_to=doc_date_to,
            document_status=document_status,
            card_code=card_code,
        )
        if criteria:
            query_parts.insert(0, f"$filter={criteria}")

        if top is not None:
            query_parts.append(f"$top={int(top)}")
        if skip:
            query_parts.append(f"$skip={int(skip)}")

        endpoint = f"{entity}?{'&'.join(query_parts)}"
        result = self._request("GET", endpoint)

        # Defensive fallback: if SAP rejects any part of the request, retry once with the
        # minimal field set so a single unknown property cannot break the whole list.
        if isinstance(result, dict) and result.get("error"):
            print(
                f"[{entity}] select query failed, retrying with minimal fields: "
                f"{_safe_console_text(result.get('error'))}"
            )
            retry_parts = [f"$select={self.SALES_DOCUMENT_FALLBACK_FIELDS}"]
            retry_parts.append("$orderby=DocDate desc,DocNum desc")
            if criteria:
                retry_parts.insert(0, f"$filter={criteria}")
            if top is not None:
                retry_parts.append(f"$top={int(top)}")
            if skip:
                retry_parts.append(f"$skip={int(skip)}")
            result = self._request("GET", f"{entity}?{'&'.join(retry_parts)}")

        # Respect SAP's server page cap while filling only this bounded page.
        if isinstance(result, dict) and not result.get("error") and top is not None:
            rows = list(result.get("value") or [])
            seen = set()
            link = result.get("@odata.nextLink") or result.get("odata.nextLink")
            while link and len(rows) < int(top):
                from urllib.parse import urlparse
                parsed = urlparse(link)
                if parsed.scheme:
                    base = getattr(self, "base_url", "").rstrip("/") + "/"
                    if not link.startswith(base):
                        return {"error": "Invalid SAP sales document continuation."}
                    continuation = link[len(base):]
                else:
                    continuation = link.lstrip("/")
                    if "/" in continuation.split("?", 1)[0]:
                        continuation = continuation.rsplit("/", 1)[-1]
                if continuation.split("?", 1)[0] != entity or continuation in seen:
                    return {"error": "Invalid SAP sales document continuation."}
                seen.add(continuation)
                following = self._request("GET", continuation)
                if not isinstance(following, dict) or following.get("error"):
                    return following
                batch = following.get("value") or []
                if not batch:
                    return {"error": "Empty SAP sales document continuation."}
                rows.extend(batch)
                link = following.get("@odata.nextLink") or following.get("odata.nextLink")
            result = dict(result, value=rows)
            result.pop("@odata.nextLink", None)
            result.pop("odata.nextLink", None)
            if link:
                result["@odata.nextLink"] = link

        return result

    def _read_sales_document_detail(self, entity, doc_entry):
        """GET one sales document including its document lines.

        SAP returns `DocumentLines` inline on a single-entity GET. Note that
        `$expand=DocumentLines` is NOT valid for this entity type and SAP
        rejects it, so no $expand is attempted here.
        """
        return self._request("GET", f"{entity}({doc_entry})")

    def get_sales_quotations(
        self,
        doc_date_from=None,
        doc_date_to=None,
        document_status=None,
        card_code=None,
        top=None,
        skip=None,
    ):
        """Read-only list of Sales Quotations (SAP `Quotations`, table OQUT)."""
        return self._read_sales_document_collection(
            self.SALES_QUOTATION_ENTITY,
            doc_date_from=doc_date_from,
            doc_date_to=doc_date_to,
            document_status=document_status,
            card_code=card_code,
            top=top,
            skip=skip,
        )

    def get_sales_quotation(self, doc_entry):
        """Read-only detail of one Sales Quotation including its QUT1 lines."""
        return self._read_sales_document_detail(self.SALES_QUOTATION_ENTITY, doc_entry)

    def get_sales_orders(
        self,
        doc_date_from=None,
        doc_date_to=None,
        document_status=None,
        card_code=None,
        top=None,
        skip=None,
    ):
        """Read-only list of Sales Orders (SAP `Orders`, table ORDR)."""
        return self._read_sales_document_collection(
            self.SALES_ORDER_ENTITY,
            doc_date_from=doc_date_from,
            doc_date_to=doc_date_to,
            document_status=document_status,
            card_code=card_code,
            top=top,
            skip=skip,
        )

    def get_sales_order(self, doc_entry):
        """Read-only detail of one Sales Order including its RDR1 lines."""
        return self._read_sales_document_detail(self.SALES_ORDER_ENTITY, doc_entry)
