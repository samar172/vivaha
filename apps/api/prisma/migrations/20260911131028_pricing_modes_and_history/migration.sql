-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('FLAT', 'PERCENT');

-- AlterTable
ALTER TABLE "BusinessLine" ADD COLUMN     "allowCustomPricing" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "priceAdjPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PriceOverride" ADD COLUMN     "mode" "PriceMode" NOT NULL DEFAULT 'FLAT',
ADD COLUMN     "pct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "ItemPriceHistory" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" DECIMAL(12,2) NOT NULL,
    "newValue" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemPriceHistory_itemId_at_idx" ON "ItemPriceHistory"("itemId", "at");

-- AddForeignKey
ALTER TABLE "ItemPriceHistory" ADD CONSTRAINT "ItemPriceHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cards go out on a published price list that is the same for every firm;
-- flex, ACP and job work are negotiated. Existing per-customer overrides on
-- cards are left exactly as they are — this governs new ones.
UPDATE "BusinessLine" SET "allowCustomPricing" = false WHERE "code" = 'cards';
