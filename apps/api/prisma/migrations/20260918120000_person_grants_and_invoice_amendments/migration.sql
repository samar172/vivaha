-- CreateTable
CREATE TABLE "UserPermission" (
    "userId" TEXT NOT NULL,
    "perm" TEXT NOT NULL,
    "allow" BOOLEAN NOT NULL DEFAULT true,
    "by" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("userId","perm")
);

-- CreateTable
CREATE TABLE "InvoiceAmendment" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "oldTotal" DECIMAL(14,2) NOT NULL,
    "newTotal" DECIMAL(14,2) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '[]',
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceAmendment_invoiceNo_at_idx" ON "InvoiceAmendment"("invoiceNo", "at");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAmendment" ADD CONSTRAINT "InvoiceAmendment_invoiceNo_fkey" FOREIGN KEY ("invoiceNo") REFERENCES "Invoice"("no") ON DELETE CASCADE ON UPDATE CASCADE;


-- The new capability is granted to nobody by default, not even Accounts. It is
-- given to a named person from Settings → Users & logins, which is the point of
-- a per-person grant — so there is no backfill to do here, deliberately. A
-- Super Admin has every capability by way of holding every row already.
INSERT INTO "RolePermission" ("role", "perm")
SELECT 'SUPER_ADMIN', 'invoice.amend'
WHERE EXISTS (SELECT 1 FROM "RolePermission" WHERE "role" = 'SUPER_ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "RolePermission" WHERE "role" = 'SUPER_ADMIN' AND "perm" = 'invoice.amend');
