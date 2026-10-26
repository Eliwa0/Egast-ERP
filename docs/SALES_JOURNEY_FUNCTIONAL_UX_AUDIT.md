# Sales Quotation → Sales Order → Delivery: functional and UX audit

Date: 2026-10-04. Overall result: **PASS WITH ISSUES**.

The actual React journey passed in headless Chrome against real Django views, services and models with an isolated SQLite fixture database and intercepted SAP transport. This proves the application path and generated payloads; it does not certify acceptance by a live SAP company. No operational database migration, live SAP write, historical backfill, Receipt/Transfer business change or permission-level change was performed.

## Evidence and scope

- `frontend/scripts/test-sales-journey-browser.py`: actual customer/item selection, USD 6000 quotation creation, reopen/refresh, order conversion, explicit Delivery, batch/bin allocation, submit/reload/resume, approval/posting, printing, review status and ambiguous quotation failure.
- `scratch/sales-journey/network.json`: browser requests, actual service-generated SAP transport payloads and responsive measurements for the successful journey.
- `scratch/sales-journey/error-network.json`: separate ambiguous quotation posting probe.
- `scratch/sales-journey/print-5001.html`, `print-6001.html`, `print-7001.html` and corresponding PNGs: actual print button output. Native `window.print()` was intercepted and asserted, allowing content inspection without a physical printer.
- `scratch/sales-journey/button-inventory.json`: 119 button instances across 10 workflow pages, with source location, label expression, handler, disabled expression and conditional ancestors. This is source inventory, not a claim that every button received a browser click. Shared PageHeader/navigation controls were inspected separately.
- `backend/api/tests_sales_journey_audit.py`: regression tests that reproduce data loss, permission mismatch, missing SAP response IDs, ambiguous posting and reconciliation faults.

The in-app Browser skill was attempted but no browser was attached. The browser verification used the requested Playwright-style fallback, Chrome, and an isolated Vite server at port 5189. The user's running services at 5173/8000 were not modified. Django authentication was a real authenticated APIClient fixture, not the user's production session. Master metadata and SAP responses were fixtures; views, payload construction and workflow database operations were real.

## Functional results

| Module | Functional status | UX status | What was verified |
|---|---|---|---|
| Sales Quotation | PASS in tested fixture path | PASS WITH ISSUES | Customer with EGP master currency creates a USD quotation, 250 × 24 = USD 6000, persisted USD, DocEntry 1001 / DocNum 5001, reopen/refresh and print |
| Sales Order | PASS in tested fixture path | PASS WITH ISSUES | Same customer/item/quantity/price/warehouse/currency; actual quotation base links; DocEntry 2002 / DocNum 6001; success ends without Delivery |
| Delivery | PASS for batch/bin scenario | PASS WITH ISSUES | Explicit user action, live open quantity validation, PAL-001 quantity 250, physical bin 11, resume pending review, approval/posting, DocEntry 3003 / DocNum 7001, print and Fully Delivered review status |

### Quotation findings and fixes

USD was already the current form default. Customer currency EGP is metadata and does not replace the document currency. The real form sent `currency: USD`; `create_quotation_and_draft` produced `DocCurrency: USD`; the mocked transport returned USD; the local draft and reopened SAP detail retained it. Manual document currency selection remains available. Exchange-rate logic was not changed.

The audit found duplicate ItemCode rows were mapped through an item-keyed dictionary after SAP posting. The last input row overwrote quantity/price overrides for every occurrence. A failing regression reproduced `(20,250),(20,250)` instead of `(10,100),(20,250)`. Mapping now uses SAP LineNum/input row position. UoMEntry, tax code, discount and existing header/date/comment fields are persisted instead of lost. Serialized totals include line discounts and preserve explicit zero values.

Zero creation quantity previously became one because of `or 1`. New SAP-first quotation creation now rejects zero/nonfinite/nonpositive quantity before calling SAP. Missing response DocEntry now yields a meaningful 502 with `is_ambiguous`, rather than a runtime conversion exception. SAP error messages are flattened into human-readable text.

