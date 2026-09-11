-- AlterTable
ALTER TABLE "Ad" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "CartRecovery" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "toName" TEXT NOT NULL DEFAULT '',
    "toPhone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "cartValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cartCount" INTEGER NOT NULL DEFAULT 0,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CartRecovery_customerId_at_idx" ON "CartRecovery"("customerId", "at");

-- AddForeignKey
ALTER TABLE "CartRecovery" ADD CONSTRAINT "CartRecovery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
