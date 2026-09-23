-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "proofUrl" TEXT,
ADD COLUMN     "settlementId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "upiId" TEXT;

-- AlterTable
ALTER TABLE "VendorPayment" ADD COLUMN     "settlementId" TEXT;

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Settlement_customerId_at_idx" ON "Settlement"("customerId", "at");

-- CreateIndex
CREATE INDEX "Settlement_vendorId_at_idx" ON "Settlement"("vendorId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_settlementId_key" ON "Payment"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPayment_settlementId_key" ON "VendorPayment"("settlementId");

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

