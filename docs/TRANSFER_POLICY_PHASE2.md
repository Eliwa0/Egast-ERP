# Transfer policies: Phase 2

The existing `TransferPolicyResolver` resolves each stage independently. An ACTIVE
revision for the current SAP endpoint and company overrides legacy configuration
for that stage. Other stages keep their legacy environment/discovery behavior.
`TransferWarehouseRule` still controls authorization independently of the policy.

## Storage and company boundary

`TransferPolicyRevision` stores one stage revision with validated JSON intent.
The scope uses the same endpoint hash plus SAP company DB identity as the SAP
master-data cache namespace. Usernames, passwords and session cookies are absent.
There is no company table, simultaneous tenancy, master-data replication or seed
data. A database constraint permits one ACTIVE revision per scope/stage.

States are DRAFT, ACTIVE and DISABLED. ACTIVE revisions are immutable: create a
new draft to change configuration. Activation disables the previous active
revision atomically. DISABLED removes the override and restores legacy fallback;
an ACTIVE policy with `enabled: false` explicitly blocks that stage instead.
Lifecycle conflicts fail without leaving two active revisions. No operation edits
pending transfers, Receipt records, Batch records or physical occupancy.

## Admin API

All these endpoints use the existing Transfer Admin/Super Admin guard and existing
AuditLog infrastructure. Regular Transfer users cannot review or manage policies.

| Method | Endpoint | Operation |
|---|---|---|
| GET | `/api/transfer/policies/effective/` | Effective resolver response, including each stage's source |
| GET | `/api/transfer/policies/` | Current company's revisions |
| POST | `/api/transfer/policies/` | Create draft with `stage_key` and `configuration` |
| GET | `/api/transfer/policies/{id}/` | Review revision |
| PATCH | `/api/transfer/policies/{id}/` | Replace a draft's entire `configuration` |
| POST | `/api/transfer/policies/{id}/activate/` | Validate fresh SAP data and activate; empty body |
| POST | `/api/transfer/policies/{id}/disable/` | Disable override; empty body |

Scope, stage revision numbers and lifecycle state are server-owned. Creating and
editing drafts return `activation_errors` for incomplete or future capabilities.
Invalid explicit warehouse/bin mappings are rejected even for drafts. Activation
rejects incomplete configuration and unsupported execution capabilities.

Minimal Stage 1 configuration (illustrative codes, never automatically seeded):

```json
{
  "stage_key": "STAGE_1_TO_INTERMEDIATE",
  "configuration": {
    "enabled": true,
    "route_pairs": [{"from_warehouse": "PRODUCTION", "to_warehouse": "INTERMEDIATE"}]
  }
}
```

Optional fields match Phase 1: `label`, `description`, `source_bin_policy`,
`destination_bin_policy`, `source_position_required`,
`destination_position_policy`, `physical_effect`, and `quantity_policy`.
Additional mapping fields are `allowed_source_bins`, `allowed_destination_bins`,
`source_physical_purpose` and `destination_physical_purpose`. Each bin map is a
warehouse code mapped to a list of `{"bin_code": "EXACT", "abs_entry": 123}`.
AbsEntry is optional on input and pinned from the verified SAP record on save.
Purposes are explicit `cold_storage`, `shipping_dock`, or `none`; names never
establish purpose. Stage 2 routes also require `destination_type` of `fridge` or
`intermediate`. BOTH is exclusively an authorization value, never a stage.

Activation supports existing stage execution capabilities only. Stage 1 cannot
allocate bins. Stage 2 cold-storage destinations require explicitly selected,
active, non-system SAP bins and matching allocatable local layouts. Stage 3
supports the existing source-vacate behavior with an explicitly configured
cold-storage source. Future quantity/effect requirements may be saved as draft
intent but cannot activate. Quantity semantics remain unchanged.

## Fresh master-data validation

