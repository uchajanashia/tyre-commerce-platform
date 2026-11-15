import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  customerDigest,
  openCustomer,
  CheckoutCustomer,
} from "../checkout/checkout-customer";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuditContext } from "../audit/audit-context";
import { OperationsQuery } from "./operations.query";
import { checkedStatus, orderLabel } from "./commerce-reader.service";
import { OperationsPage } from "@tyre/shared";
import { workflowTransaction, requireWorkflows } from "./workflow-policy";

export function contactKeys(
  customer: Pick<CheckoutCustomer, "email" | "phone">,
) {
  const email = customer.email.trim().toLowerCase();
  let phone = customer.phone.replace(/[^0-9]/g, "");
  if (phone.length === 9) phone = `995${phone}`;
  if (phone.startsWith("00995")) phone = phone.slice(2);
  return {
    identityKey: customerDigest(["commerce-identity:v1", email, phone]),
    emailKey: customerDigest(["commerce-email:v1", email]),
    phoneKey: customerDigest(["commerce-phone:v1", phone]),
  };
}
@Injectable()
export class CustomerHistoryService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async link(
    tx: Prisma.TransactionClient,
    orderId: string,
    customer: CheckoutCustomer,
  ) {
    const keys = contactKeys(customer);
    const profile = await tx.commerceCustomer.upsert({
      where: { identityKey: keys.identityKey },
      create: keys,
      update: {},
    });
    await tx.order.update({
      where: { id: orderId },
      data: { customerId: profile.id },
    });
  }
  /** Bounded resumable backfill. Bad ciphertext never becomes a made-up identity. */
  async backfill() {
    const rows = await this.db.order.findMany({
      where: {
        customerId: null,
        customerEncrypted: { not: null },
        OR: [
          { operationsNextCheckAt: null },
          { operationsNextCheckAt: { lte: new Date() } },
        ],
      },
      orderBy: [
        { operationsNextCheckAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
      take: 20,
      select: { id: true, customerEncrypted: true },
    });
    for (const row of rows) {
      try {
        const contact = openCustomer(row.customerEncrypted!, row.id);
        await workflowTransaction(this.db, (tx) =>
          this.link(tx, row.id, contact),
        );
      } catch {
        await this.db.order.update({
          where: { id: row.id },
          data: { operationsNextCheckAt: new Date(Date.now() + 3600000) },
        });
      }
    }
  }
  async list(
    query: OperationsQuery,
    context: AuditContext,
  ): Promise<OperationsPage> {
    requireWorkflows();
    checkedStatus(query.status, []);
    let where: Prisma.CommerceCustomerWhereInput = {};
    if (query.q?.trim()) {
      const q = query.q.trim();
      const keys = contactKeys({ email: q, phone: q });
      where = q.includes("@")
        ? { emailKey: keys.emailKey }
        : /^\+?[\d\s()-]+$/.test(q)
          ? { phoneKey: keys.phoneKey }
          : { id: { contains: q, mode: "insensitive" } };
    }
    return this.db.$transaction(async (tx) => {
      const profiles = await tx.commerceCustomer.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          createdAt: true,
          _count: { select: { orders: true } },
          orders: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true, customerEncrypted: true, updatedAt: true },
          },
        },
      });
      const total = await tx.commerceCustomer.count({ where });
      const items = profiles.map((profile) => {
        const latest = profile.orders[0];
        let title = "კონტაქტი მიუწვდომელია";
        const details: { label: string; value: string }[] = [];
        try {
          const contact = openCustomer(latest.customerEncrypted!, latest.id);
          title = `${contact.firstName} ${contact.lastName}`;
          details.push(
            { label: "ტელეფონი", value: contact.phone },
            { label: "ელფოსტა", value: contact.email },
          );
        } catch {}
        return {
          id: profile.id,
          title,
          subtitle: `${profile._count.orders} შეკვეთა`,
          status: "contact",
          amount: null,
          quantity: profile._count.orders,
          updatedAt: (latest?.updatedAt ?? profile.createdAt).toISOString(),
          details,
        };
      });
      await this.audit.recordWithClient(tx, {
        ...context,
        action: "customer.history.read",
        entityType: "CommerceCustomer",
        metadata: { ids: profiles.map((p) => p.id) },
      });
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
  async history(
    customerId: string,
    query: OperationsQuery,
    context: AuditContext,
  ): Promise<OperationsPage> {
    requireWorkflows();
    return this.db.$transaction(async (tx) => {
      if (
        !(await tx.commerceCustomer.findUnique({
          where: { id: customerId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      const where = { customerId };
      const rows = await tx.order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          createdAt: true,
          paidAt: true,
          updatedAt: true,
          status: true,
          total: true,
          currency: true,
          fulfillmentStatus: true,
          refundedMinor: true,
        },
      });
      const total = await tx.order.count({ where });
      await this.audit.recordWithClient(tx, {
        ...context,
        action: "customer.history.read",
        entityType: "CommerceCustomer",
        entityId: customerId,
      });
      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: rows.map((o) => ({
          id: o.id,
          title: orderLabel(o.id, o.paidAt ?? o.createdAt),
          subtitle: o.fulfillmentStatus,
          status: o.status,
          amount: o.total,
          currency: o.currency,
          quantity: null,
          updatedAt: o.updatedAt.toISOString(),
          details: [
            {
              label: "დაბრუნებული თანხა",
              value: `${Number(o.refundedMinor) / 100} ${o.currency}`,
            },
          ],
        })),
      };
    });
  }
}
