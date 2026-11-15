-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('tire', 'disk');

-- CreateEnum
CREATE TYPE "VehicleClass" AS ENUM ('passenger', 'truck');

-- CreateEnum
CREATE TYPE "Construction" AS ENUM ('radial', 'bias');

-- CreateEnum
CREATE TYPE "SeasonGroup" AS ENUM ('summer', 'all_season', 'winter');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('in_stock', 'limited', 'out_of_stock');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "brandId" TEXT NOT NULL,
    "patternKey" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "profile" INTEGER,
    "rimDiameter" DOUBLE PRECISION NOT NULL,
    "radius" TEXT NOT NULL,
    "construction" "Construction" NOT NULL,
    "commercial" BOOLEAN NOT NULL,
    "overallDiameter" DOUBLE PRECISION,
    "loadSpeedIndex" TEXT,
    "plyRating" TEXT,
    "treadType" TEXT,
    "application" TEXT NOT NULL,
    "season" TEXT,
    "seasonGroup" "SeasonGroup",
    "country" TEXT,
    "unit" TEXT NOT NULL,
    "retailPrice" INTEGER NOT NULL,
    "wholesalePrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GEL',
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'in_stock',
    "stockQty" INTEGER,
    "name" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCountry" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_vehicleClass_idx" ON "Product"("vehicleClass");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- CreateIndex
CREATE INDEX "Product_seasonGroup_idx" ON "Product"("seasonGroup");

-- CreateIndex
CREATE INDEX "Product_radius_idx" ON "Product"("radius");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_commercial_idx" ON "Product"("commercial");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
