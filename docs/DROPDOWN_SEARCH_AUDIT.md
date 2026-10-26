# Dropdown audit before implementation

Source-level inventory. Template loops can render many controls. Counts are source occurrences, not live instances. No business or posting changes authorized.

## Findings

- 111 Select/Autocomplete occurrences in 34 files, including the shared wrapper and four hidden Quality compatibility selects.
- Dynamic SAP master data must use bounded server search; old endpoints remain compatible.
- Cost-center dimensions 1 (Location) and 2 (General), six visible selector templates, are explicitly exempt. Their shared loader and endpoints remain unchanged.
- Item groups, inspection stages/categories, tax codes, currencies, UOM/UDF valid values, status/roles and device configuration are finite configuration choices. Keep searchable local choices when small.
- Review/table filters derive options from records already needed to render the table; no additional catalog fetch is needed. Convert native dynamic filter controls to local searchable controls.
- Cold-storage maps require complete spatial data to render the map. Do not reduce that map dataset or change auto-assigned transfer routes. Dropdown search must preserve backend policy/access validation.
- Purchase Quotation eagerly fetches items for every group. Remove that fan-out; restore saved lines with exact item lookup rather than group scans.
- Sales customer search currently filters a full SAP customer cache on the backend. Move filtering/limit to SAP for the new lookup mode.

## API plan

| Data | Existing API | Required change |
|---|---|---|
| Warehouses | warehouses; transfer/warehouses | additive lookup/search/code/limit; preserve permissions |
| Bins | bin-locations/{warehouse} | additive scoped bounded search; retain parent/status/AbsEntry metadata |
| Vendors/contractors | quality/farms; quality/contractors; scale/master-data/farms | bounded SAP search within existing vendor groups |
| Items | quality/items; scale/master-data/items; customization-delivery/items | bounded group/prefix/price-list search and exact code restoration |
| Customers | customization-delivery/customers | bounded SAP search, complete selection metadata |
| Users | admin/users | bounded permission-scoped username/name search |
| Batches | customization-delivery/batches | preserve availability logic, bounded search in eligible batch result |
| Location/General | quality/cost-centers | no change |

## Every Select/Autocomplete occurrence