The success page's Go to Sales Quotations button used a decorative CTA class that disabled pointer events. An actual browser click reproduced the failure. It now uses a clickable button class. The success page offers an explicit Create Sales Order navigation action. It does not create an order automatically.

In-flight duplicate quotation clicks are guarded. Ambiguous SAP/network failure disables Try Again and shows an instruction to verify SAP before retrying. This guard is page-local: see remaining recovery limitations below.

Quotation warehouse is currently not exposed as a separate creation form field. The payload supports explicit warehouses from callers, but the current form relies on SAP's item/document warehouse defaults. The test SAP fixture assigned WH and the subsequent SAP-read quotation carried WH into the order. This is not proof of an actual company's default warehouse configuration.

### Sales Order findings and fixes

The Sales Orders page had a Customization route guard but called a Delivery-protected API. A Customization-only user could enter the page and fail at the API/detail route. Sales read endpoints now use the same existing Customization access requirement as the sales pages. Original Delivery endpoints and all Delivery write/manager guards remain unchanged. Regression proves sales read 200 while Delivery reads/creation remain 403 for that user.

The list used SAP `DocCur` instead of `DocCurrency`, causing a false EGP fallback. It now reads the actual document field and otherwise uses persisted draft currency. Printing now fetches the normalized full SAP order rather than printing a summary card without lines or reusing quotation rows. Printed customer, dates, currency, quantities, selected SAP lines and SAP DocTotal come from that order. Zero prices and discounted line totals are preserved. The success modal shows total/currency.

Order success is terminal until an explicit user action. Backend and network assertions prove no DeliveryDraft and no DeliveryNotes request after order creation; viewing order details is read-only. Missing SAP order DocEntry does not report success. Uncertain posting retains ORDER_POSTING; definitive SAP rejection uses ORDER_FAILED.

SAP list outages could cause an uninitialized `order_data` runtime error. The loop now initializes it and retains the existing local-data fallback, with `sap_error` visible in Sales Orders. Local total fallback is computed from existing selected line fields; there is no nonexistent `draft.total_amount` access.

Review pages previously swallowed Delivery API permission/read errors and could claim Not Delivered incorrectly. They now use the sales-authorized workflow summary. Order review quantities come from the live order summary, and quotation/order relationship chains use recorded posted-delivery references. Browser verification after Delivery shows Fully Delivered and Delivery #7001.

### Delivery findings and fixes

Opening the Delivery module alone creates nothing. Clicking Create Delivery Note in SAP starts the local draft explicitly. The existing server active-draft guard remains; a frontend in-flight initialization guard prevents duplicate StrictMode draft creation requests. Failure to read drafts is no longer silently converted into an empty list followed by creation.

Explicit saved delivery quantity zero now remains zero on resume. Changing a warehouse clears batch allocations and the pending batch selection so stock from a different warehouse cannot remain selected. Backend live open-quantity revalidation, over-delivery checks, batch allocation totals, native posting and manager approval remain in force.

Resuming PENDING_REVIEW/APPROVED previously attempted a forbidden draft update before posting. Resume now opens the saved review, locks edit navigation and posts that approved/submitted data through the existing approval/posting state machine. The actual browser submitted, reloaded, resumed and posted successfully.

The SAP payload now explicitly carries the live base order's DocCurrency. Missing DocEntry and transport/string errors are ambiguous: POSTING is retained and a new draft/repost remains blocked. Definitive SAP rejection is FAILED. The wizard refreshes draft state after posting errors and offers the existing read-only SAP reconciliation action for POSTING. It does not silently repost.

Reconciliation previously accepted any Delivery for the same order. It now requires this draft's Comments marker, customer, complete expected line set, BaseType/BaseEntry/BaseLine, item, warehouse and quantities. Regression proves another draft's Delivery is not adopted and reconciliation sends GET requests only.

Successful posting still invokes the pre-existing pallet-position release/AuditLog behavior. That business logic was not redesigned in this audit. No Shipping Dock or Transfer implementation was added.

