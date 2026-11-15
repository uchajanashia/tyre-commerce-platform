import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveVehicleClass,
  type OperationsPage,
  type OperationsSummary,
} from "@tyre/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsQuery } from "./operations.query";
import { checkedStatus } from "./commerce-reader.service";

@Injectable()
export class InventoryReaderService {
  constructor(private readonly db: PrismaService) {}
  async summary(): Promise<NonNullable<OperationsSummary["catalog"]>> {
    const [products, unknownStock, withoutPhotos] = await this.db.$transaction(
      [
        this.db.product.count(),
        this.db.product.count({ where: { stockQty: null } }),
        this.db.tireModel.count({ where: { photos: { none: {} } } }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { products, unknownStock, withoutPhotos };
  }
  async list(
    query: OperationsQuery,
    tiresOnly = false,
  ): Promise<OperationsPage> {
    const status = checkedStatus(query.status, [
      "unknown",
      "in_stock",
      "out_of_stock",
      "unpublished",
    ]);
    const where: Prisma.ProductWhereInput = {
      ...(tiresOnly ? { productType: "tire" as const } : {}),
      ...(status === "unknown" ? { stockQty: null } : {}),
      ...(status === "in_stock"
        ? { stockQty: { gt: 0 }, isPublished: true }
        : {}),
      ...(status === "out_of_stock"
        ? { stockQty: { lte: 0 }, isPublished: true }
        : {}),
      ...(status === "unpublished" ? { isPublished: false } : {}),
      ...(query.q?.trim()
        ? {
            AND: [
              {
                OR: ["code", "name", "size"].map((key) => ({
                  [key]: { contains: query.q!.trim(), mode: "insensitive" },
                })),
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.product.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: [{ code: "asc" }, { id: "asc" }],
          select: {
            id: true,
            code: true,
            name: true,
            size: true,
            stockQty: true,
            reservedQty: true,
            stockStatus: true,
            retailPrice: true,
            currency: true,
            isPublished: true,
            updatedAt: true,
            tireModelId: true,
            vehicleClassification: true,
            productType: true,
            vehicleClass: true,
            width: true,
            profile: true,
            rimDiameter: true,
            commercial: true,
            application: true,
            treadType: true,
          },
        }),
        this.db.product.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        title: row.name,
        subtitle: `${row.code} · ${row.size}`,
        status: !row.isPublished
          ? "unpublished"
          : row.stockQty === null
            ? "unknown"
            : row.stockQty > 0
              ? "in_stock"
              : "out_of_stock",
        quantity: row.stockQty,
        amount: row.retailPrice,
        currency: row.currency,
        updatedAt: row.updatedAt.toISOString(),
        modelId: row.tireModelId,
        classification: resolveVehicleClass(row).classification,
        details: [
          { label: "SKU", value: row.code },
          { label: "დაჯავშნილია", value: String(row.reservedQty ?? 0) },
          {
            label: "თავისუფალია",
            value:
              row.stockQty === null
                ? "—"
                : String(row.stockQty - (row.reservedQty ?? 0)),
          },
          { label: "ზომა", value: row.size },
          {
            label: "რაოდენობა",
            value:
              row.stockQty === null
                ? "ჯერ არ არის აღრიცხული"
                : String(row.stockQty),
          },
          {
            label: "საიტზე",
            value: row.isPublished ? "გამოქვეყნებულია" : "დამალულია",
          },
        ],
      })),
    };
  }
}
