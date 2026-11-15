-- Provider-independent order/payment foundation. No checkout or provider
-- endpoint is enabled by this additive migration.

CREATE TYPE "OrderStatus" AS ENUM (
  'draft',
  'awaiting_payment',
  'paid',
  'failed',
  'cancelled',
  'expired'
);

CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'created',
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'expired'
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'draft',
  "currency" TEXT NOT NULL DEFAULT 'GEL',
  "subtotal" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_nonnegative_amounts" CHECK ("subtotal" >= 0 AND "total" >= 0)
);

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "productCode" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 4),
  CONSTRAINT "OrderItem_nonnegative_amounts" CHECK ("unitPrice" >= 0 AND "lineTotal" >= 0),
  CONSTRAINT "OrderItem_line_total" CHECK ("lineTotal" = "unitPrice" * "quantity")
);

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "providerReference" TEXT,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'created',
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentEvent" (
  "id" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");
CREATE INDEX "PaymentAttempt_orderId_createdAt_idx" ON "PaymentAttempt"("orderId", "createdAt");
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerReference_key"
  ON "PaymentAttempt"("provider", "providerReference");
CREATE UNIQUE INDEX "PaymentEvent_deduplicationKey_key" ON "PaymentEvent"("deduplicationKey");
CREATE INDEX "PaymentEvent_paymentAttemptId_receivedAt_idx"
  ON "PaymentEvent"("paymentAttemptId", "receivedAt");

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent"
  ADD CONSTRAINT "PaymentEvent_paymentAttemptId_fkey"
  FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