| File:line | Component | Decision |
|---|---|---|
| frontend\src\pages\ActivityLogPage.jsx:491 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\ActivityLogPage.jsx:506 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\ActivityLogPage.jsx:521 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\CreateUserPage.jsx:89 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\CreateUserPage.jsx:108 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\DeliveryCreateWizardPage.jsx:1263 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\DeliveryCreateWizardPage.jsx:1504 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\DeliveryCreateWizardPage.jsx:1825 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\DeliveryCreateWizardPage.jsx:1921 | SearchableSelect | EXEMPT Location/General: preserve loading and selection |
| frontend\src\pages\DeliveryCreateWizardPage.jsx:1937 | SearchableSelect | EXEMPT Location/General: preserve loading and selection |
| frontend\src\pages\DeliveryReviewPage.jsx:312 | select | Local searchable filter of already displayed records |
| frontend\src\pages\DeliveryReviewPage.jsx:327 | select | Local searchable filter of already displayed records |
| frontend\src\pages\DeliveryReviewPage.jsx:342 | select | Local searchable filter of already displayed records |
| frontend\src\pages\GRPOReviewPage.jsx:421 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\IssueReviewPage.jsx:1049 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\IssueWizard.jsx:1018 | select | Remote searchable master-data control |
| frontend\src\pages\ItemCriteriaMappingPage.jsx:46 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ItemCriteriaMappingPage.jsx:65 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ItemCriteriaMappingPage.jsx:148 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ItemCriteriaMappingPage.jsx:170 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ProductionOrderRulesPage.jsx:893 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\ProductionOrderRulesPage.jsx:1094 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\ProductionOrderRulesPage.jsx:1453 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:1718 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:1758 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:1783 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:1849 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:1873 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:2106 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:2138 | SearchableSelect | EXEMPT Location/General: preserve loading and selection |
| frontend\src\pages\PurchaseGRPODraftPage.jsx:2171 | SearchableSelect | EXEMPT Location/General: preserve loading and selection |
| frontend\src\pages\PurchaseQuotationDraftPage.jsx:1404 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\PurchaseQuotationDraftPage.jsx:1918 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\PurchaseQuotationDraftPage.jsx:1944 | SearchableSelect | EXEMPT Location/General: preserve loading and selection |
| frontend\src\pages\PurchaseQuotationDraftPage.jsx:1983 | SearchableSelect | EXEMPT Location/General: preserve loading and selection |
| frontend\src\pages\QualityCriteriaManagementPage.jsx:73 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\QualityCriteriaManagementPage.jsx:93 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\QualityCriteriaManagementPage.jsx:186 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\QualityCriteriaManagementPage.jsx:201 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\QualityReviewPage.jsx:673 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\QualityReviewPage.jsx:1225 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\ReceiptReviewPage.jsx:402 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ReceiptReviewPage.jsx:408 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ReceiptReviewPage.jsx:1891 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ReceiptReviewPage.jsx:2221 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ReceiptWizard.jsx:1834 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ReceiptWizard.jsx:1943 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\ReceiptWizard.jsx:2034 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesDocumentListPage.jsx:115 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesOrdersReviewPage.jsx:280 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:629 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\SalesQuotationCreatePage.jsx:779 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\SalesQuotationCreatePage.jsx:890 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1057 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1107 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1115 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1119 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1123 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1129 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1133 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1137 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationCreatePage.jsx:1200 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationsPage.jsx:704 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\SalesQuotationsReviewPage.jsx:288 | select | Keep local searchable/static/configuration choices |
| frontend\src\pages\TransferPolicyPage.jsx:48 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferPolicyPage.jsx:218 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferPolicyPage.jsx:222 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferPolicyPage.jsx:246 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\TransferPolicyPage.jsx:260 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\TransferReviewPage.jsx:540 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\TransferReviewPage.jsx:666 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferReviewPage.jsx:685 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferReviewPage.jsx:704 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferReviewPage.jsx:723 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferRulesPage.jsx:221 | SearchableSelect | Remote searchable master-data control |
| frontend\src\pages\TransferRulesPage.jsx:235 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\UserManagementPage.jsx:519 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\UserManagementPage.jsx:531 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\UserManagementPage.jsx:567 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\UserManagementPage.jsx:579 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\pages\UserManagementPage.jsx:650 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\transfer\pages\TransferPage.jsx:476 | SearchableSelect | Searchable policy-scoped workflow/map choices; retain required workflow bootstrap |
| frontend\src\modules\transfer\pages\TransferPage.jsx:500 | SearchableSelect | Searchable policy-scoped workflow/map choices; retain required workflow bootstrap |
| frontend\src\modules\transfer\pages\TransferPage.jsx:562 | SearchableSelect | Searchable policy-scoped workflow/map choices; retain required workflow bootstrap |
| frontend\src\modules\transfer\pages\TransferPage.jsx:781 | SearchableSelect | Searchable policy-scoped workflow/map choices; retain required workflow bootstrap |
| frontend\src\modules\transfer\pages\TransferPage.jsx:858 | SearchableSelect | Searchable policy-scoped workflow/map choices; retain required workflow bootstrap |
| frontend\src\modules\transfer\pages\TransferPage.jsx:934 | SearchableSelect | Searchable policy-scoped workflow/map choices; retain required workflow bootstrap |
| frontend\src\modules\scale\components\QuotationMatchingSection.jsx:355 | Autocomplete | Remote searchable master-data control |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:955 | Autocomplete | Remote searchable master-data control |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:989 | Autocomplete | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:1019 | Autocomplete | Remote searchable master-data control |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:1076 | Autocomplete | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:1106 | Autocomplete | Remote searchable master-data control |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:1860 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\components\WeighingStageForm.jsx:2315 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleDevicesPage.jsx:550 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleDevicesPage.jsx:851 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleDevicesPage.jsx:907 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleDevicesPage.jsx:956 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleDraftsPage.jsx:199 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleDraftsPage.jsx:235 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleItemElementsPage.jsx:228 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\modules\scale\pages\ScaleWeighingPage.jsx:989 | SearchableSelect | Keep local searchable/static/configuration choices |
| frontend\src\components\customization\CustomizationWorkflowPanel.jsx:342 | select | Keep local searchable/static/configuration choices |
| frontend\src\components\quality\QualityWizardLayout.jsx:1182 | Autocomplete | Keep local searchable/static/configuration choices |
| frontend\src\components\quality\QualityWizardLayout.jsx:1202 | select | Hidden compatibility element: no separate fetch |
| frontend\src\components\quality\QualityWizardLayout.jsx:1209 | Autocomplete | Remote searchable master-data control |
| frontend\src\components\quality\QualityWizardLayout.jsx:1236 | select | Hidden compatibility element: no separate fetch |
| frontend\src\components\quality\QualityWizardLayout.jsx:1330 | select | Hidden compatibility element: no separate fetch |
| frontend\src\components\quality\QualityWizardLayout.jsx:1341 | select | Hidden compatibility element: no separate fetch |
| frontend\src\components\ui\SearchableSelect.jsx:181 | Autocomplete | Shared wrapper: add optional remote mode; preserve local mode |

