BEGIN;
ALTER TABLE "Order" ADD COLUMN "receiptPdfEncrypted" TEXT;
ALTER TABLE "Order"
  ADD COLUMN "deliveryMethod" TEXT,
  ADD COLUMN "customerEncrypted" TEXT,
  ADD COLUMN "notificationStatus" TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "notificationNextAt" TIMESTAMP(3),
  ADD COLUMN "notificationLease" TEXT,
  ADD CONSTRAINT "Order_delivery_method" CHECK ("deliveryMethod" IS NULL OR "deliveryMethod" IN ('pickup','delivery')),
  ADD CONSTRAINT "Order_notification_status" CHECK ("notificationStatus" IN ('not_ready','pending','sending','delivered'));
ALTER TABLE "PaymentAttempt" ADD COLUMN "redirectUrl" TEXT;
CREATE INDEX "Order_notification_retry" ON "Order" ("notificationStatus", "notificationNextAt");
COMMIT;
