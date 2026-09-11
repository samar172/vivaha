-- AlterTable
ALTER TABLE "BusinessLine" ADD COLUMN     "priceListAnnual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "priceListFy" TEXT;

-- Correcting an earlier reading of the rule. Cards were set to refuse per-firm
-- pricing entirely, on the understanding that "the card price list is fixed"
-- meant no customer-specific rates. It does not: the list is the
-- manufacturer's and is fixed for the financial year, while a dealer can still
-- be given their own price against it. Per-firm pricing goes back on.
UPDATE "BusinessLine" SET "allowCustomPricing" = true;

-- Cards are the line that runs on an annual published list.
UPDATE "BusinessLine" SET "priceListAnnual" = true WHERE "code" = 'cards';

-- Everything priced today belongs to the list standing now. Stamping the
-- current financial year means the first edit after this is treated as a
-- revision of the standing list rather than as next year's, which is the
-- honest reading of rates that were already in use.
UPDATE "Item" SET "priceListFy" =
  CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4
       THEN to_char(NOW(), 'YY') || '-' || to_char(NOW() + interval '1 year', 'YY')
       ELSE to_char(NOW() - interval '1 year', 'YY') || '-' || to_char(NOW(), 'YY')
  END
WHERE "priceListFy" IS NULL;