## Custom selection surfaces

- Quality FarmSelectionPanel: four usages (three contractor selection contexts and one farm context); receiving master-data searches become remote. Pre-export SAP UDF vendor valid-values remain finite metadata choices.
- Quality hidden vendor card grid: reuse remote farm results; no eager receiving farm catalog.
- Purchase Quotation vendor cards and item cards: replace with shared remote autocomplete.
- Item Criteria Mapping item list/search: remote bounded group search.
- Transfer Rules WarehouseChecklist: two usages; remote single warehouse selection retaining the existing one-source/one-destination rule.
- Receipt Wizard bin cards: one additional custom selection template, converted to remote search; preserve the existing warehouse-code prefix and AbsEntry mapping.
- ReceiptReview FilterDropdown and three datalist templates / ScaleDrafts datalist: options from displayed rows or finite batch metadata. Retain local filtering; no new dataset fetch.

## Baseline evidence

Actual running authenticated Chrome pages and JSON response bodies captured in scratch/dropdown-performance-before.json. Navigation DOMContentLoaded is not total data-ready time. Nine-second observation window can omit slower pending calls; do not claim omitted payloads as zero. Create User sends two full warehouse calls under React StrictMode: 186 records / 15,602 JSON bytes. Transfer Policy sends two 93-warehouse payloads: 18,764 bytes. Sales page eagerly sends two item calls (40 returned records / 14,802 bytes); source customer loader requests page_size=5000.

## Implemented result and counts

The 111 original standard-control occurrences are classified exhaustively in the table above: 29 remote master-data controls, 6 policy/map workflow controls, 62 small/configuration controls, 6 exempt Location/General controls, 3 local table filters, 4 hidden compatibility controls, and 1 shared implementation. Ten additional custom master-data selector usages were converted: Quality farm/contractor panels (4), Purchase Quotation vendor/item cards (2), Transfer Rules warehouse checklists (2), Item Criteria Mapping item list (1), Receipt Wizard bin cards (1).

- **45 master-data selector usages now use remote autocomplete** (35 standard occurrences plus 10 custom selector usages). Some were already visually autocomplete; their data loading was replaced.
- **62 original small/configuration controls retain local choices**. This includes existing local autocompletes as well as selects; it is not a count of native HTML selects alone.
- **6 Location/General templates remain exempt**, unchanged loaders, endpoints and selection semantics.
- **3 Delivery Review table filters now use local searchable autocomplete**, based on already displayed records.
- **5 additional local custom usages remain**: Receipt Review FilterDropdown, its three datalist templates, and the Scale Drafts datalist. They use displayed records/finite metadata and do not fetch another master catalog.
- **126 audited occurrences/usages**: the original 111 plus 10 remote custom selector usages plus 5 local custom usages. Also inspected an unreachable Quality vendor grid; it is not counted as an active selector. Counts are source/template counts, not quantities of controls rendered by loops.

After-implementation source sweep: `scratch/dropdown-audit-after.txt`; remaining fetch-call sweep: `scratch/dropdown-fetch-after.txt`. Old exported catalog helpers remain compatible for existing consumers/tests; converted dropdowns no longer invoke them.

