-- Hand-written part of the schema (appended to the generated migration by tools/build-migration.mjs).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Inventory: never negative, never oversold.
ALTER TABLE inventory ADD CONSTRAINT inventory_nonneg CHECK (reserved >= 0 AND on_hand - reserved >= 0);
ALTER TABLE variants ADD CONSTRAINT variants_price_nonneg CHECK (price_kobo >= 0);
ALTER TABLE flash_sales ADD CONSTRAINT flash_window CHECK (ends_at > starts_at AND price_kobo >= 0);
ALTER TABLE cart_items ADD CONSTRAINT cart_qty_pos CHECK (qty > 0);
ALTER TABLE order_items ADD CONSTRAINT order_item_qty_pos CHECK (qty > 0);
ALTER TABLE reservations ADD CONSTRAINT reservation_qty_pos CHECK (qty > 0);
ALTER TABLE reviews ADD CONSTRAINT review_rating CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE sub_orders ADD CONSTRAINT sub_order_money CHECK (commission_kobo >= 0 AND commission_kobo <= subtotal_kobo AND commission_bps BETWEEN 0 AND 10000);
ALTER TABLE commission_rules ADD CONSTRAINT commission_bps_range CHECK (bps BETWEEN 0 AND 10000);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_amount_pos CHECK (amount_kobo > 0);

-- Full-text + trigram search.
ALTER TABLE products ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
) STORED;
CREATE INDEX products_search_idx ON products USING GIN (search_vector);
CREATE INDEX products_title_trgm_idx ON products USING GIN (title gin_trgm_ops);

-- Append-only guards (defence in depth: app role also has no UPDATE/DELETE grant).
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payment_events_no_update BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Double-entry invariant enforced at COMMIT: every posting group balances.
CREATE FUNCTION check_ledger_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(amount_kobo) FILTER (WHERE direction = 'DEBIT'), 0), coalesce(sum(amount_kobo) FILTER (WHERE direction = 'CREDIT'), 0)
    INTO d, c FROM ledger_entries WHERE group_id = NEW.group_id;
  IF d <> c THEN RAISE EXCEPTION 'ledger group % unbalanced: debits % credits %', NEW.group_id, d, c; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_group();

-- Balances derived from the ledger (credit-normal for vendor payable buckets).
CREATE VIEW vendor_balances AS
SELECT vendor_id,
  coalesce(sum(CASE WHEN account = 'vendor_payable_pending'   THEN CASE direction WHEN 'CREDIT' THEN amount_kobo ELSE -amount_kobo END END), 0)::bigint AS pending_kobo,
  coalesce(sum(CASE WHEN account = 'vendor_payable_available' THEN CASE direction WHEN 'CREDIT' THEN amount_kobo ELSE -amount_kobo END END), 0)::bigint AS available_kobo,
  coalesce(sum(CASE WHEN account = 'vendor_payable_hold'      THEN CASE direction WHEN 'CREDIT' THEN amount_kobo ELSE -amount_kobo END END), 0)::bigint AS hold_kobo,
  coalesce(sum(CASE WHEN account = 'payout_clearing' THEN amount_kobo END), 0)::bigint AS paid_out_kobo
FROM ledger_entries WHERE vendor_id IS NOT NULL GROUP BY vendor_id;

CREATE VIEW ledger_check AS
SELECT coalesce(sum(amount_kobo) FILTER (WHERE direction = 'DEBIT'), 0)::bigint AS total_debits,
       coalesce(sum(amount_kobo) FILTER (WHERE direction = 'CREDIT'), 0)::bigint AS total_credits,
       (SELECT count(*) FROM (SELECT group_id FROM ledger_entries GROUP BY group_id
          HAVING sum(amount_kobo) FILTER (WHERE direction = 'DEBIT') IS DISTINCT FROM sum(amount_kobo) FILTER (WHERE direction = 'CREDIT')) x)::bigint AS unbalanced_groups
FROM ledger_entries;

-- Least-privilege application role. Dev password; override with ALTER ROLE in real deployments.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oja_app') THEN CREATE ROLE oja_app LOGIN PASSWORD 'oja_app'; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO oja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oja_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oja_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries, payment_events FROM oja_app;
GRANT SELECT ON vendor_balances, ledger_check TO oja_app;
