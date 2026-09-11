-- The customer counter was seeded to the number of seeded firms (16) while
-- their ids run CUST-101..CUST-116. New firms were therefore numbered from
-- CUST-17, and the eighty-fifth would have been handed CUST-101 — a primary
-- key that already exists, failing customer creation outright from then on.
-- Advance the counter past the highest id actually in use. Idempotent, and it
-- never moves the counter backwards.
UPDATE "Sequence" s
SET "value" = GREATEST(
  s."value",
  (SELECT COALESCE(MAX((regexp_replace("id", '^CUST-', ''))::int), 0)
     FROM "Customer" WHERE "id" ~ '^CUST-[0-9]+$')
)
WHERE s."name" = 'CUST';
