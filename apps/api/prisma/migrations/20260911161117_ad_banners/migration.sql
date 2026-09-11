-- Banners gain a picture, a line to target, a link, a season and an order.
-- updatedAt is added with a default so the three rows already in the table
-- migrate rather than blocking; Prisma maintains it from here.
-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "itemId" TEXT,
ADD COLUMN     "lineId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Ad_isActive_sortOrder_idx" ON "Ad"("isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BusinessLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
