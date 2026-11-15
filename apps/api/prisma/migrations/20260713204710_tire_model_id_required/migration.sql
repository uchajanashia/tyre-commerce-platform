/*
  Warnings:

  - Made the column `tireModelId` on table `Product` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_tireModelId_fkey";

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "tireModelId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Product_tireModelId_idx" ON "Product"("tireModelId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tireModelId_fkey" FOREIGN KEY ("tireModelId") REFERENCES "TireModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
