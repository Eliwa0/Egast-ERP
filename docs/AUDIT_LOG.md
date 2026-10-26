# Audit logging convention

## Purpose and boundary

`api.models.AuditLog` is the application-wide, append-only record of meaningful state changes. It complements, but does not replace, the detailed SAP posting-attempt tables used by GRPO and Purchase Quotation posting services. Read-only lookups, SAP preview/validation calls, polling, simulator input, cache refreshes, and high-volume raw scale telemetry are intentionally not application audit events.

The implementation is explicit. There is no global request logger: each mutating endpoint either records a domain-rich event with `log_action()` or opts into the reusable `@audit_mutation(...)` endpoint wrapper.

## Event schema

Every event uses these fields:

- `user`: nullable actor foreign key. It becomes `NULL` if the account is deleted.
- `username`: immutable actor-name snapshot, retained across account rename/deletion. Empty means a system actor.
- `module` and `action`: normalized uppercase strings. They are intentionally open-ended so new modules/actions do not require schema or UI changes.
- `entity_type` and `entity_id`: stable target reference where available.
- `description`: concise human-readable outcome.
- `status`: `SUCCESS`, `FAILED`, or `WARNING`.
- `details`: sanitized structured metadata; updates should use `before`/`after` objects when a meaningful diff is available.
- `ip_address`: validated client address when available.
- `created_at`: timezone-aware server timestamp.

Audit rows reject instance updates and deletes. The public API exposes only GET list/detail methods and is guarded by the same user-management authorization used by the Users admin UI.

## Canonical interfaces

Use a rich explicit event when the domain identifiers/outcome are known:

```python
from api.services.audit_service import log_action, MODULE_TRANSFER, ACTION_POST

log_action(
    request=request,
    action=ACTION_POST,
    module=MODULE_TRANSFER,
    entity_type="PendingTransferRequest",
    entity_id=transfer.id,
    description=f"Posted transfer PTR-{transfer.id}",
    details={
        "before": {"status": "PENDING"},
        "after": {"status": "POSTED", "sap_doc_num": transfer.sap_doc_num},
    },
)
```

If the business mutation is inside `transaction.atomic()`, schedule its success event only after commit:

```python
from api.services.audit_service import log_action_on_commit

with transaction.atomic():
    obj.save()
    log_action_on_commit(
        request=request,
        action="UPDATE",
        module="RULES",
        entity_type="ExampleRule",
        entity_id=obj.id,
        description="Updated example rule",
        details={"before": before, "after": after},
    )
```

Record a failure with `log_action()` only after the failed transaction has exited. Never label a rolled-back mutation as successful.

For conventional CRUD endpoints without richer domain metadata, explicitly decorate the endpoint after its authorization decorator:

```python
@api_view(["GET", "PATCH"])
@require_module_admin
@audit_mutation(
    module="EXAMPLE",
    entity_type="ExampleRule",
    action="UPDATE",
    methods=("PATCH",),
)
def example_detail(request, rule_id):
    ...
```

The wrapper records sanitized request data, HTTP method/path/status, URL identifiers, failures, and uncaught exception type. It schedules successful events with `transaction.on_commit()` and writes failed responses immediately. Do not combine it with a manual event for the same method/outcome.

When an endpoint already emits a rich success event, add the wrapper with `log_success=False` to capture failed responses and exceptions without duplicating successful activity.

## Sensitive-data rules

`sanitize_details()` recursively traverses dictionaries and arbitrarily nested lists/tuples/sets. Keys containing password, token, secret, cookie, session, authorization, CSRF, credit-card, or credential markers are replaced by `[REDACTED]`. Sanitization applies to both direct calls and endpoint-wrapper request metadata.

Never put raw passwords, tokens, cookies, authorization headers, full SAP credentials, or secret values in `description`, because descriptions are prose rather than structured metadata. Prefer identifiers and non-sensitive outcome summaries. Audit writes are fail-safe: storage failure is logged server-side and must not interrupt the business operation.

## Adding a new module or mutation

1. Decide whether the operation creates, updates, deletes, posts, approves, rejects, cancels, reserves, releases, occupies, vacates, configures, or weighs state.
2. Add a module/action constant only when reuse improves consistency; schema changes are not required.
3. Add one explicit audit integration at the authorized mutation boundary.
4. Include actor, target identifier, outcome, and meaningful `before`/`after` values. Do not duplicate an existing event from a lower service layer.
5. Use `log_action_on_commit()` for success inside atomic work; log failures after rollback.
6. Add a focused test proving exactly one event, correct metadata/status, sanitization, and transaction behavior.
7. Confirm the Activity Log page displays the raw new module/action string and receives it in the API-provided filter options.

## Current coverage map

- Authentication and user administration: login success/failure, logout, create/update/reset/activate/delete users.
- Transfer and cold storage: create/edit/cancel/post/bulk post transfers; reserve/release/occupy/vacate positions; configure bins.
- Rules and permissions: transfer warehouse, production-order, user, warehouse, attribute, and visibility rule mutations.
- Production receipts and batches: direct/legacy SAP receipt posting, pending creation/approval/rejection, reservation, batch edits/bulk edits/delete/duplicate, order changes, and extra quantities.
- Quality: inspection create/approve/reject/delete/bulk actions and quality master-data/category/stage/criterion/mapping mutations.
- GRPO and Purchase Quotation: manual/draft create/update/approve/cancel/post operations. Preview-only validation is excluded; dedicated posting-attempt tables remain available for transport-level diagnostics.
- Scale: device, vehicle/movement, tare element, draft weight/element/allocation/send/cancel, receipt, and permit mutations. Raw device ingestion and simulator input are operational telemetry and intentionally excluded.

## Read API and UI

`GET /api/audit-log/` supports search plus module, action, status, actor, entity, date, and bounded pagination filters. `GET /api/audit-log/<id>/` returns a single event. Unsupported mutation methods return 405. Both routes use the backend user-management guard; `/users/activity-log` uses `RequireAuth` with `canManageUsers` as a convenience/UI boundary, while backend authorization remains authoritative.

The frontend obtains module/action filter choices from the API and renders raw strings with a neutral fallback badge, so future values remain visible without a frontend release.