## Exact network and SAP links

Browser creation-related requests in the successful journey, in order:

1. `POST /api/customization-delivery/quotations/create/` → 201, quotation 5001.
2. `POST /api/customization-delivery/customization/drafts/1/create-order/` → 200, order 6001.
3. **Only after explicit Delivery creation:** `POST /api/customization-delivery/delivery/drafts/`.
4. `PUT /api/customization-delivery/delivery/drafts/1/` to save allocation/review data.
5. `POST /api/customization-delivery/delivery/drafts/1/submit/`.
6. Browser refresh reads the pending draft; it does not create another draft.
7. `POST /api/customization-delivery/delivery/drafts/1/approve/`.
8. `POST /api/customization-delivery/delivery/drafts/1/post/`.

| Transport POST | DocCurrency | Quantity/price | Base document |
|---|---|---|---|
| Quotations | USD | FRUIT, 250 × 24, total 6000 | New quotation |
| Orders | USD | Same customer C001, FRUIT, 250 × 24, WH | BaseType 23, BaseEntry 1001, BaseLine 0 |
| DeliveryNotes | USD | FRUIT, 250, WH; BatchNumbers PAL-001/250; bin 11 | BaseType 17, BaseEntry 2002, BaseLine 0 |

There is exactly one successful-journey transport POST for each entity. No DeliveryNotes POST, local DeliveryDraft or Delivery draft creation request exists between quotation-to-order conversion and the explicit Delivery action. The later separate timeout probe sends one additional mocked quotation attempt and does not retry.

## Frontend, backend, sources and models

| Function | Frontend | Endpoint/view/service | Source |
|---|---|---|---|
| New quotation | SalesQuotationCreatePage | quotations/create/ → customization_views → CustomizationService.create_quotation_and_draft | SAP Quotations/OQUT/QUT1 + local CustomizationDraft/CustomizationDraftLine |
| Quotation details/edit/review | CustomizationDetailPage; SalesQuotationsPage; SalesQuotationsReviewPage | customization/documents and customization/drafts API; Quotation read service and CustomizationService | SAP quotation + persisted workflow approval/line/header state |
| Create order | SalesQuotationsPage; CustomizationDetailPage | customization/drafts/{id}/create-order/ → customization_views → CustomizationService.post_sales_order_to_sap | Existing selected local lines + live SAP quotation; POST Orders/ORDR/RDR1 |
| Order list/review/detail/print | SalesOrdersPage; SalesOrdersReviewPage; DeliveryDetailPage(orderViewOnly) | orders/ → delivery_views.list_workflow_sales_orders; orders/documents/{DocEntry}/ → customization_delivery_views.sales_order_document_detail → SalesOrderService | Live SAP Orders; local workflow references/posted-delivery metadata |
| Explicit Delivery | DeliveriesPage; DeliveryCreateWizardPage; DeliveryReviewPage | delivery/eligible-orders/; delivery/drafts/{id}/ update/submit/approve/post/reconcile → delivery_views → DeliveryPostingService + DeliveryPayloadBuilder | Live Orders/available batch/bin master data; local DeliveryDraft/DeliveryDraftLine/DeliveryDraftBatch; SAP DeliveryNotes/ODLN/DLN1 |

Local Django tables use the standard `api_` model naming: `api_customizationdraft`, `api_customizationdraftline`, `api_deliverydraft`, `api_deliverydraftline`, `api_deliverydraftbatch`; existing AuditLog remains in use. No model field/table/migration was added.

Routes were checked in App.jsx: `/customization-delivery/quotations`, `/quotations/new`, `/quotations/review`, `/quotations/documents/:docEntry`, `/orders`, `/orders/documents/:docEntry`, `/review`, `/deliveries`, `/deliveries/new/:docEntry`, `/delivery/documents/:docEntry`, `/review/deliveries`. Legacy customization/delivery routes redirect to the current lists. Backend permissions protect APIs independently of frontend guards.

## Buttons, navigation and UX review

