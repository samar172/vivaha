-- Bills go to a number somebody chose, not to whichever contact happened to be
-- first in the list. A firm can mark more than one — the owner and whoever
-- keeps the accounts is the usual pair.
ALTER TABLE "CustomerContact" ADD COLUMN "billsTo" BOOLEAN NOT NULL DEFAULT false;

-- The portal login issued against a person. Until now the only link between a
-- contact and their login was a name match, which breaks the moment two people
-- at a firm share a first name or one of them is renamed.
ALTER TABLE "CustomerContact" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "CustomerContact_userId_key" ON "CustomerContact"("userId");
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the link from the name match that was being used before, one login
-- per contact. Where two contacts at a firm carry the same name the match is
-- ambiguous, so the earlier row wins and the other is left unlinked rather
-- than guessed at — the owner can re-issue from the portal.
UPDATE "CustomerContact" c
SET "userId" = u.id
FROM "User" u
WHERE u."customerId" = c."customerId"
  AND u.role = 'CUSTOMER'
  AND u.name = c.name
  AND c."userId" IS NULL
  AND u.id = (
    SELECT u2.id FROM "User" u2
    WHERE u2."customerId" = c."customerId" AND u2.role = 'CUSTOMER' AND u2.name = c.name
    ORDER BY u2."createdAt" ASC LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM "CustomerContact" c2 WHERE c2."userId" = u.id);

-- hasLogin follows the link it was standing in for.
UPDATE "CustomerContact" SET "hasLogin" = true WHERE "userId" IS NOT NULL;

-- Bills go to the owner unless the firm says otherwise. Every firm has an owner
-- contact — the customer create path puts one there — so this leaves nobody
-- without a billing number.
UPDATE "CustomerContact" SET "billsTo" = true WHERE "authority" = 'Owner';

-- A firm whose owner row is missing (older seeded data) falls back to its
-- first contact, so the share dialog always has somebody to offer.
UPDATE "CustomerContact" c SET "billsTo" = true
WHERE c.id IN (
  SELECT DISTINCT ON (x."customerId") x.id FROM "CustomerContact" x
  WHERE NOT EXISTS (SELECT 1 FROM "CustomerContact" y WHERE y."customerId" = x."customerId" AND y."billsTo")
  ORDER BY x."customerId", x.id
);
