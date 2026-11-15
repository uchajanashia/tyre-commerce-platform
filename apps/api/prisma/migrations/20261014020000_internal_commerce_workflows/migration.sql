-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reservedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "fulfillmentStatus" TEXT NOT NULL DEFAULT 'unallocated',
ADD COLUMN     "operationsNextCheckAt" TIMESTAMP(3),
ADD COLUMN     "refundedMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "reservationExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "issuedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommerceCustomer" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "onHandDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL,
    "onHandAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationsCommand" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "providerReference" TEXT NOT NULL,
    "providerActionId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCustomer_identityKey_key" ON "CommerceCustomer"("identityKey");

-- CreateIndex
CREATE INDEX "CommerceCustomer_emailKey_idx" ON "CommerceCustomer"("emailKey");

-- CreateIndex
CREATE INDEX "CommerceCustomer_phoneKey_idx" ON "CommerceCustomer"("phoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_orderItemId_key" ON "StockReservation"("orderItemId");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_state_idx" ON "StockReservation"("orderId", "state");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_createdAt_idx" ON "StockMovement"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_providerActionId_key" ON "RefundRequest"("providerActionId");

-- CreateIndex
CREATE INDEX "RefundRequest_state_nextAttemptAt_idx" ON "RefundRequest"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "RefundRequest_orderId_createdAt_idx" ON "RefundRequest"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Physical stock is independent from payment and reservation state.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_balance_check"
  CHECK ("reservedQty" >= 0 AND (("stockQty" IS NULL AND "reservedQty" = 0) OR ("stockQty" >= "reservedQty")));
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_fulfillment_check"
  CHECK ("returnedQty" >= 0 AND "issuedQty" >= "returnedQty" AND "issuedQty" <= "quantity");
ALTER TABLE "Order" ADD CONSTRAINT "Order_refunded_balance_check"
  CHECK ("refundedMinor" >= 0 AND "refundedMinor" <= "total"::bigint * 100);
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_state_check"
  CHECK ("quantity" >= 0 AND "state" IN ('active','committed','released','consumed'));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_balance_check"
  CHECK ("onHandAfter" >= "reservedAfter" AND "reservedAfter" >= 0);
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_amount_state_check"
  CHECK ("amountMinor" > 0 AND "attempts" >= 0 AND "state" IN ('queued','processing','needs_review','succeeded','failed'));

CREATE INDEX "Order_operationsNextCheckAt_idx" ON "Order"("operationsNextCheckAt");
CREATE INDEX "Order_reservationExpiresAt_idx" ON "Order"("reservationExpiresAt");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- Opening balances preserve known quantities. NULL remains unknown, never zero.
INSERT INTO "StockMovement" ("id","productId","kind","onHandDelta","reservedDelta","onHandAfter","reservedAfter","reason")
SELECT gen_random_uuid()::text,"id",'opening',"stockQty",0,"stockQty",0,'Opening balance at workflow migration'
FROM "Product" WHERE "stockQty" IS NOT NULL;

REVOKE ALL ON TABLE "CommerceCustomer", "StockReservation", "StockMovement", "OperationsCommand", "RefundRequest" FROM PUBLIC, tyre_app_runtime, tyre_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CommerceCustomer", "StockReservation", "OperationsCommand", "RefundRequest" TO tyre_app_runtime;
GRANT SELECT, INSERT ON TABLE "StockMovement" TO tyre_app_runtime;

INSERT INTO "Permission" ("id","key","description") VALUES
('perm-inventory-write','inventory.write','Record audited stock counts in the main warehouse'),
('perm-orders-fulfill','orders.fulfill','Allocate, issue and receive returned goods'),
('perm-payments-refund','payments.refund','Request bank refunds; additionally restricted to administrator role')
ON CONFLICT ("key") DO NOTHING;
