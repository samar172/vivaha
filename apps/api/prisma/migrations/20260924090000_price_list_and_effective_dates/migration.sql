-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "purchasePrice" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "PriceChange" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "purchasePrice" DECIMAL(12,2),
    "multiplier" DECIMAL(6,3),
    "slabs" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceChange_status_effectiveFrom_idx" ON "PriceChange"("status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PriceChange_itemId_effectiveFrom_idx" ON "PriceChange"("itemId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "PriceChange" ADD CONSTRAINT "PriceChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The supplier's own rate, seeded from the most recent purchase line for each
-- item. Landed cost carries freight and moves with every receipt; this is the
-- figure on the supplier's invoice, which is what the office prices off. Items
-- never purchased keep NULL, which reads as "nobody has told us yet" rather
-- than as a price of zero.
UPDATE "Item" i
SET "purchasePrice" = l."rate"
FROM (
  SELECT DISTINCT ON (pl."itemId") pl."itemId", pl."rate"
  FROM "PurchaseLine" pl
  JOIN "Purchase" p ON p."id" = pl."purchaseId"
  ORDER BY pl."itemId", p."date" DESC, p."id" DESC
) l
WHERE i."id" = l."itemId";
