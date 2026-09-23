-- AlterTable
ALTER TABLE "JobWork" ADD COLUMN     "invoiceNo" TEXT,
ADD COLUMN     "orderId" TEXT;

-- AddForeignKey
ALTER TABLE "JobWork" ADD CONSTRAINT "JobWork_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWork" ADD CONSTRAINT "JobWork_invoiceNo_fkey" FOREIGN KEY ("invoiceNo") REFERENCES "Invoice"("no") ON DELETE SET NULL ON UPDATE CASCADE;

