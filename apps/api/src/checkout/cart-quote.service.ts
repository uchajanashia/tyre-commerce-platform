import { BadRequestException, Injectable } from '@nestjs/common';
import type { ProductType, StockStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CartQuoteLine {
  productId: string;
  quantity: number;
}

export type CartQuoteIssue = 'not_found' | 'out_of_stock' | 'insufficient_quantity';

export interface QuoteProduct {
  id: string;
  productType: ProductType;
  code: string;
  name: string;
  retailPrice: number;
  currency: string;
  stockQty: number | null;
  reservedQty?: number;
  stockStatus: StockStatus;
  isPublished: boolean;
}

export interface CartQuoteItem {
  productId: string;
  code: string | null;
  name: string | null;
  quantity: number;
  available: boolean;
  issue: CartQuoteIssue | null;
  unitPrice: number | null;
  lineTotal: number | null;
  currency: string | null;
}

export interface CartQuote {
  items: CartQuoteItem[];
  total: number;
  currency: string | null;
  allAvailable: boolean;
}

const QUOTE_PRODUCT_SELECT = {
  id: true,
  productType: true,
  code: true,
  name: true,
  retailPrice: true,
  currency: true,
  stockQty: true,
  reservedQty: true,
  stockStatus: true,
  isPublished: true,
} as const;

function isSellableCatalogueProduct(product: QuoteProduct): boolean {
  return product.isPublished && product.productType === 'tire';
}

export function validateCartLines(lines: readonly CartQuoteLine[]): void {
  if (lines.length < 1 || lines.length > 24) {
    throw new BadRequestException('Cart must contain between 1 and 24 products');
  }
  const ids = new Set<string>();
  for (const line of lines) {
    if (!line.productId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 4) {
      throw new BadRequestException('Each cart quantity must be an integer from 1 to 4');
    }
    if (ids.has(line.productId)) {
      throw new BadRequestException('Each product may appear only once in a cart quote');
    }
    ids.add(line.productId);
  }
}

function availabilityIssue(product: QuoteProduct, quantity: number): CartQuoteIssue | null {
  if (!isSellableCatalogueProduct(product)) return 'not_found';
  if (product.stockQty !== null) {
    const available = product.stockQty - (product.reservedQty ?? 0);
    if (available <= 0) return 'out_of_stock';
    return available >= quantity ? null : 'insufficient_quantity';
  }
  if (process.env.OPERATIONS_WORKFLOWS_ENABLED === 'true') return 'out_of_stock';
  return product.stockStatus === 'out_of_stock' ? 'out_of_stock' : null;
}

/** Exact inventory is consumed only for a yes/no decision and never serialized. */
export function buildCartQuote(
  lines: readonly CartQuoteLine[],
  products: readonly QuoteProduct[],
): CartQuote {
  validateCartLines(lines);
  const byId = new Map(products.map((product) => [product.id, product]));
  const items: CartQuoteItem[] = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product || !isSellableCatalogueProduct(product)) {
      return {
        productId: line.productId,
        code: null,
        name: null,
        quantity: line.quantity,
        available: false,
        issue: 'not_found',
        unitPrice: null,
        lineTotal: null,
        currency: null,
      };
    }

    const issue = availabilityIssue(product, line.quantity);
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      quantity: line.quantity,
      available: issue === null,
      issue,
      unitPrice: product.retailPrice,
      lineTotal: issue === null ? product.retailPrice * line.quantity : null,
      currency: product.currency,
    };
  });

  const availableCurrencies = new Set(
    items.filter((item) => item.available).map((item) => item.currency).filter(Boolean),
  );
  const currency = availableCurrencies.size === 1 ? [...availableCurrencies][0]! : null;
  const total = items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
  return { items, total, currency, allAvailable: items.every((item) => item.available) };
}

@Injectable()
export class CartQuoteService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(lines: readonly CartQuoteLine[]): Promise<CartQuote> {
    validateCartLines(lines);
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((line) => line.productId) } },
      select: QUOTE_PRODUCT_SELECT,
    });
    return buildCartQuote(lines, products);
  }
}
