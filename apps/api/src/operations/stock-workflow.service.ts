import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuditContext } from "../audit/audit-context";
import {
  fingerprint,
  replay,
  requireWorkflows,
  workflowTransaction,
} from "./workflow-policy";

export interface ItemQuantity {
  orderItemId: string;
  quantity: number;
}
@Injectable()
export class StockWorkflowService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async updateStock(
    tx: Prisma.TransactionClient,
    args: Prisma.ProductUpdateArgs,
  ) {
    const id = args.where.id!;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id} FOR UPDATE`;
    const previous = await tx.product.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });
    return tx.product.update({
      ...args,
      data: {
        ...args.data,
        updatedAt: new Date(
          Math.max(Date.now(), previous.updatedAt.getTime() + 1),
        ),
      },
    });
  }

  async lockOrder(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true, reservations: true, refunds: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }
  private async movement(
    tx: Prisma.TransactionClient,
    productId: string,
    orderId: string | null,
    kind: string,
    physical: number,
    reserved: number,
    actorId?: string,
    reason?: string,
  ) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        orderId,
        kind,
        onHandDelta: physical,
        reservedDelta: reserved,
        onHandAfter: product.stockQty!,
        reservedAfter: product.reservedQty,
        actorId,
        reason,
      },
    });
  }
  /** Caller owns the order transaction. Product locks always use stable order. */
  async reserve(
    tx: Prisma.TransactionClient,
    orderId: string,
    committed = false,
  ) {
    const order = await this.lockOrder(tx, orderId);
    const items = [...order.items].sort((a, b) =>
      (a.productId ?? "").localeCompare(b.productId ?? ""),
    );
    // Lock and validate the complete basket before changing any quantity.
    for (const item of items) {
      if (item.issuedQty >= item.quantity) continue;
      if (!item.productId)
        throw new ConflictException("Product no longer exists");
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${item.productId} FOR UPDATE`;
      const old = order.reservations.find((r) => r.orderItemId === item.id);
      if (old && ["active", "committed"].includes(old.state)) continue;
      const product = await tx.product.findUniqueOrThrow({
        where: { id: item.productId },
      });
      if (
        product.stockQty === null ||
        product.stockQty - product.reservedQty < item.quantity - item.issuedQty
      )
        throw new ConflictException("Insufficient counted stock");
    }
    for (const item of items) {
      if (item.issuedQty >= item.quantity) continue;
      const old = order.reservations.find((r) => r.orderItemId === item.id);
      if (old && ["active", "committed"].includes(old.state)) {
        if (committed)
          await tx.stockReservation.update({
            where: { id: old.id },
            data: { state: "committed" },
          });
        continue;
      }
      const quantity = item.quantity - item.issuedQty;
      await this.updateStock(tx, {
        where: { id: item.productId! },
        data: { reservedQty: { increment: quantity } },
      });
      await tx.stockReservation.upsert({
        where: { orderItemId: item.id },
        create: {
          orderId,
          orderItemId: item.id,
          productId: item.productId!,
          quantity,
          state: committed ? "committed" : "active",
        },
        update: { quantity, state: committed ? "committed" : "active" },
      });
      await this.movement(tx, item.productId!, orderId, "reserve", 0, quantity);
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus: committed ? "ready" : "reserved",
        reservationExpiresAt: committed
          ? null
          : new Date(Date.now() + 15 * 60000),
      },
    });
  }
  async release(tx: Prisma.TransactionClient, orderId: string, status: string) {
    const order = await this.lockOrder(tx, orderId);
    for (const row of [...order.reservations].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    )) {
      if (!["active", "committed"].includes(row.state)) continue;
      await this.updateStock(tx, {
        where: { id: row.productId },
        data: { reservedQty: { decrement: row.quantity } },
      });
      await tx.stockReservation.update({
        where: { id: row.id },
        data: { state: "released" },
      });
      await this.movement(
        tx,
        row.productId,
        orderId,
        "release",
        0,
        -row.quantity,
      );
    }
    await tx.order.update({
      where: { id: orderId },
      data: { reservationExpiresAt: null, fulfillmentStatus: status },
    });
  }
  async confirmPaid(tx: Prisma.TransactionClient, orderId: string) {
    try {
      await this.reserve(tx, orderId, true);
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;
      // Payment remains paid. Staff must allocate stock or refund before issuing.
      await tx.order.update({
        where: { id: orderId },
        data: {
          fulfillmentStatus: "stock_exception",
          reservationExpiresAt: null,
        },
      });
    }
  }
  async allocate(orderId: string, requestId: string, context: AuditContext) {
    requireWorkflows();
    return workflowTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      const hash = fingerprint(["allocate", orderId]);
      const previous = await replay(tx, requestId, hash);
      if (previous) return previous;
      if (
        order.status !== "paid" ||
        !["unallocated", "stock_exception"].includes(order.fulfillmentStatus) ||
        order.refundedMinor > 0n ||
        order.refunds.some((r) => r.state !== "failed")
      )
        throw new ConflictException("Order cannot be allocated");
      await this.reserve(tx, orderId, true);
      await this.audit.recordWithClient(tx, {
        ...context,
        action: "inventory.allocate",
        entityType: "Order",
        entityId: orderId,
      });
      const result = { ok: true };
      await tx.operationsCommand.create({
        data: { id: requestId, fingerprint: hash, result },
      });
      return result;
    });
  }
  async move(
    orderId: string,
    requestId: string,
    lines: ItemQuantity[],
    kind: "issue" | "return",
    context: AuditContext,
  ) {
    requireWorkflows();
    if (
      !lines.length ||
      new Set(lines.map((l) => l.orderItemId)).size !== lines.length ||
      lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)
    )
      throw new BadRequestException("Invalid quantities");
    return workflowTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      const hash = fingerprint([
        kind,
        orderId,
        [...lines].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
      ]);
      const previous = await replay(tx, requestId, hash);
      if (previous) return previous;
      if (order.status !== "paid")
        throw new ConflictException("Payment must be confirmed");
      if (
        kind === "issue" &&
        (!["ready", "partially_issued", "partially_returned"].includes(
          order.fulfillmentStatus,
        ) ||
          order.refundedMinor >= BigInt(order.total) * 100n ||
          order.refunds.some((r) => !["succeeded", "failed"].includes(r.state)))
      )
        throw new ConflictException("Order cannot be issued");
      const selected = lines.map((line) => ({
        line,
        item: order.items.find((i) => i.id === line.orderItemId),
      }));
      if (selected.some((x) => !x.item?.productId))
        throw new BadRequestException("Invalid order item");
      selected.sort((a, b) =>
        a.item!.productId!.localeCompare(b.item!.productId!),
      );
      for (const { line, item } of selected) {
        const i = item!;
        const productId = i.productId!;
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
        if (kind === "issue") {
          const reservation = order.reservations.find(
            (r) => r.orderItemId === i.id && r.state === "committed",
          );
          if (
            !reservation ||
            reservation.quantity < line.quantity ||
            i.issuedQty + line.quantity > i.quantity
          )
            throw new ConflictException("Quantity exceeds reservation");
          await this.updateStock(tx, {
            where: { id: productId },
            data: {
              stockQty: { decrement: line.quantity },
              reservedQty: { decrement: line.quantity },
            },
          });
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: {
              quantity: { decrement: line.quantity },
              state:
                reservation.quantity === line.quantity
                  ? "consumed"
                  : "committed",
            },
          });
          await tx.orderItem.update({
            where: { id: i.id },
            data: { issuedQty: { increment: line.quantity } },
          });
          await this.movement(
            tx,
            productId,
            orderId,
            kind,
            -line.quantity,
            -line.quantity,
            context.actorId,
          );
        } else {
          if (i.returnedQty + line.quantity > i.issuedQty)
            throw new ConflictException("Quantity exceeds issued goods");
          await this.updateStock(tx, {
            where: { id: productId },
            data: { stockQty: { increment: line.quantity } },
          });
          await tx.orderItem.update({
            where: { id: i.id },
            data: { returnedQty: { increment: line.quantity } },
          });
          await this.movement(
            tx,
            productId,
            orderId,
            kind,
            line.quantity,
            0,
            context.actorId,
          );
        }
      }
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const status = items.every((i) => i.returnedQty === i.quantity)
        ? "returned"
        : items.some((i) => i.returnedQty > 0)
          ? "partially_returned"
          : items.every((i) => i.issuedQty === i.quantity)
            ? "issued"
            : "partially_issued";
      await tx.order.update({
        where: { id: orderId },
        data: { fulfillmentStatus: status },
      });
      await this.audit.recordWithClient(tx, {
        ...context,
        action: `inventory.${kind}`,
        entityType: "Order",
        entityId: orderId,
        metadata: { lines },
      });
      const result = { ok: true };
      await tx.operationsCommand.create({
        data: { id: requestId, fingerprint: hash, result },
      });
      return result;
    });
  }
  async count(
    productId: string,
    quantity: number,
    expectedUpdatedAt: string,
    requestId: string,
    reason: string,
    context: AuditContext,
  ) {
    requireWorkflows();
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > 2147483647 ||
      !Number.isFinite(Date.parse(expectedUpdatedAt)) ||
      !reason.trim()
    )
      throw new BadRequestException("Invalid stock count");
    return workflowTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
      const hash = fingerprint([
        "count",
        productId,
        quantity,
        expectedUpdatedAt,
        reason,
      ]);
      const previous = await replay(tx, requestId, hash);
      if (previous) return previous;
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException();
      if (
        product.updatedAt.toISOString() !==
          new Date(expectedUpdatedAt).toISOString() ||
        quantity < product.reservedQty
      )
        throw new ConflictException(
          "Stock changed or count is below reservations",
        );
      await this.updateStock(tx, {
        where: { id: productId },
        data: { stockQty: quantity },
      });
      await this.movement(
        tx,
        productId,
        null,
        product.stockQty === null ? "opening" : "count",
        quantity - (product.stockQty ?? 0),
        0,
        context.actorId,
        reason,
      );
      await this.audit.recordWithClient(tx, {
        ...context,
        action: "inventory.count",
        entityType: "Product",
        entityId: productId,
        before: { quantity: product.stockQty },
        after: { quantity },
        metadata: { reason },
      });
      const result = { ok: true };
      await tx.operationsCommand.create({
        data: { id: requestId, fingerprint: hash, result },
      });
      return result;
    });
  }
}
