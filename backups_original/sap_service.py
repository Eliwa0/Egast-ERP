import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests
import urllib3

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


class SAPServiceLayer:
    def __init__(self):
        self.base_url = _required_env("SAP_BASE_URL").rstrip("/")
        self.company_db = _required_env("SAP_COMPANY_DB")
        self.username = _required_env("SAP_USERNAME")
        self.password = _required_env("SAP_PASSWORD")
        self.verify_ssl = _env_bool("SAP_VERIFY_SSL", True)
        if not self.verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        self.session_id = None

    def login(self):
        url = f"{self.base_url}/Login"
        payload = {
            "CompanyDB": self.company_db,
            "UserName": self.username,
            "Password": self.password,
        }
        print("Logging in to SAP...")
        try:
            response = requests.post(url, json=payload, verify=self.verify_ssl, timeout=30)
            if response.status_code == 200:
                self.session_id = response.cookies.get("B1SESSION")
                print("SAP login successful.")
                return True
            else:
                raise Exception(f"Login failed: {response.status_code}")
        except Exception as e:
            print(f"SAP connection error: {str(e)}")
            raise

    def _request(self, method, endpoint, data=None):
        if not self.session_id:
            self.login()
        url = f"{self.base_url}/{endpoint}"
        headers = {"Cookie": f"B1SESSION={self.session_id}"}
        try:
            response = requests.request(
                method, url, json=data, headers=headers, verify=self.verify_ssl, timeout=30
            )
            if response.status_code == 401:
                print("Session expired, logging in again...")
                self.login()
                return self._request(method, endpoint, data)
            if response.status_code == 204:
                return {}
            return response.json()
        except Exception as e:
            print(f"Request error: {str(e)}")
            return {"error": str(e)}

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
        response = requests.post(first_url, json={}, headers=headers, verify=self.verify_ssl, timeout=30)
        if response.status_code == 401:
            self.login()
            headers["Cookie"] = f"B1SESSION={self.session_id}"
            response = requests.post(first_url, json={}, headers=headers, verify=self.verify_ssl, timeout=30)
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
            resp = requests.get(url, headers=headers, verify=self.verify_ssl, timeout=30)
            if resp.status_code == 401:
                self.login()
                headers["Cookie"] = f"B1SESSION={self.session_id}"
                resp = requests.get(url, headers=headers, verify=self.verify_ssl, timeout=30)
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

            response = requests.post(
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
            return {
                "item_code": item_code,
                "item_name": item_name,
                "price": price,
                "uom": result.get("SalesUnit", "PCS"),
                "uom_name": result.get("UoMName", "Piece"),
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
            response = requests.get(
                url,
                headers=headers,
                verify=self.verify_ssl,
                timeout=30,
            )

            if response.status_code == 401:
                self.login()
                headers["Cookie"] = f"B1SESSION={self.session_id}"

                response = requests.get(
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
        safe_whs = str(warehouse_code).replace("'", "''")
        endpoint = (
            f"BinLocations?$select=AbsEntry,BinCode,Warehouse"
            f"&$filter=Warehouse eq '{safe_whs}'"
            f"&$top=500"
        )
        result = self._request("GET", endpoint)
        return {"value": result.get("value", [])}

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
        return self._request("POST", f"SQLQueries('{sql_code}')/List", payload)


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
                response = requests.get(url, headers=headers, verify=self.verify_ssl, timeout=30)
                if response.status_code == 401:
                    self.login()
                    headers["Cookie"] = f"B1SESSION={self.session_id}"
                    response = requests.get(url, headers=headers, verify=self.verify_ssl, timeout=30)
                
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
                response = requests.get(url, headers=headers, verify=self.verify_ssl, timeout=30)
                if response.status_code == 401:
                    self.login()
                    headers["Cookie"] = f"B1SESSION={self.session_id}"
                    response = requests.get(url, headers=headers, verify=self.verify_ssl, timeout=30)
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
        """GET Items with ItemWarehouseInfoCollection expanded — no SQL registration."""
        safe = str(item_code).replace("'", "''")
        endpoint = (
            f"Items('{safe}')"
            "?$select=ItemCode,ItemName,InvntryUom,SalesUnit"
            "&$expand=ItemWarehouseInfoCollection"
        )
        return self._request("GET", endpoint)

    # ========== Logout ==========
    def create_stock_transfer(self, payload):
        return self._request("POST", "StockTransfers", payload)

    def logout(self):
        if self.session_id:
            endpoint = "Logout"
            headers = {"Cookie": f"B1SESSION={self.session_id}"}
            try:
                requests.post(
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
