-- CreateTable
CREATE TABLE "SubRack" (
    "id" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SubRack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubRack_rackId_code_key" ON "SubRack"("rackId", "code");

-- AddForeignKey
ALTER TABLE "SubRack" ADD CONSTRAINT "SubRack_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