| Action family | Inspection/result |
|---|---|
| Customer/item selection and Next | Actual search/selection exercised; missing customer disables Next; small operational choices remain dropdowns; large master data uses bounded search |
| Previous/stepper/review | Source conditions inspected; happy path exercised; pending/approved Delivery resume locks editing; mobile stepper becomes compact icons |
| Create quotation/retry | Actual success, ambiguous error and disabled retry exercised; duplicate in-flight guard |
| Go to Quotations/Create Sales Order | Previously unclickable Go button fixed; explicit next-action navigation; no hidden posting |
| Create Sales Order | Actual conversion exercised; source approval/status/manager conditions inspected; success shows DocNum/customer/total/currency and explicit Print/Go/Done |
| Print buttons | Actual quotation print, order success print, order list print and Delivery print exercised; popup-blocked/fetch-error branches inspected |
| Sales Order detail/back/Delivery module | Actual detail read-only route and independent module navigation covered by the independent browser regression |
| Delivery save/submit/reload/approve/post | Actual allocation, submission, refresh, resume, approval and post exercised; no duplicate creation or SAP posting |
| Recovery/reject/reconcile | Backend rejection/reconciliation regressions; frontend guards and handlers inspected; complete manager rejection/recovery clicking was not all exercised |
| Refresh/direct links/review modal/filter controls | Direct quotation/order URLs and refresh exercised; source handlers/conditions inventoried; every filter/approval modal/browser Back permutation was not exhaustively clicked |

119 page button instances are inventoried with exact source evidence. Duplicate Next/Back placements are step-specific, not multiple posting actions. Print/Open/Done are separate actions. Success navigation is explicit. Loading and error branches were inspected in all main pages. The page-level error messages now avoid SAP JSON envelopes where extracted messages exist.

## Responsive, language and printing checks

The successful journey ran English LTR/light at desktop width 1440. Delivery review also rendered at tablet 768 and mobile 390. Arabic RTL/dark quotation details, order details and active Delivery rendered at widths 1440, 768 and 390: all nine measurements had document scrollWidth equal to viewport width. Long customer/item fixture names wrapped. Screenshots were inspected for print output and mobile RTL Delivery. This is representative coverage, not every step/theme/width combination.

Printing now respects the current language direction for these sales pages without changing other modules' default RTL printing. Labels and the SAP-created statement are translated; it no longer claims a document is formally approved merely because it was created in SAP. An explicit currency header ensures Delivery prints USD even without prices. English Order print shows 250 KG, unit price USD 24, total USD 6000 and quotation reference 5001.

Important printing limitation: headless popup fonts remained in `loading` and image `complete` remained false, although the logo had decoded naturalWidth and the native print trigger executed. Screenshot capture deliberately did not wait indefinitely for font readiness. Markup/data, decoded logo and rendered output passed; final font-load timing, physical printing and long multi-page documents still require UAT. No claim of physical-printer PASS is made.

## Tests and commands

- Backend: `.venv/Scripts/python.exe frontend/scripts/test-master-search-backend.py api.tests_sales_journey_audit api.tests_customization_workflow api.tests_delivery_workflow api.tests_customization_delivery api.tests_module_permissions` → **114 passed**, isolated test database, live SAP HTTP forbidden. Existing receipt/transfer tests were not rerun as no changes were made to their logic.
- Browser: `.venv/Scripts/python.exe frontend/scripts/test-sales-journey-browser.py` → **PASS**, real UI + Django + mocked SAP transport, explicit network assertions and timeout UI probe.
- Independent frontend journey: `.venv/Scripts/python.exe frontend/scripts/test-sales-order-independent-ui.py` → **PASS**, intercepted APIs, no auto Delivery and read-only order details.
- Frontend contracts: `node scripts/test-module-permissions.mjs`, `node scripts/test-select-ux.mjs`, `node scripts/test-search-cache.mjs` → **PASS**; caching test reports eight assertions.
- `node scripts/check-i18n.js` → **PASS**, Arabic/English keys resolve.
- `vite build` (production command used by npm run build) → **PASS**. Existing warning: main JavaScript chunk about 2.77 MB / 703 KB gzip, over 500 KB.
- Scoped ESLint: one existing unused variable `remainingNeeded` in DeliveryCreateWizardPage; no new lint errors/warnings in audited files. Unrelated lint defects were not cleaned up.
- `node scripts/audit-sales-journey-buttons.mjs` → **119 instances / 10 pages**.

