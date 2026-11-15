import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<
    { id: string; name: string; defaultCountry: string | null; productCount: number }[]
  > {
    const brands = await this.prisma.brand.findMany({
      select: {
        id: true,
        name: true,
        defaultCountry: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    return brands.map((b) => ({
      id: b.id,
      name: b.name,
      defaultCountry: b.defaultCountry,
      productCount: b._count.products,
    }));
  }

  async findOne(
    id: string,
  ): Promise<{ id: string; name: string; defaultCountry: string | null; productCount: number }> {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        defaultCountry: true,
        _count: { select: { products: true } },
      },
    });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return {
      id: brand.id,
      name: brand.name,
      defaultCountry: brand.defaultCountry,
      productCount: brand._count.products,
    };
  }
}
