import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminBrand } from '@tyre/shared';

import { brandSlug } from '../../common/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditContext } from '../../audit/audit-context';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class BrandsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminBrand[]> {
    const brands = await this.prisma.brand.findMany({
      select: {
        id: true,
        name: true,
        defaultCountry: true,
        _count: { select: { products: true, tireModels: true } },
      },
      orderBy: { name: 'asc' },
    });
    return brands.map((b) => ({
      id: b.id,
      name: b.name,
      defaultCountry: b.defaultCountry,
      productCount: b._count.products,
      tireModelCount: b._count.tireModels,
    }));
  }

  async create(name: string, context: AuditContext): Promise<AdminBrand> {
    const id = brandSlug(name);
    if (id === '') {
      throw new ConflictException(`Name "${name}" produces an empty slug`);
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.brand.findFirst({
        where: { OR: [{ id }, { name: { equals: name, mode: 'insensitive' } }] },
      });
      if (existing) throw new ConflictException(`Brand "${name}" already exists (id "${existing.id}")`);
      const brand = await tx.brand.create({ data: { id, name } });
      const result = { id: brand.id, name: brand.name, defaultCountry: brand.defaultCountry, productCount: 0, tireModelCount: 0 };
      await this.audit.recordWithClient(tx, {
        ...context, action: 'catalog.brand.create', entityType: 'Brand', entityId: brand.id, after: result,
      });
      return result;
    });
  }

  /**
   * Rename only. The id (slug) deliberately stays stable: it is the public
   * bookmarkable URL segment (/brands/:id) and the products `brand` filter value,
   * so regenerating it on rename would break existing links.
   */
  async rename(id: string, name: string, context: AuditContext): Promise<AdminBrand> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUnique({
        where: { id }, include: { _count: { select: { products: true, tireModels: true } } },
      });
      if (!before) throw new NotFoundException(`Brand "${id}" not found`);
      const duplicate = await tx.brand.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, NOT: { id } },
      });
      if (duplicate) throw new ConflictException(`Another brand is already named "${name}"`);
      const brand = await tx.brand.update({
        where: { id },
        data: { name },
        include: { _count: { select: { products: true, tireModels: true } } },
      });
      const result = toAdminBrand(brand);
      await this.audit.recordWithClient(tx, {
        ...context, action: 'catalog.brand.rename', entityType: 'Brand', entityId: id,
        before: toAdminBrand(before), after: result,
      });
      return result;
    });
  }

  /** Refuses (409) unless the brand has zero products AND zero tire models. */
  async remove(id: string, context: AuditContext): Promise<{ deleted: true }> {
    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.findUnique({
        where: { id }, include: { _count: { select: { products: true, tireModels: true } } },
      });
      if (!brand) throw new NotFoundException(`Brand "${id}" not found`);
      if (brand._count.products > 0 || brand._count.tireModels > 0) {
        throw new ConflictException(
          `Brand "${brand.name}" has ${brand._count.products} products and ` +
            `${brand._count.tireModels} tire models — move or delete them first`,
        );
      }
      await tx.brand.delete({ where: { id } });
      await this.audit.recordWithClient(tx, {
        ...context, action: 'catalog.brand.delete', entityType: 'Brand', entityId: id,
        before: toAdminBrand(brand), after: null,
      });
      return { deleted: true };
    });
  }
}

function toAdminBrand(brand: {
  id: string;
  name: string;
  defaultCountry: string | null;
  _count: { products: number; tireModels: number };
}): AdminBrand {
  return {
    id: brand.id,
    name: brand.name,
    defaultCountry: brand.defaultCountry,
    productCount: brand._count.products,
    tireModelCount: brand._count.tireModels,
  };
}
