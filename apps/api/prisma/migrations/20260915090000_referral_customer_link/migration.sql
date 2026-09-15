-- Which firm a referral turned into. The report used to match referral to firm
-- on the name as typed, which the code itself flagged as a guess: "Marwar Card
-- Bhandar" written down by the referrer and "Marwar Cards Bhandar" registered
-- by the office are the same shop and never matched.
ALTER TABLE "Referral" ADD COLUMN "customerId" TEXT;
CREATE UNIQUE INDEX "Referral_customerId_key" ON "Referral"("customerId");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill with exactly the rule the report was already applying, so nothing
-- that was being reported as joined stops being reported as joined. A name
-- matching two firms is left unlinked rather than pointed at either.
UPDATE "Referral" r SET "customerId" = c.id
FROM "Customer" c
WHERE lower(btrim(c.name)) = lower(btrim(r.name))
  AND r."customerId" IS NULL
  AND c.id <> r."byId"
  AND (SELECT count(*) FROM "Customer" c2 WHERE lower(btrim(c2.name)) = lower(btrim(r.name))) = 1
  AND NOT EXISTS (SELECT 1 FROM "Referral" r2 WHERE r2."customerId" = c.id);