## Final control/API mapping

| Pages/controls | Data/search mode | API |
|---|---|---|
| Create User; Quality Review; Production Rules; Transfer Rules warehouse choices | Server search, warehouse code/name | `/api/warehouses/` |
| Transfer Policy source/destination | Server search; inactive/unknown status remains unselectable | `/api/warehouses/?policy_options=true` |
| Transfer execution; Transfer Review source/destination | Server search; existing policy/access validation remains | `/api/transfer/warehouses/` and `/api/warehouses/` respectively |
| Receipt Wizard; Issue Wizard; GRPO; Delivery; Transfer Review; Transfer Policy; Transfer execution bins | Warehouse-scoped server search; code/description plus AbsEntry/status/parent metadata | `/api/bin-locations/{warehouse}/` |
| GRPO; Purchase Quotation; Receiving Quality farm/vendor | Server search within existing supplier groups | `/api/quality/farms/` |
| Quality contractor panels | Server search within existing contractor group | `/api/quality/contractors/` |
| GRPO; Purchase Quotation; Receiving Quality item; Item Criteria Mapping item | Server search within selected group | `/api/quality/items/` |
| Scale vendor and quotation matching farm | Server search, existing supplier groups | `/api/scale/master-data/farms/` |
| Scale item selectors | Server search, existing receiving prefix/group; free-text entry retained | `/api/scale/master-data/items/` |
| Sales Quotation customer | SAP-side filter/limit; selected result retains addresses, currency, payment terms and price list | `/api/customization-delivery/customers/` |
| Sales Quotation item | SAP-side filter/limit; customer price-list context, price/UOM/tax metadata retained | `/api/customization-delivery/items/` |
| Production Rules and Transfer Rules user | Database search on username/name; canonical module USER filter before result limit | `/api/admin/users/` |
| Delivery batch | Server search and limit over existing eligible item/warehouse inventory; quantity/duplicate-allocation constraints retained | `/api/customization-delivery/batches/` |
| Location/General | Existing full/local choice behavior, explicitly exempt | `/api/quality/cost-centers/?dimension=1|2` |
| Status/roles/document types/configuration; finite item groups, tax codes, currencies, UOM/UDF values, scale devices/COM/baud | Local choices, no remote search required | Existing configuration/metadata APIs |
| Delivery Review and Receipt Review/Scale Draft filters | Client-side search of already needed rows/metadata | No added catalog request |

All new remote searches opt in with `lookup=1&search=...&limit=25`. The backend caps the limit at 50. A two-character minimum prevents empty/one-character catalog scans. `code=...&limit=1` supports exact saved selection restoration. Bin-managed warehouse checks use `lookup=1&probe=1` (one row), not a bin catalog, and never select a bin automatically. Frontend debounce is 300 ms, result TTL 60 seconds, cache capacity 200 queries, and in-flight requests deduplicate. Cache keys include the authenticated user/permissions, endpoint and selection context. Backend cache keys additionally use the SAP company namespace. Errors remain errors and are not cached as successful empty lists.

## Required workflow data retained

- Transfer execution's existing complete warehouse/bootstrap dataset remains necessary to determine eligible routes, uniquely assigned user routes and automatic one-option warehouse selection. Its bin discovery and complete cold-storage hierarchy remain necessary for map filtering and physical-position validation. The six dropdown templates search remotely, but **this workflow still performs its existing complete bootstrap**. Removing it would require changing route/position behavior, which this task prohibits. This is explicitly not a claim that every page has zero full master-data requests.
- Delivery **Auto Fill** explicitly loads the eligible batch inventory required by its existing allocation algorithm. Opening its batch dropdown performs only bounded search. Batch lookup currently filters the existing per-item SAP inventory result on the backend; it does not push its search term into the underlying SAP SQL query.
- Receipt Review spreadsheet validation still reads warehouse bins to validate uploaded rows by code/name. This is an import-validation operation, not a dropdown open.
- Table/document records, finite UDF configuration and the exempt Location/General catalogs remain available to their existing workflows.

## Performance evidence and limits

Read-only authenticated Chrome against the actual running Vite/Django app; no API mocks for performance measurements. Raw before/after JSON files are in `scratch/dropdown-performance-before.json` and `scratch/dropdown-performance-after.json`.

