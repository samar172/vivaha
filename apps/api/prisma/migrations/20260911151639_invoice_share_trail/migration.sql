-- CreateTable
CREATE TABLE "InvoiceShare" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "toName" TEXT NOT NULL DEFAULT '',
    "toPhone" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceShare_invoiceNo_at_idx" ON "InvoiceShare"("invoiceNo", "at");

-- AddForeignKey
ALTER TABLE "InvoiceShare" ADD CONSTRAINT "InvoiceShare_invoiceNo_fkey" FOREIGN KEY ("invoiceNo") REFERENCES "Invoice"("no") ON DELETE CASCADE ON UPDATE CASCADE;
