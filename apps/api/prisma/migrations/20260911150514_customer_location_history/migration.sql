-- CreateEnum
CREATE TYPE "GeoSource" AS ENUM ('ONBOARDING', 'OFFICE_EDIT', 'PORTAL_CHECKIN');

-- CreateTable
CREATE TABLE "CustomerLocation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "source" "GeoSource" NOT NULL,
    "by" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerLocation_customerId_at_idx" ON "CustomerLocation"("customerId", "at");

-- AddForeignKey
ALTER TABLE "CustomerLocation" ADD CONSTRAINT "CustomerLocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A firm that already carries a pin was pinned when it was onboarded. Seed the
-- trail with that fix so the history does not start empty for firms that have
-- one, and so "where was this shop when we signed it up" keeps its answer.
INSERT INTO "CustomerLocation" ("id", "customerId", "lat", "lng", "accuracy", "source", "by", "at")
SELECT gen_random_uuid()::text, "id", "lat", "lng", "geoAccuracy", 'ONBOARDING', 'Existing pin', COALESCE("geoAt", "createdAt")
FROM "Customer"
WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;
