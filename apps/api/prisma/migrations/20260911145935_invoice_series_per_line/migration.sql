-- AlterTable
ALTER TABLE "BusinessLine" ADD COLUMN     "invoicePrefix" TEXT NOT NULL DEFAULT 'VC',
ADD COLUMN     "invoiceStart" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "lineId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_lineId_date_idx" ON "Invoice"("lineId", "date");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BusinessLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A sensible starting series per line. Cards keep VC, which is what every
-- invoice raised so far already carries; the others get their own so a flex
-- invoice and a card invoice are never the same number.
UPDATE "BusinessLine" SET "invoicePrefix" = 'VC'  WHERE "code" = 'cards';
UPDATE "BusinessLine" SET "invoicePrefix" = 'VCN' WHERE "code" = 'consumables';
UPDATE "BusinessLine" SET "invoicePrefix" = 'VFX' WHERE "code" = 'signage';
UPDATE "BusinessLine" SET "invoicePrefix" = 'VAC' WHERE "code" = 'acp';
UPDATE "BusinessLine" SET "invoicePrefix" = 'VJW' WHERE "code" = 'jobwork';

-- Existing invoices predate the split and all belong to whichever line their
-- order was for. Derived from the order's own lines, which are unambiguous
-- because an order is confined to a single business line.
UPDATE "Invoice" i
SET "lineId" = sub."lineId"
FROM (
  SELECT ol."orderId", MIN(ol."lineId") AS "lineId"
  FROM "OrderLine" ol
  GROUP BY ol."orderId"
) AS sub
WHERE i."orderId" = sub."orderId" AND i."lineId" IS NULL;
