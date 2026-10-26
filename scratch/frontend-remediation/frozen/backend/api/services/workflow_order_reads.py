"""Bounded, read-only SAP batches for filtering the full workflow candidate set."""
from urllib.parse import urlencode


def read_candidate_orders(sap, entries):
    entries = list(dict.fromkeys(entries))
    result = {}
    for start in range(0, len(entries), 50):
        batch = entries[start:start + 50]
        offset = 0
        while offset < len(batch):
            endpoint = 'Orders?' + urlencode({'$filter': ' or '.join(f'DocEntry eq {entry}' for entry in batch),
                '$select': 'DocEntry,DocNum,DocCurrency,DocTotal,DocTotalFc,DocDate,DocumentStatus,DocumentLines',
                '$orderby': 'DocEntry asc', '$top': len(batch)-offset, '$skip': offset})
            try:
                response = sap._request('GET', endpoint)
            except Exception:
                break  # Existing per-document read/fallback handles missing or unavailable entries.
            if not isinstance(response, dict) or response.get('error'):
                break
            rows = response.get('value')
            if not isinstance(rows, list) or not rows:
                break
            for row in rows:
                if isinstance(row, dict) and str(row.get('DocEntry', '')).isdigit():
                    entry = int(row['DocEntry'])
                    if entry in batch:
                        result[entry] = row
            offset += len(rows)
            if not (response.get('odata.nextLink') or response.get('@odata.nextLink')):
                break
    return result