Logs are under `scratch/sales-journey-*.log`. Operational database schema/migration state was not changed. Existing migrations were applied only to isolated test databases as required for Django tests.

## Files changed by this audit

Backend: `api/services/customization_service.py`, `api/services/delivery_posting_service.py`, `api/services/sales_order_service.py`, `api/customization_views.py`, `api/delivery_views.py`, `api/customization_delivery_views.py`, `api/urls.py`, `api/tests_sales_journey_audit.py`.

Frontend: `src/App.jsx`, `src/pages/SalesQuotationCreatePage.jsx`, `src/pages/SalesQuotationsPage.jsx`, `src/pages/SalesOrdersPage.jsx`, `src/pages/SalesOrdersReviewPage.jsx`, `src/pages/SalesQuotationsReviewPage.jsx`, `src/pages/DeliveryCreateWizardPage.jsx`, `src/pages/DeliveryDetailPage.jsx`, `src/components/print/SalesDocumentPrintable.jsx`, `src/utils/printDocument.js`, `src/services/customizationDeliveryService.js`, `src/i18n/translations.js`.

Verification/report: `frontend/scripts/test-sales-journey-browser.py`, `frontend/scripts/test-sales-order-independent-ui.py`, `frontend/scripts/audit-sales-journey-buttons.mjs`, this report and scratch evidence. The repository had extensive prior changes; this list is task-specific, not the full git diff.

## Scores and remaining priorities

Scores are qualitative audit judgments, not percentages of test coverage.

| Module | Functional correctness | UX clarity | Error handling | Navigation | Performance |
|---|---:|---:|---:|---:|---:|
| Sales Quotation | 8 | 8 | 6 | 8 | 7 |
| Sales Order | 8 | 8 | 7 | 8 | 6 |
| Delivery | 8 | 7 | 7 | 8 | 6 |

Top five remaining UX/operational priorities, in order:

1. **Cross-refresh recovery of uncertain quotation/order posting.** Quotation retry is blocked in the current page, but creation lacks a durable request idempotency token across reloads. Order uncertainty retains ORDER_POSTING and requires administrator/SAP verification. Do not blindly recreate documents after an unknown outcome. Delivery has guarded read-only reconciliation, but its search is limited to the latest five customer Deliveries.
2. **Warehouse/tracking expectations before SAP submission.** Quotation warehouse selection relies on SAP defaults; serial-managed Delivery is not implemented by the current batch-only builder. Confirm company defaults and restrict supported item workflows accordingly; serial documents are not certified by this audit.
3. **List performance and data freshness at scale.** Main workflow lists/review pages load local workflow records broadly and the eligible-order summary reads SAP orders individually. Master searches are bounded/debounced/cached, but document lists need measured pagination/caching before large-volume rollout. Local fallback data after SAP read failure is not a live stock guarantee.
4. **Print/font and long-document UAT.** Final fonts and physical printing need verification; long documents use a fixed-sheet/scaling implementation rather than proven multi-page pagination. Small printed text can become a usability issue with many lines.
5. **Small-screen review/stepper clarity.** Mobile tables and long names wrap without page overflow, but quantities/headers become dense and the stepper uses compact icons. Representative rendering passed; complete Arabic mobile approval/rejection/recovery usability and keyboard-only traversal remain UAT work.

Recommendation: the tested USD quotation → independent order → explicit batch/bin Delivery path is ready for controlled UAT. Do not declare unrestricted production readiness solely from these fixtures/build. Confirm actual SAP currency exchange-rate/customer/warehouse settings, serial-item scope, uncertain-posting recovery and printing before a broad rollout. No real SAP acceptance was tested or claimed.
