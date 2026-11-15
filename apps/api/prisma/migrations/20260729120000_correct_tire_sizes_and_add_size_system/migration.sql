-- Keep metric and inch-based catalog sizes explicit. Inch sizes use several
-- incompatible sidewall formats, so they are selected by their complete label.
CREATE TYPE "SizeSystem" AS ENUM ('metric', 'inch');

ALTER TABLE "Product"
ADD COLUMN "sizeSystem" "SizeSystem" NOT NULL DEFAULT 'metric';

-- The authoritative replacements are the values written in parentheses in
-- შესწორება.xlsx / "მიმდინარე ზომა".
WITH corrections(id, old_size, new_size, width, profile, rim, slug) AS (
  VALUES
    ('002349', '31x10.5R15',  '265/70R15', 265.0, 70, 15.0, '265-70r15-roadx-002349'),
    ('002413', '31x10.5R15',  '265/70R15', 265.0, 70, 15.0, '265-70r15-roadx-002413'),
    ('003019', '33X12.5R17',  '315/65R17', 315.0, 65, 17.0, '315-65r17-roadx-003019'),
    ('003460', '31x10.5R15',  '265/70R15', 265.0, 70, 15.0, '265-70r15-roadx-003460'),
    ('003463', '33x12.5R15',  '315/70R15', 315.0, 70, 15.0, '315-70r15-roadx-003463'),
    ('003464', '35x12.5R15',  '315/80R15', 315.0, 80, 15.0, '315-80r15-roadx-003464'),
    ('003468', '35x12.5R17',  '315/75R17', 315.0, 75, 17.0, '315-75r17-roadx-003468'),
    ('003957', '33x12.5R18',  '315/60R18', 315.0, 60, 18.0, '315-60r18-roadx-003957'),
    ('004091', '35x12.50R18', '315/70R18', 315.0, 70, 18.0, '315-70r18-roadx-004091'),
    ('004588', '35x12.50R20', '315/60R20', 315.0, 60, 20.0, '315-60r20-roadx-004588'),
    ('004703', '35X12.50R16', '315/75R16', 315.0, 75, 16.0, '315-75r16-lakesea-004703')
)
UPDATE "Product" AS product
SET
  "size" = corrections.new_size,
  "width" = corrections.width,
  "profile" = corrections.profile,
  "rimDiameter" = corrections.rim,
  "radius" = 'R-' || regexp_replace(corrections.rim::text, '\.0+$', ''),
  "slug" = corrections.slug,
  "name" = replace(product."name", corrections.old_size, corrections.new_size),
  "updatedAt" = CURRENT_TIMESTAMP
FROM corrections
WHERE product."id" = corrections.id
  AND product."size" = corrections.old_size;

-- /00 is not an aspect ratio. Preserve these commercial inch sizes in their
-- standard numeric form and store no fabricated zero profile.
UPDATE "Product"
SET
  "size" = replace("size", '/00R', '.00R'),
  "name" = replace("name", "size", replace("size", '/00R', '.00R')),
  "profile" = CASE WHEN "profile" = 0 THEN NULL ELSE "profile" END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "productType" = 'tire'
  AND "size" LIKE '%/00R%';

UPDATE "Product"
SET "sizeSystem" = 'inch'
WHERE "productType" = 'disk' OR "width" < 100;

-- After applying the spreadsheet's metric replacements, the remaining
-- inch-width passenger rows are numeric LT tires and belong to truck.
UPDATE "Product"
SET
  "vehicleClass" = 'truck',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "productType" = 'tire'
  AND "sizeSystem" = 'inch'
  AND "vehicleClass" = 'passenger';

ALTER TABLE "Product"
ADD CONSTRAINT "Product_profile_positive"
CHECK ("profile" IS NULL OR "profile" > 0);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_inch_tire_not_passenger"
CHECK (
  "productType" = 'disk'
  OR "sizeSystem" = 'metric'
  OR "vehicleClass" = 'truck'
);

CREATE INDEX "Product_sizeSystem_idx" ON "Product"("sizeSystem");

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Product" WHERE "profile" = 0) <> 0 THEN
    RAISE EXCEPTION 'profile=0 invariant failed';
  END IF;
  IF (SELECT COUNT(*) FROM "Product"
      WHERE "productType" = 'tire'
        AND "sizeSystem" = 'inch'
        AND "vehicleClass" = 'passenger') <> 0 THEN
    RAISE EXCEPTION 'inch passenger invariant failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product")
     AND (SELECT COUNT(*) FROM "Product"
      WHERE "id" IN ('002349','002413','003019','003460','003463','003464','003468','003957','004091','004588','004703')
        AND "sizeSystem" = 'metric'
        AND "width" >= 100
        AND "profile" > 0) <> 11 THEN
    RAISE EXCEPTION 'spreadsheet metric correction count failed';
  END IF;
END $$;
