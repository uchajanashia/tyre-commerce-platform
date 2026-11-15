import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { OperationsPage } from "@tyre/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuditContext } from "../audit/audit-context";
import { openCustomer } from "../checkout/checkout-customer";
import { OperationsQuery } from "./operations.query";
import {
  checkedStatus,
  orderLabel,
  orderSearchTerm,
} from "./commerce-reader.service";

/** Order contacts are intentionally not merged into invented customer identities. */
@Injectable()
export class CustomerContactReaderService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async list(
    query: OperationsQuery,
    context: AuditContext,
  ): Promise<OperationsPage> {
    checkedStatus(query.status, []);
    const where: Prisma.OrderWhereInput = {
      customerEncrypted: { not: null },
      ...(query.q?.trim()
        ? { id: { contains: orderSearchTerm(query.q), mode: "insensitive" } }
        : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.order.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            customerEncrypted: true,
            updatedAt: true,
            createdAt: true,
            paidAt: true,
          },
        });
        const total = await tx.order.count({ where });
        const items = rows.map((row) => {
          const base = {
            id: row.id,
            subtitle: orderLabel(row.id, row.paidAt ?? row.createdAt),
            amount: null,
            quantity: null,
            updatedAt: row.updatedAt.toISOString(),
          };
          try {
            const customer = openCustomer(row.customerEncrypted!, row.id);
            return {
              ...base,
              title: `${customer.firstName} ${customer.lastName}`,
              status: "contact",
              details: [
                { label: "ტელეფონი", value: customer.phone },
                { label: "ელფოსტა", value: customer.email },
              ],
            };
          } catch {
            return {
              ...base,
              title: "კონტაქტი ვერ გაიხსნა",
              status: "unavailable",
              details: [],
            };
          }
        });
        // Only object identifiers, never contact values, enter the audit journal.
        await this.audit.recordWithClient(tx, {
          ...context,
          action: "customer.order_contacts.read",
          entityType: "Order",
          metadata: { orderIds: rows.map((row) => row.id) },
        });
        return { items, total, page: query.page, pageSize: query.pageSize };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
