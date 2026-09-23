-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");

