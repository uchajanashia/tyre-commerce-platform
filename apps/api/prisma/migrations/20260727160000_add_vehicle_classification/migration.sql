-- Additive only: preserves the authoritative passenger/truck vehicleClass.
ALTER TABLE "Product" ADD COLUMN "vehicleClassification" TEXT;

CREATE INDEX "Product_vehicleClassification_idx" ON "Product"("vehicleClassification");
