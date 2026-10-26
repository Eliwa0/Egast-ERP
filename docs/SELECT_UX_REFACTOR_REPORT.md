# Project-wide Select UX audit and implementation

The baseline inventory reviewed 116 source field templates in 33 files: 112 visible templates and 4 hidden compatibility selects. Repeated rows and conditional render instances are counted once per source template. Expected option counts in the inventory are planning ranges, not measured SAP catalog sizes.

## Final classification

| Type | Visible templates | Implementation |
|---|---:|---|
| Standard Dropdown | 42 | 33 SearchableSelect fields converted across 16 files; 9 existing native selects preserved. Includes status, stages, roles, permission levels, fixed scale connection settings, UOM, shipping types and operational choices. |
| Searchable Dropdown | 49 | Warehouse/bin/user remote controls now browse initially; local searchable catalogs keep their existing options/loaders. Two direct MUI item-group implementations now open on focus. |
| Server-side Autocomplete | 14 | Large customer, supplier, item and batch catalogs retain name/code search with 300ms debounce, 25-row pages and scoped caching. |
| Location / General exception | 6 | Existing local searchable controls and sources preserved. |
| Receipt bin-card exception | 1 | ReceiptWizard was concurrently changed after the baseline audit to its existing searchable bin cards. Preserved that change; verified its bin-code selection contract. |
| Hidden compatibility selects | 4 | Unchanged; excluded from visible totals. |

The full field-level baseline is [SELECT_UX_INVENTORY.md](SELECT_UX_INVENTORY.md), with machine-readable detail in [SELECT_UX_INVENTORY.json](SELECT_UX_INVENTORY.json). Baseline source line numbers predate import insertion and concurrent workspace changes.

## Selection and loading behavior

- StandardDropdown supports native single selection and a finite MUI multi-select; all choices are available immediately without a search input. It retains the existing children/event and options/value callback contracts and string-valued selections.
- Existing shared searchable adapters are reused for browseable and large catalogs. Warehouse/bin/user requests occur on opening; an empty or one-character query is allowed for these browseable sources. Large catalogs retain the two-character guard.
- Remote requests carry lookup=1, limit=25 and offset. Initial browsing also carries initial=1 and browse=1. Scroll loads the next page; keyboard navigation, selected labels and raw object metadata are retained.
- Cache keys include user/permissions, endpoint, parent parameters, query and offset. Pending calls are deduplicated; failures are not cached. Parent changes reset search context and prevent stale results from crossing warehouse/item-group scopes.
- Real loading, empty and error states remain visible. Retry is available inside the empty/error popup as well as below the input because the popup can cover helper buttons.
- Warehouse ACL, user module-level eligibility and bin warehouse/status metadata are preserved. Pagination happens after user eligibility filtering. No bin is automatically selected by this refactor.
- SAP master-data read queries use bounded $top/$skip; customer and sales-item pagination preserves addresses, payment terms, price lists, prices and UOM metadata. No SAP posting payload is changed.
- Exception: Delivery's batch inventory service retains its existing SAP SQL inventory retrieval and availability filtering; only its lookup response is paged. This work does not claim that the underlying inventory SQL query is server-paginated. No new full inventory load was introduced.

## Verification

| Check | Result |
|---|---|
| Isolated backend search/customer/delivery/policy/permissions suites | **162 passed** |
| Additional receipt payload/review, direct GRPO, quality submit and scale workflow regressions | **37 passed** |
| Frontend selection contracts | **Passed**: values/labels, page bounds, cache dedup, user/parent isolation, paging, metadata and invalid response handling |
| Existing search-cache tests | **8 assertions passed** |
| Transfer policy frontend contract | **26 assertions passed** |
| Transfer Policy Admin frontend contract | **157 assertions + 3 operational metadata assertions passed** |
| Module permissions, GRPO navigation, Stage 2 destination integrity, scale monitor | **Passed** |
| Existing outbound frontend checks | **20 passed** |
| Chrome shared-control test | **Passed**: finite/multiple choices, initial browsing, 25-row scrolling, keyboard, retry, selection retention, parent bins, name/code search, caching, object metadata, Location/General, RTL/dark/320px |
| Chrome Sales Quotation workflow | **Passed**: selected customer metadata, price-list scope, item price/UOM, empty/error states and cache |
| Chrome Transfer Configuration page | **59 checks passed**, including inactive/system bins, parent reset, errors, permissions and Arabic/dark/mobile |
| AST final verification | **115 select templates + 1 preserved bin-card picker passed** |
| i18n check | **Passed**, all 1,984 extracted keys resolve in Arabic and English |
| Production build | **Passed**, npm build exit=0 |

