"""Durable SAP posting intents using the existing AuditLog table; no schema change.

There is never an automatic second POST after an uncertain outcome. Replays
return a persisted SAP response or perform an exact, read-only correlation lookup.
"""
import hashlib
import json
import uuid
from copy import deepcopy

from django.contrib.auth.models import User
from django.db import transaction, OperationalError
from api.models import AuditLog


class PostingPending(Exception):
    pass


class SalesPostingJournal:
    ACTION = 'SALES_POST_INTENT'

    def __init__(self, user, sap, entity, key=None):
        self.user, self.sap, self.entity, self.key = user, sap, entity, key
        self.company = hashlib.sha256(f'{sap.base_url}|{sap.company_db}'.encode()).hexdigest()[:24]

    def scope(self):
        records = AuditLog.objects.filter(action=self.ACTION, module=self.company, entity_type=self.entity)
        return records.filter(user=self.user) if self.entity == 'Quotations' and not str(self.key or '').startswith('draftquote-') else records

    def post(self, payload, request=None, send=None):
        try:
            return self._post(payload, request, send)
        except OperationalError as error:
            raise PostingPending('Posting verification storage is busy or unavailable; no automatic new posting will be sent. Check document status again.') from error

    def _post(self, payload, request=None, send=None):
        canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str)
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        key = self.key or fingerprint
        if len(key) > 80 or not key or any(c not in '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_' for c in key):
            raise ValueError('Invalid posting request identifier.')
        with transaction.atomic():
            # Serializes intent creation per authenticated actor across workers.
            # SQLite write contention fails closed before any SAP POST.
            User.objects.select_for_update().get(pk=self.user.pk)
            if self.entity == 'Orders' or str(key).startswith('draftquote-'):
                from api.models_customization import CustomizationDraft
                CustomizationDraft.objects.select_for_update().get(pk=int(key.split('-', 1)[1]))
            record = self.scope().filter(entity_id=key).order_by('-id').first()
            if record and record.details['fingerprint'] != fingerprint:
                raise ValueError('This posting identifier belongs to different document data.')
            if not record:
                # A new browser token must not bypass a still-uncertain identical intent.
                pending = self.scope().filter(details__fingerprint=fingerprint).order_by('-id').first()
                if pending and pending.details['state'] == 'VERIFYING':
                    record = pending
            fresh = record is None
            if fresh:
                marker = f'[AppPost:{uuid.uuid4().hex}]'
                if len(f"{payload.get('Comments') or ''} {marker}".strip()) > 254:
                    raise ValueError('Comments must leave space for the SAP posting verification reference (maximum 211 characters).')
                record = AuditLog.objects.create(user=self.user, username=self.user.username,
                    action=self.ACTION, module=self.company, entity_type=self.entity, entity_id=key,
                    status=AuditLog.STATUS_WARNING, description='SAP document posting intent',
                    details={'state': 'VERIFYING', 'fingerprint': fingerprint, 'marker': marker,
                             'payload': payload, 'request': request or {}})
        self.record = record
        if not fresh:
            if record.details['state'] == 'CONFIRMED':
                return deepcopy(record.details['result'])
            if record.details['state'] == 'REJECTED':
                return deepcopy(record.details['result'])
            return self.reconcile(record)
        outbound = deepcopy(payload)
        outbound['Comments'] = f"{payload.get('Comments') or ''} {record.details['marker']}".strip()
        try:
            result = send(outbound) if send else self.sap._request('POST', self.entity, outbound)
        except Exception as error:
            # The request might have reached SAP. Leave the durable intent pending.
            raise PostingPending('Checking document status in SAP; no new posting will be sent.') from error
        if isinstance(result, dict) and result.get('DocEntry') and not result.get('error'):
            self.confirm(record, result)
        elif isinstance(result, dict) and isinstance(result.get('error'), dict):
            self.update(record, state='REJECTED', result=result)
        else:
            raise PostingPending('Checking document status in SAP; no new posting will be sent.')
        return result

    def update(self, record, **values):
        with transaction.atomic():
            User.objects.select_for_update().get(pk=self.user.pk)
            details = {**record.details, **values}
            AuditLog.objects.create(user=self.user, username=self.user.username,
                action=self.ACTION, module=self.company, entity_type=self.entity,
                entity_id=record.entity_id, status=AuditLog.STATUS_SUCCESS if values.get('state') == 'CONFIRMED' else AuditLog.STATUS_WARNING,
                description='SAP posting verification outcome', details=details)
            record.details = details

    def confirm(self, record, result):
        self.update(record, state='CONFIRMED', result=result)

    def reconcile(self, record):
        marker = record.details['marker']
        # Marker is generated internally; never interpolate customer-supplied filters.
        try:
            response = self.sap._request('GET', f"{self.entity}?$filter=contains(Comments,'{marker}')&$top=2")
        except Exception as error:
            raise PostingPending('Checking document status in SAP; no new posting will be sent.') from error
        candidates = response.get('value', []) if isinstance(response, dict) and not response.get('error') else []
        if len(candidates) != 1:
            raise PostingPending('Checking document status in SAP; no new posting will be sent.')
        try:
            result = self.sap._request('GET', f"{self.entity}({int(candidates[0]['DocEntry'])})")
        except Exception as error:
            raise PostingPending('Checking document status in SAP; no new posting will be sent.') from error
        expected = record.details['payload']
        if not isinstance(result, dict) or result.get('error') or marker not in str(result.get('Comments') or ''):
            raise PostingPending('Checking document status in SAP.')
        if result.get('CardCode') != expected['CardCode'] or result.get('DocCurrency') != expected.get('DocCurrency'):
            raise PostingPending('SAP correlation does not match this document.')
        actual_lines = result.get('DocumentLines') or []
        expected_lines = expected['DocumentLines']
        keys = ['ItemCode', 'Quantity', 'UnitPrice', 'WarehouseCode', 'BaseType', 'BaseEntry', 'BaseLine']
        if len(actual_lines) != len(expected_lines) or any(
            any(str(a.get(k)) != str(e[k]) and a.get(k) != e[k] for k in keys if k in e)
            for a, e in zip(actual_lines, expected_lines)):
            raise PostingPending('SAP document lines do not match this posting intent.')
        self.confirm(record, result)
        return result
