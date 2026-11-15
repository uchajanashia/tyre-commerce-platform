-- Additive wallet-channel metadata. Existing BOG attempts are hosted payments.
ALTER TABLE "PaymentAttempt"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'hosted',
  ADD COLUMN "completionIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "PaymentAttempt_completionIdempotencyKey_key"
  ON "PaymentAttempt"("completionIdempotencyKey");