Backend tests use isolated in-memory SQLite and deny live SAP HTTP. Existing migrations are applied only to that isolated test database. Browser tests intercept every API request: these are rendered UI/contract tests, not live SAP integration tests. No operational database migration or SAP write was performed.

The custom browser fixture initially encountered a Vite 8 console-forwarding/HMR transport error. Final verification used a separate test-only Vite process with HMR and console forwarding disabled; application runtime exceptions remained asserted. No project Vite configuration was modified for this workaround.

An optional legacy printing script could not start its Chrome CDP connection at 127.0.0.1:9555 (ECONNREFUSED). It is not reported as passed. Printing code was not changed.

Lint: new helper/adapter code introduces no outstanding lint errors. The shared SearchableSelect retains 2 existing no-useless-escape errors in its unchanged bidi-label regex. The checked page set retains 14 unused-variable errors and 7 hook dependency warnings in ReceiptWizard, ReceiptReview, TransferReview, UserManagement and scale forms. These unrelated lines were not modified. The build retains the existing large-bundle warning; no unrelated lint/build refactor was made.

## Files changed for this task

Production files: 31 (17 page/form files, 10 shared frontend files, 4 backend read-only lookup files). Other dirty workspace files belong to earlier or concurrent work and are not claimed as part of this refactor.

### Page/form fields

- `frontend/src/components/quality/QualityWizardLayout.jsx`
- `frontend/src/modules/scale/components/WeighingStageForm.jsx`
- `frontend/src/modules/scale/pages/ScaleDevicesPage.jsx`
- `frontend/src/modules/scale/pages/ScaleDraftsPage.jsx`
- `frontend/src/modules/scale/pages/ScaleItemElementsPage.jsx`
- `frontend/src/pages/CreateUserPage.jsx`
- `frontend/src/pages/GRPOReviewPage.jsx`
- `frontend/src/pages/ItemCriteriaMappingPage.jsx`
- `frontend/src/pages/QualityCriteriaManagementPage.jsx`
- `frontend/src/pages/QualityReviewPage.jsx`
- `frontend/src/pages/ReceiptReviewPage.jsx`
- `frontend/src/pages/ReceiptWizard.jsx`
- `frontend/src/pages/SalesQuotationCreatePage.jsx`
- `frontend/src/pages/TransferPolicyPage.jsx`
- `frontend/src/pages/TransferReviewPage.jsx`
- `frontend/src/pages/TransferRulesPage.jsx`
- `frontend/src/pages/UserManagementPage.jsx`

### Shared frontend controls and loading

- `frontend/src/components/ui/StandardDropdown.jsx`
- `frontend/src/components/ui/selectOptions.js`
- `frontend/src/components/ui/SearchableSelect.jsx`
- `frontend/src/components/ui/RemoteAutocomplete.jsx`
- `frontend/src/components/ui/SearchableSelect.css`
- `frontend/src/hooks/useRemoteOptions.js`
- `frontend/src/services/remoteOptions.js`
- `frontend/src/services/searchCache.js`
- `frontend/src/services/masterDataSearch.js`
- `frontend/src/i18n/searchTranslations.js`

### Backend lookup reads only

- `backend/api/services/master_data_search.py`
- `backend/api/views.py`
- `backend/api/customization_views.py`
- `backend/api/delivery_views.py`

### Audit and verification

- `backend/api/tests_master_data_search.py`
- `frontend/scripts/audit-select-ux.mjs`
- `frontend/scripts/test-select-ux.mjs`
- `frontend/scripts/test-select-ux-browser.py`
- `frontend/scripts/fixtures/select-ux-harness.jsx`
- `frontend/scripts/test-transfer-policy-ui.py`

Audit artifacts: `docs/SELECT_UX_INVENTORY.md`, `docs/SELECT_UX_INVENTORY.json`, and this report.

No business rules, SAP document payloads, backend validation, permissions or database models were changed by this task. Saved value bindings and callback contracts remain unchanged.
