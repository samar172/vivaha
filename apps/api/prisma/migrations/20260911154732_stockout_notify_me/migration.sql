-- AlterTable
ALTER TABLE "StockoutSearch" ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "notifyWanted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "StockoutSearch_notifyWanted_notifiedAt_idx" ON "StockoutSearch"("notifyWanted", "notifiedAt");
