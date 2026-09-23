-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "manualBase" DECIMAL(12,2),
ADD COLUMN     "priceBasis" TEXT NOT NULL DEFAULT 'PURCHASE';

-- AlterTable
ALTER TABLE "PriceChange" ADD COLUMN     "manualBase" DECIMAL(12,2),
ADD COLUMN     "priceBasis" TEXT;

