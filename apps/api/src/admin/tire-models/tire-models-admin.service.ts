import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AdminTireModelDetail, AdminTireModelList } from '@tyre/shared';

import { stockStatusForQuantity } from '../../common/inventory.util';
import {
  DEFAULT_UNIT,
  composePatternKey,
  composeProductName,
  composeProductSlug,
  composeRadius,
  composeSize,
  defaultApplication,
} from '../../common/product-compose.util';
import { brandSlug } from '../../common/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { deriveSizeSystem, isValidSizeClass } from '../../products/tire-size-system';
import { AuditContext } from '../../audit/audit-context';
import { AuditService } from '../../audit/audit.service';
import { CreateProductDto, CreateTireModelDto, ListTireModelsQuery, UpdateProductDto, UpdateTireModelDto } from './dto/tire-model.dto';

/** Sizes ordered the way a human reads a size chart: rim, then width, then profile. */
const PRODUCT_ORDER: Prisma.ProductOrderByWithRelationInput[] = [
  { rimDiameter: 'asc' },
  { width: 'asc' },
  { profile: 'asc' },
];

@Injectable()
export class TireModelsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTireModelsQuery): Promise<AdminTireModelList> {
    const where: Prisma.TireModelWhereInput = {};
    if (query.brand) where.brandId = query.brand;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
    if (query.photos === 'with') where.photos = { some: {} };
    if (query.photos === 'without') where.photos = { none: {} };

