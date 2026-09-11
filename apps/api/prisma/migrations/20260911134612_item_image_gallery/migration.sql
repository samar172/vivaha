-- CreateTable
CREATE TABLE "ItemImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "by" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemImage_itemId_sortOrder_idx" ON "ItemImage"("itemId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ItemImage" ADD CONSTRAINT "ItemImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Items that already carry a photograph keep it, as page one of their gallery.
-- Without this an existing picture would still show as the cover but vanish
-- from the page list, which reads as data loss to whoever put it there.
INSERT INTO "ItemImage" ("id", "itemId", "url", "label", "sortOrder", "by", "at")
SELECT gen_random_uuid()::text, "id", "imageUrl", 'Front', 0, 'Existing photo', NOW()
FROM "Item"
WHERE "imageUrl" IS NOT NULL AND "imageUrl" <> '';
