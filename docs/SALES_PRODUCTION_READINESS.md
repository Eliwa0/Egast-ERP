# Sales production readiness — 2026-10-05

## A. Overall result

**PASS WITH ISSUES. Ready for limited UAT, not an unconditional production approval.**

Implemented the requested protections, bounded loading, print corrections and scoped responsive fixes. Verification used the real React application, real Django views/services/models and isolated fixture databases, with SAP document transport simulated. No operational migration, historical backfill, permission change or live SAP document posting was performed.

The running frontend for verification was a separate Vite instance at `127.0.0.1:5189`. Browser requests were routed through authenticated Django `APIClient` into the actual endpoints; this is not a claim that the operational backend/SAP installation passed UAT.

## B. Durable idempotency and uncertain outcomes

Previously a disabled button and transient UI state could not identify an earlier posting after refresh. The backend now persists an intent before SAP POST and appends its outcome in the existing immutable `AuditLog` table. Its JSON details hold the request fingerprint, original payload, recoverable quotation request and SAP correlation reference. No model/schema change was needed.

`SalesPostingJournal` scopes intents to the SAP endpoint/company. New quotation intents are additionally scoped to the authenticated actor; order intents use the existing draft ID across actors. User/draft row locks serialize claims on databases supporting row locking. SQLite contention fails closed before a second SAP posting; an independent-connection concurrency test verifies this behavior.

The only additional outbound business-document field content is an internally generated `[AppPost:<UUID>]` reference appended to `Comments`. Customer/item/quantity/price/currency/warehouse and native base links retain their existing mapping. Comments are not truncated; a request that cannot fit the reference into SAP's 254-character Comments field is rejected before posting. Quotation comments therefore have a 211-character limit with this reference.

Confirmed retries return the stored result. Definitive SAP rejections are stored without silently posting again. Ambiguous failures remain **VERIFYING**. Retry performs a read-only `contains(Comments, reference)` lookup, then reads and verifies the candidate's customer, currency and line identifiers/quantities/prices/warehouses/base links. Zero/multiple/mismatched candidates remain pending; they never authorize another POST. SAP documents its OData `contains` query option in the [Service Layer query guide](https://help.sap.com/docs/SAP_BUSINESS_ONE/f110a154dd0f4c20bf7f3ebca9eeb794/3e5b7d980d99493f9271847450a927ef.html).

The original order payload is retained for retries, including original dates. Changing the retry date does not rebuild or repost a different order. Duplicate local quotation drafts are also prevented on confirmed replay.

The quotation's request identifier is retained in its URL. Reload uses `GET /api/customization-delivery/quotations/posting/<request_key>/`: confirmed recovery returns 200, unresolved verification returns 202. Orders retain their existing create-order endpoint and present **Check document status** while pending.

Browser proof: quotation 5001/1001 survived reload without another POST; order success with its response lost recovered after reload/check with one Orders POST; a later quotation success with response lost recovered as 5002/1002 with one POST for that intent. A timeout with no matching SAP document remained pending after reload. The restored quotation printed its own current document.

Earlier `ORDER_POSTING` records without a durable correlation reference fail closed and require administrative verification. No historical documents were scanned or backfilled.

## C. Warehouse and Serial

Quotation lines initialize warehouse from the selected SAP item's `DefaultWarehouse`, and expose the existing searchable warehouse selector for an explicit alternative. The selected code travels through `warehouse_code` to `DocumentLines[].WarehouseCode`, then through quotation/order mapping. No warehouse code is hardcoded.

Tests cover an explicit warehouse, normal/batch/serial-designated quotation lines without inventory allocations, omission of warehouse with SAP returning its configured default, and definitive SAP rejection of an invalid code without substitution. These fixture tests prove mapping behavior; they do not certify the real company's serial-managed item configuration.

Quotation creation is a commercial-document path in this codebase and does not allocate batch/serial inventory. Existing Delivery models/builder support batches and their bin allocations, not a serial allocation workflow. SAP describes serial selection for orders as optional and serial selection for stock release as required where applicable: [Sales Order serial selection](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/40a836d591984ec6aded1af9633ac7bd.html), [serial stock release](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/452366399e152b31e10000000a1553f7.html).

