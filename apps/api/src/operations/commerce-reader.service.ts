import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, OrderStatus, PaymentAttemptStatus } from "@prisma/client";
import type { OperationsPage, OperationsSummary } from "@tyre/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsQuery } from "./operations.query";

export function checkedStatus<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (!value || value === "all") return undefined;
  if (!allowed.includes(value as T))
    throw new BadRequestException("Invalid status");
  return value as T;
}
export const orderLabel = (id: string, date: Date) => {
  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tbilisi",
    year: "numeric",
  }).format(date);
  return `TYR-${year}-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
};
export const orderSearchTerm = (q: string) =>
  /^TYR-\d{4}-([A-Z0-9]{6})$/i.exec(q.trim())?.[1] ?? q.trim();

@Injectable()
export class CommerceReaderService {
  constructor(private readonly db: PrismaService) {}

  async summary(): Promise<NonNullable<OperationsSummary["orders"]>> {
    const [total, pending, paid] = await this.db.$transaction(
      [
        this.db.order.count(),
        this.db.order.count({ where: { status: "awaiting_payment" } }),
        this.db.order.aggregate({
          where: { status: "paid", currency: "GEL" },
          _count: true,
          _sum: { total: true },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      total,
      pending,
      paid: paid._count,
      paidAmount: paid._sum.total ?? 0,
    };
  }

  async orders(query: OperationsQuery): Promise<OperationsPage> {
    const fulfillment = [
      "ready",
      "stock_exception",
      "reserved",
      "issued",
      "partially_issued",
    ];
    const filter = checkedStatus(query.status, [
      ...Object.values(OrderStatus),
      ...fulfillment,
      "refund_pending",
    ]);
    const where: Prisma.OrderWhereInput = {
      ...(filter === "refund_pending"
        ? { refunds: { some: { state: { notIn: ["succeeded", "failed"] } } } }
        : filter && fulfillment.includes(filter)
          ? { fulfillmentStatus: filter }
          : { status: filter as OrderStatus | undefined }),
      ...(query.q?.trim()
        ? { id: { contains: orderSearchTerm(query.q), mode: "insensitive" } }
        : {}),
    };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.order.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            status: true,
            total: true,
            currency: true,
            deliveryMethod: true,
            createdAt: true,
            paidAt: true,
            updatedAt: true,
            notificationStatus: true,
            fulfillmentStatus: true,
            items: {
              select: {
                productCode: true,
                productName: true,
                quantity: true,
                unitPrice: true,
              },
            },
          },
        }),
        this.db.order.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        title: orderLabel(row.id, row.paidAt ?? row.createdAt),
        subtitle: row.items.map((i) => i.productCode).join(" · "),
        fulfillmentStatus: row.fulfillmentStatus,
        status: row.status,
        amount: row.total,
        currency: row.currency,
        quantity: row.items.reduce((n, i) => n + i.quantity, 0),
        updatedAt: row.updatedAt.toISOString(),
        details: [
          { label: "შექმნილია", value: row.createdAt.toISOString() },
          { label: "ვალუტა", value: row.currency },
          {
            label: "მიღება",
            value:
              row.deliveryMethod === "delivery"
                ? "მიწოდება"
                : row.deliveryMethod === "pickup"
                  ? "ადგილზე გატანა"
                  : "მითითებული არ არის",
          },
          ...row.items.map((i) => ({
            label: i.productCode,
            value: `${i.productName} · ${i.quantity} × ${i.unitPrice} ${row.currency === "GEL" ? "₾" : row.currency}`,
          })),
        ],
      })),
    };
  }

  async payments(query: OperationsQuery): Promise<OperationsPage> {
    const where: Prisma.PaymentAttemptWhereInput = {
      status: checkedStatus(query.status, Object.values(PaymentAttemptStatus)),
      ...(query.q?.trim()
        ? {
            OR: [
              {
                orderId: {
                  contains: orderSearchTerm(query.q),
                  mode: "insensitive" as const,
                },
              },
              {
                providerReference: {
                  contains: query.q.trim(),
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.paymentAttempt.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            orderId: true,
            status: true,
            method: true,
            providerReference: true,
            updatedAt: true,
            failureCode: true,
            order: {
              select: {
                total: true,
                currency: true,
                createdAt: true,
                paidAt: true,
              },
            },
          },
        }),
        this.db.paymentAttempt.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        title: orderLabel(row.orderId, row.order.paidAt ?? row.order.createdAt),
        subtitle: row.providerReference ?? "ბანკის პასუხის მოლოდინში",
        status: row.status,
        amount: row.order.total,
        currency: row.order.currency,
        quantity: null,
        updatedAt: row.updatedAt.toISOString(),
        details: [
          {
            label: "მეთოდი",
            value:
              row.method === "google_pay_external"
                ? "Google Pay"
                : row.method === "apple_pay_external"
                  ? "Apple Pay"
                  : "ბარათით გადახდა",
          },
          { label: "ბანკის ნომერი", value: row.providerReference ?? "—" },
          { label: "ვალუტა", value: row.order.currency },
          { label: "შეცდომა", value: row.failureCode ?? "—" },
        ],
      })),
    };
  }
}