Validation uses existing paginated `get_bin_locations_by_warehouse` and the added
read-only exact `get_warehouse_details` SAP GET. `BinDiscoveryService` was inspected;
its display hierarchy and cached discovery are not used as activation authority.
There is no new cache. Failed/partial responses fail closed. Checks cover exact
warehouse code, active flags, bin enablement, exact bin code, parent, active flag,
AbsEntry, system status, enforced default-bin conflicts and physical layout linkage.
SAP defaults never substitute for an explicitly required bin.

## Pending movement contracts

New requests under an active policy store the resolved contract, company scope,
policy ID and revision in `raw_payload_json._transfer_policy`. Caller-supplied
snapshots are discarded on creation. Editing preserves the server-stored snapshot.
Posting checks the immutable revision and fresh SAP data, then validates the route
under the saved contract even if the revision has since been disabled/replaced.
Stale mappings are rejected; warehouse/bin substitution is forbidden.

Unsnapshotted historical requests retain legacy validation. They are not rewritten
or interpreted under a newly active persisted policy. Existing posting claim,
batch guard, reservations, definitive/ambiguous SAP failure handling and position
reconciliation remain unchanged; policy changes do not create new SAP postings.

## Shipping and rollout

Business confirms Cold Storage 20201 and Shipping warehouse 20202. The Shipping
Dock bin remains unconfirmed. No warehouse/bin policy is seeded. Stage 3 routes
to 20202 cannot activate in Phase 2, even if someone supplies a bin: arrival and
whole-pallet enforcement belong to the later physical implementation.

Migration 0059 creates only the policy table and constraints. It has no data
migration. Apply it after the deployment's existing migrations are independently
reconciled. Validation runs apply the complete migration chain to isolated test
databases; they do not upgrade the stale operational SQLite database.
Read-only inspection found 49 unapplied API migrations, with 0010 as its latest
applied API migration. Applying that backlog is a separate rollout step because
earlier migrations may change historical operational data.

Phase 3 is the Admin configuration UI and frontend consumption of persisted policy
metadata/readiness, including explicit selections and lifecycle/revision feedback.
Shipping Dock arrival, whole-pallet enforcement and Container Loading need separate
authorization and implementation; they are not supplied by policy persistence.

## Phase 2 files changed

- `backend/api/models_transfer_policy.py`
- `backend/api/models.py`
- `backend/api/migrations/0059_transfer_policy_revisions.py`
- `backend/api/services/persisted_transfer_policy_service.py`
- `backend/api/services/transfer_policy_service.py`
- `backend/api/services/transfer_service.py`
- `backend/api/services/sap_service.py`
- `backend/api/transfer_policy_views.py`
- `backend/api/urls.py`
- `backend/api/views.py`
- `backend/api/tests_persisted_transfer_policy.py`
- `backend/api/tests_transfer_policy.py`
- `docs/TRANSFER_POLICY_PHASE2.md`

## Verification

- 182 targeted backend tests passed, including 39 new persistence tests and the
  existing policy, permissions, physical integrity, outbound, creation/posting
  concurrency, reconciliation, cache isolation and Receipt regression suites.
- Live HTTP access was blocked in tests; all posting responses used test doubles.
- All five existing frontend Transfer suites passed.
- `makemigrations --check --dry-run` found no changes; Django system checks passed.
- Isolated migration forward, backward and reapply preserved every pre-existing
  table row, including historical pending-transfer and authorization fixtures.
  The policy table remained empty after migration; no seeds or backfills ran.
- Production build passed with existing dynamic-import and chunk-size warnings.
- No frontend files changed. Existing policy helper/client focused ESLint passed;
  full ESLint retained the Phase 1 baseline of 79 errors and 13 warnings across
  unrelated/current files, with zero Phase 2 additions.
- Existing Receipt `SimpleTestCase` audit warnings and invalid-escape warnings in
  `views.py` remain; the regression tests pass. These were not changed in Phase 2.