**Business use of serial-managed items remains unconfirmed. No speculative Serial implementation was added. Serial-managed Delivery must not be represented as approved by these tests.**

## D. Large-data performance

All lists below were tested with 1,000, 5,000 and 10,000 records. Document fixtures include five lines per document; the largest quotation and delivery datasets each include 50,000 lines. Pages default to 25, cap at 50, use deterministic ordering and expose offset/total/has_more. Search is performed on the server, including relevant item fields. Related review summaries are loaded for the IDs in the displayed page rather than an unrelated first page. Older document deep links are filtered explicitly.

The following sizes are actual JSON response bytes at 10,000 records, not estimates:

| List | Initial rows | Initial bytes | Search bytes | Browser requests tested | SAP reads in those requests |
|---|---:|---:|---:|---:|---:|
| Quotations | 25 | 86,284 | 3,590 | 3: first/next/search | 0 |
| Sales Orders | 25 | 15,913 | 804 | 3: first/next/search | 51: 25/25/1 |
| Delivery eligible orders | 25 | 15,913 | 804 | 3: first/next/search | 51: 25/25/1 |
| Posted Deliveries | 25 | 49,249 | 2,039 | 3: first/next/search | 0 |
| Customers | 25 | 7,988 | 406 | 4: first/next/search/repeat | 3, repeat served from server cache |
| Items | 25 | 7,883 | 398 | 4: first/next/search/repeat | 4, no server cache in this endpoint |
| Warehouses | 25 | 2,132 | 142 | 4: first/next/search/repeat | 3, repeat served from server cache |

The master API tests exercise actual API views with a simulated bounded SAP transport. They prove `$top`/`$skip` boundaries and search result shape rather than measuring a remote SAP server's query execution. Warehouse datasets at 5,000/10,000 are stress fixtures, not a claim about actual company warehouse counts.

Customers/items retain server-side search and the existing frontend 60-second scoped search cache. Warehouses remain browsable searchable dropdowns with initial options. Existing small/static dropdown behavior is retained. Document search uses 300ms debounce. Identical simultaneous workflow list reads are merged while in flight only; later Refresh always issues a fresh read. This removes the duplicate initial request observed during browser verification without caching document status.

Actual browser rendering on the quotation list:

| Fixture records | Navigation to 25 rendered cards | First/next/search list requests | Search cards |
|---:|---:|---:|---:|
| 1,000 | 545.94ms | 3 | 1 |
| 5,000 | 520.98ms | 3 | 1 |
| 10,000 | 518.36ms | 3 | 1 |

These are local development-server timings with an already exercised browser, not production-device or WAN latency guarantees. Detailed measurements are in `scratch/readiness-performance.json`, `scratch/readiness-master-performance.json` and `scratch/readiness-browser-performance.json`.

Remaining bottleneck: a live order page still makes up to 25 sequential SAP order reads. Pagination bounds the cost; remote latency still needs UAT. Delivery status counts/filters apply to the current candidate page and are labeled accordingly. Pages can be sparse after the live status filter; Next continues through candidate orders. No stale local/SAP status was invented to replace those reads. Quotation tab counts come from the complete matched local queryset.

## E. Printing

Quotation, order and posted Delivery printing fetch the actual current SAP document before rendering. `DocNum` and `DocEntry` are separate; local draft IDs and DocEntry are no longer substituted for missing printed DocNum. Amounts, names, dates, currency, rows and warehouses use the fetched document.

The delayed blank-popup path exposed an asset-loading problem. Sales printing now navigates to a complete local Blob document after the read, with an explicit base URL. It awaits bundled Cairo fonts and image decoding before invoking print, and releases the Blob URL when leaving the popup. Asset failures visibly stop printing. Other document modules retain their existing document-write path.

Sales documents flow across A4 pages rather than shrinking all content into one fixed-height sheet. Item descriptions get appropriate width, rows avoid splitting, table headers repeat, DocNum repeats in the page margin, and page counters reflect actual pages. No external Google Fonts were added.

