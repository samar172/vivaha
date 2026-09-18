-- CreateEnum
CREATE TYPE "DispatchMode" AS ENUM ('TRANSPORT', 'BUS');

-- DropIndex
DROP INDEX "StockBalance_itemId_godownId_batchNo_key";

-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "busNo" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "driverPhone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "loadedAt" TIMESTAMP(3),
ADD COLUMN     "mode" "DispatchMode" NOT NULL DEFAULT 'TRANSPORT',
ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN     "places" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "StockBalance" ADD COLUMN     "firstIn" TIMESTAMP(3),
ADD COLUMN     "rack" TEXT NOT NULL DEFAULT '-';

-- AlterTable
ALTER TABLE "StockTxn" ADD COLUMN     "rack" TEXT;

-- CreateTable
CREATE TABLE "Rack" (
    "id" TEXT NOT NULL,
    "godownId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchShare" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "toName" TEXT NOT NULL DEFAULT '',
    "toPhone" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rack_godownId_code_key" ON "Rack"("godownId", "code");

-- CreateIndex
CREATE INDEX "DispatchShare_dispatchId_at_idx" ON "DispatchShare"("dispatchId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_itemId_godownId_rack_batchNo_key" ON "StockBalance"("itemId", "godownId", "rack", "batchNo");

-- AddForeignKey
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_godownId_fkey" FOREIGN KEY ("godownId") REFERENCES "Godown"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchShare" ADD CONSTRAINT "DispatchShare_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Backfills ───────────────────────────────────────────────────────────────
-- Every pile already in a godown was put there at some point, and first-in-
-- first-out has to sort on something. The append-only movement log knows: the
-- earliest inward movement for that item, godown and batch is when the pile
-- started. Rows with no inward movement on file (stock keyed straight into a
-- balance) keep NULL and sort last, which is the honest answer — we do not
-- know when they landed and should not invent a date that would jump them to
-- the front of the queue.
UPDATE "StockBalance" b
SET "firstIn" = t."at"
FROM (
  SELECT "itemId", "godownId", COALESCE("batchNo", '-') AS bn, MIN("at") AS "at"
  FROM "StockTxn"
  WHERE "type" IN ('GRN', 'TRANSFER_IN')
  GROUP BY "itemId", "godownId", COALESCE("batchNo", '-')
) t
WHERE b."itemId" = t."itemId" AND b."godownId" = t."godownId" AND b."batchNo" = t.bn;

-- A receipt booked before racks existed put its goods somewhere; we know which
-- godown and how many, and not which shelf. Written out as placements with the
-- unrecorded rack so the two fields agree from the first day, rather than
-- leaving `places` empty and every old document looking unallocated.
UPDATE "PurchaseLine"
SET "places" = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('godownId', k, 'rack', '-', 'qty', v)), '[]'::jsonb)
  FROM jsonb_each_text("alloc"::jsonb) AS e(k, v)
  WHERE v::numeric > 0
)
WHERE "alloc" IS NOT NULL AND "alloc"::text <> '{}' AND "places"::text = '[]';