    const [total, models] = await this.prisma.$transaction([
      this.prisma.tireModel.count({ where }),
      this.prisma.tireModel.findMany({
        where,
        include: {
          brand: { select: { id: true, name: true } },
          _count: { select: { products: true, photos: true } },
        },
        orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: models.map((m) => ({
        id: m.id,
        name: m.name,
        slug: m.slug,
        brand: m.brand,
        productCount: m._count.products,
        photoCount: m._count.photos,
      })),
    };
  }

  async detail(id: string): Promise<AdminTireModelDetail> {
    const model = await this.prisma.tireModel.findUnique({
      where: { id },
      include: {
        brand: { select: { id: true, name: true } },
        photos: { orderBy: { position: 'asc' } },
        products: { orderBy: PRODUCT_ORDER },
      },
    });
    if (!model) throw new NotFoundException(`Tire model "${id}" not found`);
    return {
      id: model.id,
      name: model.name,
      slug: model.slug,
      brand: model.brand,
      photoCount: model.photos.length,
      photos: model.photos.map((p) => ({ id: p.id, url: this.storage.publicUrl(p.url), position: p.position })),
      products: model.products.map(serializeProduct),
    };
  }

  /**
   * Create a model. TireModel itself carries no patternKey — that string lives on
   * Product rows (the public site derives the displayed model name from it) and is
   * composed per-product on size creation, so an empty model needs nothing here.
   */
  async createModel(dto: CreateTireModelDto, context: AuditContext) {
    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.findUnique({ where: { id: dto.brandId } });
      if (!brand) throw new NotFoundException(`Brand "${dto.brandId}" not found`);
      const slug = brandSlug(dto.name);
      if (slug === '') throw new ConflictException(`Name "${dto.name}" produces an empty slug`);
      const existing = await tx.tireModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug } } });
      if (existing) throw new ConflictException(`Brand ${brand.name} already has a model "${existing.name}"`);
      const model = await tx.tireModel.create({
        data: { brandId: brand.id, name: dto.name, slug },
        include: { brand: { select: { id: true, name: true } } },
      });
      const result = { id: model.id, name: model.name, slug: model.slug, brand: model.brand, productCount: 0, photoCount: 0 };
      await this.audit.recordWithClient(tx, {
        ...context, action: 'catalog.tire_model.create', entityType: 'TireModel', entityId: model.id, after: result,
      });
      return result;
    });
  }

  /**
   * Rename. The model slug is NOT public-facing (no public endpoint exposes
   * TireModel), so it is regenerated from the new name. Products' patternKey IS
   * public-facing (the storefront derives the displayed model name from it), so
   * every product of the model gets the recomposed "{BRAND} {MODEL}" key.
   */
  async renameModel(id: string, dto: UpdateTireModelDto, context: AuditContext) {
    return this.prisma.$transaction(async (tx) => {
    const model = await tx.tireModel.findUnique({
      where: { id },
      include: { brand: { select: { id: true, name: true } } },
    });
    if (!model) throw new NotFoundException(`Tire model "${id}" not found`);

    const slug = brandSlug(dto.name);
    if (slug === '') throw new ConflictException(`Name "${dto.name}" produces an empty slug`);

    const clash = await tx.tireModel.findFirst({
      where: { brandId: model.brandId, slug, NOT: { id } },
    });
    if (clash) {
      throw new ConflictException(`Brand ${model.brand.name} already has a model "${clash.name}"`);
    }

    const updated = await tx.tireModel.update({
        where: { id },
        data: { name: dto.name, slug },
        include: {
          brand: { select: { id: true, name: true } },
          _count: { select: { products: true, photos: true } },
        },
      });
      await tx.product.updateMany({
        where: { tireModelId: id },
        data: { patternKey: composePatternKey(model.brand.name, dto.name) },
      });
    const result = {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      brand: updated.brand,
      productCount: updated._count.products,
      photoCount: updated._count.photos,
    };
    await this.audit.recordWithClient(tx, {
      ...context, action: 'catalog.tire_model.rename', entityType: 'TireModel', entityId: id,
      before: { id: model.id, name: model.name, slug: model.slug, brand: model.brand }, after: result,
    });
    return result;
    });
  }

  /** Same policy as brands: only empty models (no products, no photos) can go. */
  async removeModel(id: string, context: AuditContext): Promise<{ deleted: true }> {
    return this.prisma.$transaction(async (tx) => {
    const model = await tx.tireModel.findUnique({
      where: { id },
      include: { _count: { select: { products: true, photos: true } } },
    });
    if (!model) throw new NotFoundException(`Tire model "${id}" not found`);
    if (model._count.products > 0 || model._count.photos > 0) {
      throw new ConflictException(
        `Model "${model.name}" has ${model._count.products} sizes and ` +
          `${model._count.photos} photos — delete them first`,
      );
    }
    await tx.tireModel.delete({ where: { id } });
    await this.audit.recordWithClient(tx, {
      ...context, action: 'catalog.tire_model.delete', entityType: 'TireModel', entityId: id,
      before: model, after: null,
    });
    return { deleted: true };
    });
  }

  async createProduct(modelId: string, dto: CreateProductDto, context: AuditContext) {
    return this.prisma.$transaction(async (tx) => {
    const model = await tx.tireModel.findUnique({
      where: { id: modelId },
      include: { brand: { select: { id: true, name: true } } },
    });
    if (!model) throw new NotFoundException(`Tire model "${modelId}" not found`);

    const profile = dto.profile ?? null;
    const size = dto.size ?? composeSize(dto.width, profile, dto.rimDiameter, dto.commercial);
    const productType = dto.productType ?? 'tire';
    const sizeSystem = deriveSizeSystem({ productType, width: dto.width });
    if (!isValidSizeClass(productType, dto.vehicleClass, sizeSystem)) {
      throw new BadRequestException('Inch-based tires must use vehicleClass "truck".');
    }
    const slug = composeProductSlug(size, model.brand.id, dto.code);
    if (process.env.OPERATIONS_WORKFLOWS_ENABLED === "true" && dto.stockQty != null) throw new BadRequestException("Enter opening stock in inventory");
    const stockQty = dto.stockQty ?? null;
    const stockStatus = stockStatusForQuantity(stockQty, dto.stockStatus ?? 'in_stock');

    const existing = await tx.product.findFirst({
      where: { OR: [{ id: dto.code }, { slug }] },
    });
    if (existing) {
      throw new ConflictException(`Product with SKU "${dto.code}" already exists`);
    }

    const product = await tx.product.create({
      data: {
        id: dto.code,
        code: dto.code,
        slug,
        productType,
        vehicleClass: dto.vehicleClass,
        sizeSystem,
        brandId: model.brand.id,
        patternKey: composePatternKey(model.brand.name, model.name),
        tireModelId: model.id,
        size,
        width: dto.width,
        profile,
        rimDiameter: dto.rimDiameter,
        radius: composeRadius(dto.rimDiameter, dto.commercial),
        construction: dto.construction,
        commercial: dto.commercial,
        overallDiameter: dto.overallDiameter ?? null,
        loadSpeedIndex: dto.loadSpeedIndex ?? null,
        plyRating: dto.plyRating ?? null,
        treadType: dto.treadType ?? null,
        application: dto.application ?? defaultApplication(dto.commercial),
        season: dto.season ?? null,
        seasonGroup: dto.seasonGroup ?? null,
        country: dto.country ?? null,
        unit: DEFAULT_UNIT,
        retailPrice: dto.retailPrice,
        wholesalePrice: dto.wholesalePrice,
        stockStatus,
        stockQty,
        isPublished: dto.isPublished ?? true,
        name: composeProductName(size, model.name, dto.loadSpeedIndex ?? null, model.brand.name),
      },
    });
    const result = serializeProduct(product);
    await this.audit.recordWithClient(tx, {
      ...context, action: 'catalog.product.create', entityType: 'Product', entityId: product.id, after: result,
      metadata: { tireModelId: modelId },
    });
    return result;
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto, context: AuditContext) {
    return this.prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      include: { tireModel: { include: { brand: { select: { id: true, name: true } } } } },
    });
    if (!product) throw new NotFoundException(`Product "${id}" not found`);

    const data: Prisma.ProductUpdateInput = {};
    for (const key of [
      'construction', 'vehicleClass', 'productType', 'season', 'seasonGroup',
      'loadSpeedIndex', 'plyRating', 'treadType', 'overallDiameter', 'country',
      'retailPrice', 'wholesalePrice', 'isPublished',
      'application', 'width', 'profile', 'rimDiameter', 'commercial',
    ] as const) {
      if (dto[key] !== undefined) (data as Record<string, unknown>)[key] = dto[key];
    }

    // A known exact count is authoritative. If no count exists, the explicit
    // internal status remains the source of truth until inventory is supplied.
    if (process.env.OPERATIONS_WORKFLOWS_ENABLED === "true" && ((dto.stockQty !== undefined && dto.stockQty !== product.stockQty) || (dto.stockStatus !== undefined && dto.stockStatus !== product.stockStatus))) throw new BadRequestException("Manage stock in inventory");
    if (process.env.OPERATIONS_WORKFLOWS_ENABLED !== "true" && (dto.stockQty !== undefined || dto.stockStatus !== undefined)) {
      const stockQty = dto.stockQty !== undefined ? dto.stockQty : product.stockQty;
      const storedStatus = dto.stockStatus ?? product.stockStatus;
      if (dto.stockQty !== undefined) data.stockQty = dto.stockQty;
      data.stockStatus = stockStatusForQuantity(stockQty, storedStatus);
    }

    // Any size-defining change recomposes the derived strings, keeping the row
    // consistent the same way createProduct would build it.
    const sizeTouched =
      dto.width !== undefined ||
      dto.profile !== undefined ||
      dto.rimDiameter !== undefined ||
      dto.commercial !== undefined ||
      dto.size !== undefined ||
      dto.loadSpeedIndex !== undefined;

    if (sizeTouched) {
      const width = dto.width ?? product.width;
      const profile = dto.profile !== undefined ? dto.profile : product.profile;
      const rim = dto.rimDiameter ?? product.rimDiameter;
      const commercial = dto.commercial ?? product.commercial;
      const lsi = dto.loadSpeedIndex !== undefined ? dto.loadSpeedIndex : product.loadSpeedIndex;
      const size = dto.size ?? composeSize(width, profile, rim, commercial);

      data.size = size;
      data.radius = composeRadius(rim, commercial);
      data.slug = composeProductSlug(size, product.tireModel.brand.id, product.code);
      data.name = composeProductName(size, product.tireModel.name, lsi, product.tireModel.brand.name);
    }

    const finalProductType = dto.productType ?? product.productType;
    const finalVehicleClass = dto.vehicleClass ?? product.vehicleClass;
    const finalWidth = dto.width ?? product.width;
    const finalSizeSystem = deriveSizeSystem({
      productType: finalProductType,
      width: finalWidth,
    });
    if (!isValidSizeClass(finalProductType, finalVehicleClass, finalSizeSystem)) {
      throw new BadRequestException('Inch-based tires must use vehicleClass "truck".');
    }
    data.sizeSystem = finalSizeSystem;

    const updated = await tx.product.update({ where: { id }, data });
    const before = serializeProduct(product);
    const after = serializeProduct(updated);
    await this.audit.recordWithClient(tx, {
      ...context, action: 'catalog.product.update', entityType: 'Product', entityId: id, before, after,
    });
    return after;
    });
  }

  async removeProduct(id: string, context: AuditContext): Promise<{ deleted: true }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException(`Product "${id}" not found`);
      await tx.product.delete({ where: { id } });
      await this.audit.recordWithClient(tx, {
        ...context, action: 'catalog.product.delete', entityType: 'Product', entityId: id,
        before: serializeProduct(product), after: null,
      });
      return { deleted: true };
    });
  }
}

/** Dates → ISO strings so the wire shape matches @tyre/shared AdminProduct. */
function serializeProduct<T extends { createdAt: Date; updatedAt: Date; tireModel?: unknown }>(
  p: T,
): Omit<T, 'createdAt' | 'updatedAt' | 'tireModel'> & { createdAt: string; updatedAt: string } {
  const { tireModel: _tireModel, createdAt, updatedAt, ...rest } = p;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}