**36 actual Chromium PDFs passed**: three document types × Arabic/English × 1/10/55 rows × portrait/landscape. Every row identifier, USD 6000 total, warehouse and repeated DocNum was verified in PDF text. A4 dimensions were checked. Chrome's font inspection identifies custom Cairo; PDF rendering confirms embedded glyphs (Chrome exports this variable font as Type3). PNGs were rendered and representative first/middle/last pages visually inspected. Long portrait examples use three pages; landscape page counts vary with description length/language.

The real UI print buttons also passed: font state `loaded`, image width present and readiness confirmed before the print call. The PDF test drives Chromium's actual print-to-PDF path. **The interactive operating-system print dialog and a physical printer were not certified in this headless environment.**

Artifacts: `scratch/readiness-print/results.json`, generated PDFs/PNGs under `scratch/readiness-print/`, and current-document UI print evidence under `scratch/sales-journey/`.

## F. Mobile and dense review

Verified 1440px desktop, 768px tablet and 390px mobile. Arabic RTL/dark checks cover nine module/width combinations, plus quotation customer/items/detail/review steps. English mobile checks cover quotation form steps, quotation success, order success modal, Delivery review/success and ambiguous failure/reload. Snapshot assertions reject page-level horizontal overflow.

Dense tables keep intentional horizontal scrolling, translated hints and keyboard-focusable regions. Buttons have adequate tap height and wrap without overlap. Cards wrap long text. A toolbar overflow discovered at desktop width was fixed only while a Sales readiness page is present. No project-wide mobile redesign or change to Location/General was made.

## G. Core regression

The real React → Django → simulated SAP journey verifies:

- Quotation: customer/item, quantity 250, price 24, actual `DocCurrency=USD`, total 6000, correct DocNum/DocEntry and reload.
- Order: native `BaseType=23`, `BaseEntry=1001`, `BaseLine=0`, customer, quantity, price, warehouse and USD preserved.
- After order success: **zero DeliveryNotes POST and zero DeliveryDraft creation requests**.
- Delivery starts from the Delivery module after an explicit user action. Exactly one DeliveryNotes POST uses `BaseType=17`, `BaseEntry=2002`, `BaseLine=0`, USD, quantity 250, selected batch `PAL-001` and bin 11.
- Quotation/order uncertain retries and refresh do not create duplicate SAP documents.

No Shipping Dock, Stage 3, Receipt, Batch generation or Transfer business behavior was implemented or changed in this pass.

## H. Verification results

| Check | Result |
|---|---|
| Targeted backend | **162 passed, 1 skipped** (163 collected) |
| Frontend | **3 Node contract suites passed**: select UX, search cache, workflow-read dedup |
| Browser | **2 scripts passed**: full real UI/Django journey with large-list rendering; independent-order UI regression |
| Print | **36 PDF cases passed**, plus actual UI print readiness/current-document checks |
| Responsive | No page overflow in asserted snapshots; desktop/tablet/mobile, RTL/LTR/dark as described above |
| i18n | PASS for all extracted AR/EN keys |
| Production build | PASS; oversized bundle warning remains |
| Scoped lint | One existing unused `remainingNeeded` error in `DeliveryCreateWizardPage.jsx:1439`; other checked changed frontend files clean |

The skipped backend test is `test_browser_form_to_backend_to_sap_transport_and_reopen`, gated by `QUOTATION_CURRENCY_BROWSER_URL`. The separately executed browser journey covers that currency/post/reopen path and adds timeout/recovery verification.

The final backend runner explicitly replaces the configured database with isolated SQLite and blocks real `requests.Session` HTTP. Existing migrations run only in fixture/test databases. Negative-path tests deliberately log simulated SAP/property/permission failures; they passed their expected assertions.

Reproducible commands:

```text
cd backend
..\.venv\Scripts\python.exe run_sales_readiness_tests.py api.tests_sales_readiness api.tests_sales_journey_audit api.tests_customization_workflow api.tests_delivery_workflow api.tests_customization_delivery api.tests_module_permissions api.tests_sales_quotation_currency api.tests_master_data_search api.tests_sales_performance

cd frontend
node scripts/test-select-ux.mjs
node scripts/test-search-cache.mjs
node scripts/test-workflow-read-dedup.mjs
npm.cmd run i18n:check
npm.cmd run build

cd project-root
.venv\Scripts\python.exe frontend/scripts/test-sales-journey-browser.py
.venv\Scripts\python.exe frontend/scripts/test-sales-order-independent-ui.py
.venv\Scripts\python.exe frontend/scripts/test-sales-print-readiness.py
```

