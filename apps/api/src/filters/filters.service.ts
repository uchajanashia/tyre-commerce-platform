import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Distinct filter options so a front-end can build its filter UI. Derived live
 * from the published catalog (per docs/03-DATA-MODEL.md "Filters").
 */
@Injectable()
export class FiltersService {
  constructor(private readonly prisma: PrismaService) {}

  async options(): Promise<Record<string, unknown>> {
    const published = { isPublished: true } as const;

    const [radii, brands, seasonGroups, price] = await Promise.all([
      this.prisma.product.findMany({
        where: published,
        distinct: ['radius'],
        select: { radius: true },
        orderBy: { radius: 'asc' },
      }),
      this.prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.product.findMany({
        where: { ...published, seasonGroup: { not: null } },
        distinct: ['seasonGroup'],
        select: { seasonGroup: true },
      }),
      this.prisma.product.aggregate({
        where: published,
        _min: { retailPrice: true },
        _max: { retailPrice: true },
      }),
    ]);

    return {
      vehicleClass: ['passenger', 'truck'],
      productType: ['tire', 'disk'],
      seasonGroup: seasonGroups
        .map((s) => s.seasonGroup)
        .filter((s): s is NonNullable<typeof s> => s !== null),
      commercial: [true, false],
      radius: radii.map((r) => r.radius),
      brands,
      priceRange: {
        min: price._min.retailPrice,
        max: price._max.retailPrice,
        currency: 'GEL',
      },
    };
  }
}
