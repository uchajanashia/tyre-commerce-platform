-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tireModelId" TEXT;

-- CreateTable
CREATE TABLE "TireModel" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TireModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TireModelPhoto" (
    "id" TEXT NOT NULL,
    "tireModelId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TireModelPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TireModel_brandId_slug_key" ON "TireModel"("brandId", "slug");

-- CreateIndex
CREATE INDEX "TireModelPhoto_tireModelId_idx" ON "TireModelPhoto"("tireModelId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tireModelId_fkey" FOREIGN KEY ("tireModelId") REFERENCES "TireModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireModel" ADD CONSTRAINT "TireModel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireModelPhoto" ADD CONSTRAINT "TireModelPhoto_tireModelId_fkey" FOREIGN KEY ("tireModelId") REFERENCES "TireModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