Browser scripts require a separate fixture frontend at port 5189. PDF verification uses PyMuPDF installed only under `scratch/readiness-pdf-tools`; project dependency manifests were not changed for that QA dependency.

## I. Remaining issues and limits

1. Confirm actual company's serial-managed Sales items before approving serial Delivery. That feature was not added without a confirmed requirement.
2. Verify Service Layer correlation queries/read permissions and real latency in UAT. Exact marker/field reconciliation is tested against simulated SAP transport, not certified against the production company.
3. Verify the interactive print dialog, printer margins/output and operator workflow on the actual target machine/printer.
4. Up to 25 sequential live SAP reads remain per order candidate page. Current-page status counts/filter semantics are explicit; remote throughput was not measured.
5. Earlier uncertain attempts without durable references remain blocked for administrative verification. No automatic resend or historical backfill was introduced.
6. Comments must leave room for the verification reference; no silent truncation occurs.
7. Existing lint error above remains. The production build still warns about a roughly 2.79MB minified main JS bundle (~709KB gzip). Unrelated lint/bundle refactors were not performed.
8. Repository-wide `git diff --check` reports whitespace issues in existing working-tree changes, including untouched App/config files. Those unrelated changes were not normalized or reverted.

## J. Recommendation

**Ready for limited UAT of the verified existing quotation → order → explicit batched Delivery workflow.** The code and fixture verification close the duplicate-posting, bounded-loading, current-document printing and responsive defects found during this pass. Production approval still requires the real SAP/company/serial scope and interactive printer checks listed above. The application was not deployed or restarted against the operational database.

## Changed files in this pass

Backend runtime:

- `backend/api/services/sales_posting_journal.py` (new)
- `backend/api/services/workflow_pagination.py` (new)
- `backend/api/services/customization_service.py`
- `backend/api/services/sales_document_normalizer.py`
- `backend/api/customization_views.py`
- `backend/api/delivery_views.py`
- `backend/api/urls.py`

Frontend runtime:

- `frontend/src/pages/SalesQuotationCreatePage.jsx`
- `frontend/src/pages/SalesQuotationsPage.jsx`
- `frontend/src/pages/SalesQuotationsReviewPage.jsx`
- `frontend/src/pages/SalesOrdersPage.jsx`
- `frontend/src/pages/SalesOrdersReviewPage.jsx`
- `frontend/src/pages/DeliveriesPage.jsx`
- `frontend/src/pages/DeliveryReviewPage.jsx`
- `frontend/src/pages/DeliveryCreateWizardPage.jsx`
- `frontend/src/components/print/SalesDocumentPrintable.jsx`
- `frontend/src/components/ui/WorkflowPagination.jsx` (new)
- `frontend/src/hooks/useWorkflowPagination.js` (new)
- `frontend/src/services/customizationDeliveryService.js`
- `frontend/src/services/searchCache.js`
- `frontend/src/utils/printDocument.js`
- `frontend/src/styles/pages/sales-readiness.css` (new)
- `frontend/src/i18n/translations.js`

Tests/report:

- `backend/api/tests_sales_readiness.py` (new)
- `backend/api/tests_sales_performance.py` (new)
- `backend/api/tests_customization_workflow.py`
- `backend/api/tests_sales_quotation_currency.py`
- `backend/run_sales_readiness_tests.py` (new)
- `frontend/scripts/test-sales-journey-browser.py`
- `frontend/scripts/test-sales-print-readiness.py` (new)
- `frontend/scripts/test-workflow-read-dedup.mjs` (new)
- `docs/SALES_PRODUCTION_READINESS.md` (this report)

Existing working-tree changes from earlier work were preserved. This inventory is not a claim that every dirty/untracked repository file belongs to this task.
