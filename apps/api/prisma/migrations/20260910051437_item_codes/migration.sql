-- CreateEnum
CREATE TYPE "CodeKind" AS ENUM ('MANUFACTURER', 'OWN');

-- CreateEnum
CREATE TYPE "CodeStatus" AS ENUM ('ACTIVE', 'REPLACED');

-- CreateTable
CREATE TABLE "ItemCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "CodeKind" NOT NULL,
    "status" "CodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "vendorId" TEXT,
    "note" TEXT,
    "replacedById" TEXT,
    "by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "ItemCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemCode_code_key" ON "ItemCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCode_replacedById_key" ON "ItemCode"("replacedById");

-- CreateIndex
CREATE INDEX "ItemCode_itemId_status_idx" ON "ItemCode"("itemId", "status");

-- AddForeignKey
ALTER TABLE "ItemCode" ADD CONSTRAINT "ItemCode_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCode" ADD CONSTRAINT "ItemCode_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCode" ADD CONSTRAINT "ItemCode_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ItemCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
