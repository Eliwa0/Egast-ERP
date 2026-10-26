BEGIN;
--
-- Create constraint delivery_one_active_order on model deliverydraft
--
CREATE UNIQUE INDEX "delivery_one_active_order" ON "api_deliverydraft" ("sales_order_doc_entry") WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTING');
COMMIT;
