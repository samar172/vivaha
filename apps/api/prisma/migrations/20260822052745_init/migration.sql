-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'PURCHASE_MANAGER', 'SALES_EXECUTIVE', 'GODOWN_MANAGER', 'DISPATCH_MANAGER', 'ACCOUNTS_MANAGER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "NotifKind" AS ENUM ('INFO', 'OK', 'WARN', 'ERR');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('SLAB', 'AREA', 'QUOTE');

-- CreateEnum
CREATE TYPE "LineWorkflow" AS ENUM ('FULFIL', 'JOBWORK');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "GateMode" AS ENUM ('WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "StockTxnType" AS ENUM ('GRN', 'HOLD', 'HOLD_RELEASE', 'RESERVE', 'RESERVE_RELEASE', 'DISPATCH', 'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGE', 'QUARANTINE', 'RECOVER', 'WRITE_OFF', 'RETURN_IN', 'JOB_ISSUE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('IN_TRANSIT', 'POSTED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('BOOKED', 'APPROVED', 'RESERVED', 'ALLOCATED', 'PICKING', 'PICKED', 'PACKED', 'READY_TO_DISPATCH', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'DELIVERED', 'LAPSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('OPENING', 'INVOICE', 'PAYMENT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'INSPECTION', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ENQUIRY', 'QUOTED', 'ACCEPTED', 'PROOF_SENT', 'APPROVED_PROOF', 'PRINTING', 'QC', 'READY', 'DELIVERED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customerId" TEXT,
    "authority" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "role" "Role" NOT NULL,
    "perm" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role","perm")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL DEFAULT '',
    "newValue" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" "Role",
    "kind" "NotifKind" NOT NULL DEFAULT 'INFO',
    "text" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BusinessLine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "bg" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "packUoms" JSONB NOT NULL DEFAULT '[]',
    "minSetQty" INTEGER NOT NULL DEFAULT 0,
    "holdMins" INTEGER NOT NULL DEFAULT 30,
    "gstPct" INTEGER NOT NULL,
    "stockDims" JSONB NOT NULL DEFAULT '[]',
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'SLAB',
    "workflow" "LineWorkflow" NOT NULL DEFAULT 'FULFIL',
    "facets" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BusinessLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeDef" (
    "id" TEXT NOT NULL,
    "lineId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '[]',
    "multiSelect" BOOLEAN NOT NULL DEFAULT false,
    "portalFacet" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttributeDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Godown" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short" TEXT NOT NULL,
    "manager" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Godown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "terms" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingGroup" (
    "name" TEXT NOT NULL,
    "multiplier" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "PricingGroup_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "designNo" TEXT,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "attrs" JSONB NOT NULL DEFAULT '{}',
    "uom" TEXT NOT NULL,
    "packUom" TEXT NOT NULL DEFAULT '',
    "perPack" INTEGER NOT NULL DEFAULT 1,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "landedCost" DECIMAL(12,2) NOT NULL,
    "hsn" TEXT NOT NULL,
    "gstPct" INTEGER NOT NULL,
    "vendorId" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "season" TEXT,
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "wastagePct" DECIMAL(5,2),
    "setupCharge" DECIMAL(12,2),
    "artSeed" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSlab" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromQty" INTEGER NOT NULL,
    "toQty" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PriceSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "tehsil" TEXT NOT NULL,
    "creditLimit" DECIMAL(14,2) NOT NULL,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "gateMode" "GateMode" NOT NULL DEFAULT 'WARN',
    "gstin" TEXT,
    "firmType" TEXT NOT NULL DEFAULT 'Registered',
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "linesEnabled" JSONB NOT NULL DEFAULT '[]',
    "referCode" TEXT NOT NULL,
    "salesExecId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "blockReason" TEXT,
    "blockedBy" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "hasLogin" BOOLEAN NOT NULL DEFAULT false,
    "authority" TEXT NOT NULL DEFAULT 'Staff',

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMachine" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "spec" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "CustomerMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceOverride" (
    "customerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "setBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceOverride_pkey" PRIMARY KEY ("customerId","itemId")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "godownId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL DEFAULT '-',
    "expiry" TIMESTAMP(3),
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "hold" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "quarantined" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTxn" (
    "id" TEXT NOT NULL,
    "type" "StockTxnType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "godownId" TEXT NOT NULL,
    "batchNo" TEXT,
    "qty" INTEGER NOT NULL,
    "ref" TEXT,
    "reason" TEXT,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "invNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "eta" TIMESTAMP(3),
    "freight" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "gstPct" INTEGER NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'POSTED',
    "by" TEXT NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "alloc" JSONB NOT NULL DEFAULT '{}',
    "batchNo" TEXT,
    "expiry" TIMESTAMP(3),

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "batchNo" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'BOOKED',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "requiredBy" TIMESTAMP(3) NOT NULL,
    "holdUntil" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "bookedBy" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'portal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "slabRate" DECIMAL(12,2) NOT NULL,
    "mult" DECIMAL(6,3) NOT NULL,
    "priceSrc" TEXT NOT NULL DEFAULT 'slab',
    "amount" DECIMAL(14,2) NOT NULL,
    "gstPct" INTEGER NOT NULL,
    "hsn" TEXT NOT NULL,
    "alloc" JSONB NOT NULL DEFAULT '{}',
    "shipped" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "why" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "transporter" TEXT NOT NULL,
    "lr" TEXT NOT NULL,
    "tracking" TEXT NOT NULL DEFAULT '',
    "packages" INTEGER NOT NULL DEFAULT 1,
    "freight" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ewb" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "invoiceNo" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "no" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxable" DECIMAL(14,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL,
    "sgst" DECIMAL(14,2) NOT NULL,
    "igst" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Posted',

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("no")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "hsn" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "gstPct" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "LedgerType" NOT NULL,
    "ref" TEXT NOT NULL,
    "particular" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "hasPhoto" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "outcome" TEXT,
    "note" TEXT,
    "godownId" TEXT,
    "creditAmount" DECIMAL(14,2),
    "creditNoteNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobWork" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "baseItemId" TEXT NOT NULL,
    "processItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUOTED',
    "requiredBy" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "quote" DECIMAL(14,2) NOT NULL,
    "proofs" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitVersionItem" (
    "kitVersionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "KitVersionItem_pkey" PRIMARY KEY ("kitVersionId","itemId")
);

-- CreateTable
CREATE TABLE "Kit" (
    "customerId" TEXT NOT NULL,
    "kitVersionId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "lastScanAt" TIMESTAMP(3),
    "session" JSONB,

    CONSTRAINT "Kit_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "Cart" (
    "customerId" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tehsil" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'Submitted',
    "reward" DECIMAL(12,2) NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "target" JSONB NOT NULL DEFAULT '{}',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "taps" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockoutSearch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "customerId" TEXT,
    "reqQty" INTEGER NOT NULL,
    "availQty" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockoutSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_role_createdAt_idx" ON "Notification"("role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLine_code_key" ON "BusinessLine"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDef_lineId_key_key" ON "AttributeDef"("lineId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");

-- CreateIndex
CREATE INDEX "PriceSlab_itemId_fromQty_idx" ON "PriceSlab"("itemId", "fromQty");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_referCode_key" ON "Customer"("referCode");

-- CreateIndex
CREATE INDEX "StockBalance_itemId_idx" ON "StockBalance"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_itemId_godownId_batchNo_key" ON "StockBalance"("itemId", "godownId", "batchNo");

-- CreateIndex
CREATE INDEX "StockTxn_itemId_at_idx" ON "StockTxn"("itemId", "at");

-- CreateIndex
CREATE INDEX "StockTxn_ref_idx" ON "StockTxn"("ref");

-- CreateIndex
CREATE INDEX "Purchase_vendorId_date_idx" ON "Purchase"("vendorId", "date");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_holdUntil_idx" ON "Order"("status", "holdUntil");

-- CreateIndex
CREATE INDEX "Invoice_customerId_date_idx" ON "Invoice"("customerId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_customerId_date_idx" ON "LedgerEntry"("customerId", "date");

-- CreateIndex
CREATE INDEX "StockoutSearch_itemId_at_idx" ON "StockoutSearch"("itemId", "at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeDef" ADD CONSTRAINT "AttributeDef_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BusinessLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BusinessLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSlab" ADD CONSTRAINT "PriceSlab_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salesExecId_fkey" FOREIGN KEY ("salesExecId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMachine" ADD CONSTRAINT "CustomerMachine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceOverride" ADD CONSTRAINT "PriceOverride_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceOverride" ADD CONSTRAINT "PriceOverride_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_godownId_fkey" FOREIGN KEY ("godownId") REFERENCES "Godown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTxn" ADD CONSTRAINT "StockTxn_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTxn" ADD CONSTRAINT "StockTxn_godownId_fkey" FOREIGN KEY ("godownId") REFERENCES "Godown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Godown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Godown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BusinessLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceNo_fkey" FOREIGN KEY ("invoiceNo") REFERENCES "Invoice"("no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWork" ADD CONSTRAINT "JobWork_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWork" ADD CONSTRAINT "JobWork_baseItemId_fkey" FOREIGN KEY ("baseItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobWork" ADD CONSTRAINT "JobWork_processItemId_fkey" FOREIGN KEY ("processItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitVersionItem" ADD CONSTRAINT "KitVersionItem_kitVersionId_fkey" FOREIGN KEY ("kitVersionId") REFERENCES "KitVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitVersionItem" ADD CONSTRAINT "KitVersionItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kit" ADD CONSTRAINT "Kit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kit" ADD CONSTRAINT "Kit_kitVersionId_fkey" FOREIGN KEY ("kitVersionId") REFERENCES "KitVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockoutSearch" ADD CONSTRAINT "StockoutSearch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockoutSearch" ADD CONSTRAINT "StockoutSearch_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