| Initial dropdown-related payload | Before | After |
|---|---|---|
| Create User warehouse catalog | 2 requests, 186 rows, 15,602 JSON bytes | 0 catalog requests/rows/bytes |
| Transfer Policy warehouse catalog | 2 requests, 186 rows, 18,764 JSON bytes | 0 catalog requests/rows/bytes |
| Sales Quotation initial item lookup | 2 requests, 40 rows, 14,802 JSON bytes | 0 item requests/rows/bytes before typing |
| GRPO initial warehouse catalog | 2 requests, 186 rows, 15,602 JSON bytes | 0 warehouse catalog requests before typing |

Actual Create User search for `202`: HTTP 200, 7 rows, 610 JSON bytes, one debounced request, zero extra requests when repeating the query. Eleven authenticated live API lookup paths returned HTTP 200 with at most the requested two records, including warehouses, bins, vendors, contractors, scale items/farms, customers, sales items and users.

The observation window is nine seconds and captures completed JSON responses; slow pending calls may be absent. DOMContentLoaded measures document readiness, not completed SAP data loading. Its raw before/after timings are recorded, but do not consistently improve, so **no overall page-speed or total-network-payload improvement is claimed**. The reduced eager dropdown master-data payload is directly demonstrated. Shared bundle size increased slightly to add the reusable search implementation; build retains existing large-chunk warnings.

| Page | Completed JSON responses in window, before → after | DOMContentLoaded ms, before → after |
|---|---|---|
| Create User | 4 → 2 | 200.7 → 231.6 |
| Sales Quotation | 8 → 4 | 293.2 → 342.9 |
| Manual GRPO | 6 → 6 | 325.3 → 303.5 |
| Transfer Policy | 14 → 7 | 347.3 → 385.0 |

These are single observed runs, not a controlled timing benchmark; completed-response counts must not be presented as total requests initiated.

## Verification

- **324 backend tests passed on an isolated, uniquely named PostgreSQL test database**, created/migrated/destroyed by Django. Live SAP HTTP was forbidden. Covers new lookups, existing policy/stage contracts, module permissions, cost-center isolation, Issue, Delivery, Customization and Scale workflows. A preliminary SQLite broad run hit its existing threaded numbering table-lock limitation; the same concurrency tests passed on isolated PostgreSQL. Operational database schemas and migration state were not changed.
- **265 focused backend tests passed on isolated SQLite**, including legacy Scale exact-item lookup and farm lookup.
- Final combined frontend Node run: **59 tests/scripts passed**, including cache, existing services, Transfer Rules selection, policy/admin/stage/position/map/module suites. Embedded assertion counts include 19 Transfer Rules selection, 8 cache, 160 Policy Admin contracts, 26 policy rendering, 8 map, 15 position integration and 20 outbound checks.
- Chrome fixture Policy UI: 59 checks passed, including actual bin selection, parent change, inactive/system/foreign-bin protection, save/activate/replacement lifecycle, errors, permissions, incomplete Stage 3, Arabic/dark/mobile. Every API intercepted; no operational writes.
- Chrome fixture Sales UI: selected customer metadata and price-list scope, item price/UOM retention across another search, visible empty/error states, cached repeat search, no detail/catalog/write requests.
- Actual authenticated Chrome: keyboard selection, clear/repeated query, debounce/minimum length, Arabic RTL/dark/mobile, no horizontal overflow, Policy page with three stage sections, no JavaScript page errors, no business API writes. Performance/live screenshots are in `scratch/master-search-live-ar-dark-mobile.png` and `scratch/master-search-policy-live.png`.
- Frontend production build passed. New shared files pass ESLint. Existing unrelated lint errors in older pages remain and are documented in `scratch/dropdown-lint.json` / `scratch/dropdown-final-focused-lint.json`; no repository-wide lint PASS is claimed.
- Existing MUI deprecated-prop console warnings remain. Browser "no JavaScript page errors" means no uncaught page exceptions, not an assertion that the browser console has no warnings.
- No Shipping Dock implementation, SAP posting changes, permission changes, historical backfill or business-data migrations.
