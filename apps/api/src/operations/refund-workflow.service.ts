import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { BogProvider, BogReceipt } from "../checkout/bog.provider";
import { AuditService } from "../audit/audit.service";
import { AuditContext } from "../audit/audit-context";
import { StockWorkflowService } from "./stock-workflow.service";
import {
  fingerprint,
  minorAmount,
  replay,
  requireWorkflows,
  workflowTransaction,
} from "./workflow-policy";

export const refundsEnabled = () =>
  process.env.BOG_REFUNDS_ENABLED === "true" &&
  process.env.BOG_PAYMENTS_ENABLED === "true";
export function refundBudget(
  total: number,
  observed: bigint,
  refunds: { state: string; amountMinor: bigint }[],
) {
  const completed = refunds
    .filter((r) => r.state === "succeeded")
    .reduce((n, r) => n + r.amountMinor, 0n);
  const pending = refunds
    .filter((r) => !["succeeded", "failed"].includes(r.state))
    .reduce((n, r) => n + r.amountMinor, 0n);
  return Number(
    BigInt(total) * 100n -
      (observed > completed ? observed : completed) -
      pending,
  );
}
@Injectable()
export class RefundWorkflowService {
  constructor(
    private readonly db: PrismaService,
    private readonly bank: BogProvider,
    private readonly stock: StockWorkflowService,
    private readonly audit: AuditService,
  ) {}

  async reconcile(
    tx: Prisma.TransactionClient,
    orderId: string,
    receipt: BogReceipt,
  ) {
    const order = await this.stock.lockOrder(tx, orderId);
    const attempt = await tx.paymentAttempt.findFirst({
      where: {
        orderId,
        status: "succeeded",
        providerReference: receipt.order_id,
      },
    });
    if (
      !attempt ||
      receipt.external_order_id !== order.publicToken ||
      receipt.purchase_units?.currency_code !== order.currency ||
      minorAmount(receipt.purchase_units.request_amount) !== order.total * 100
    )
      throw new UnauthorizedException("Receipt mismatch");
    if (
      receipt.purchase_units.transfer_amount !== undefined &&
      minorAmount(receipt.purchase_units.transfer_amount) !== order.total * 100
    )
      throw new UnauthorizedException("Captured amount mismatch");
    if (
      ![
        "completed",
        "refund_requested",
        "refunded",
        "refunded_partially",
      ].includes(receipt.order_status?.key)
    )
      throw new UnauthorizedException("Payment is not captured");
    const observed = minorAmount(receipt.purchase_units.refund_amount ?? "0");
    if (observed === null || observed > order.total * 100)
      throw new UnauthorizedException("Invalid refunded total");
    let refunded =
      BigInt(observed) > order.refundedMinor
        ? BigInt(observed)
        : order.refundedMinor;
    for (const refund of order.refunds) {
      if (
        !refund.providerActionId ||
        ["succeeded", "failed"].includes(refund.state)
      )
        continue;
      const action = receipt.actions?.find(
        (a) => a.action_id === refund.providerActionId,
      );
      if (
        !action ||
        !["refund", "partial_refund"].includes(action.action) ||
        minorAmount(action.amount) !== Number(refund.amountMinor) ||
        !["completed", "rejected"].includes(action.status)
      )
        continue;
      const state = action.status === "completed" ? "succeeded" : "failed";
      await tx.refundRequest.update({
        where: { id: refund.id },
        data: { state, leaseUntil: null, leaseToken: null },
      });
      await this.audit.recordWithClient(tx, {
        action: "payment.refund.reconcile",
        entityType: "RefundRequest",
        entityId: refund.id,
        correlationId: randomUUID(),
        after: { state },
      });
    }
    const succeeded = await tx.refundRequest.aggregate({
      where: { orderId, state: "succeeded" },
      _sum: { amountMinor: true },
    });
    if ((succeeded._sum.amountMinor ?? 0n) > refunded)
      refunded = succeeded._sum.amountMinor!;
    await tx.order.update({
      where: { id: orderId },
      data: { refundedMinor: refunded },
    });
    if (
      refunded >= BigInt(order.total) * 100n &&
      order.reservations.some((r) => ["active", "committed"].includes(r.state))
    )
      await this.stock.release(
        tx,
        orderId,
        order.items.some((i) => i.issuedQty > 0)
          ? order.fulfillmentStatus
          : "released",
      );
    return order;
  }

  async request(
    orderId: string,
    requestId: string,
    amountMinor: number,
    reason: string,
    context: AuditContext,
  ) {
    requireWorkflows();
    if (!refundsEnabled())
      throw new ServiceUnavailableException("Refunds are disabled");
    if (
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 1 ||
      reason.trim().length < 3
    )
      throw new BadRequestException("Invalid refund");
    const hash = fingerprint([
      "refund",
      orderId,
      amountMinor,
      reason,
      context.actorId,
    ]);
    // Replays must work even while the bank is unavailable.
    const previous = await replay(this.db, requestId, hash);
    if (previous) return previous;
    const attempt = await this.db.paymentAttempt.findFirst({
      where: { orderId, status: "succeeded", provider: "bog" },
    });
    if (!attempt?.providerReference)
      throw new ConflictException("Confirmed payment required");
    const receipt = await this.bank.receipt(attempt.providerReference);
    return workflowTransaction(this.db, async (tx) => {
      await this.stock.lockOrder(tx, orderId);
      const replayed = await replay(tx, requestId, hash);
      if (replayed) return replayed;
      await this.reconcile(tx, orderId, receipt);
      const order = await this.stock.lockOrder(tx, orderId);
      if (
        order.status !== "paid" ||
        order.currency !== "GEL" ||
        order.refunds.some((r) => !["succeeded", "failed"].includes(r.state)) ||
        refundBudget(order.total, order.refundedMinor, order.refunds) <
          amountMinor
      )
        throw new ConflictException(
          "Refund exceeds available balance or another request is pending",
        );
      await tx.refundRequest.create({
        data: {
          id: requestId,
          orderId,
          amountMinor: BigInt(amountMinor),
          reason: reason.trim(),
          actorId: context.actorId,
          providerReference: attempt.providerReference!,
        },
      });
      await this.audit.recordWithClient(tx, {
        ...context,
        action: "payment.refund.request",
        entityType: "RefundRequest",
        entityId: requestId,
        metadata: { orderId, amountMinor, reason },
      });
      const result = { id: requestId, state: "queued" };
      await tx.operationsCommand.create({
        data: { id: requestId, fingerprint: hash, result },
      });
      return result;
    });
  }

  async processOne() {
    if (!refundsEnabled()) return;
    const now = new Date();
    const row = await this.db.refundRequest.findFirst({
      where: {
        state: { notIn: ["succeeded", "failed"] },
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { nextAttemptAt: "asc" },
    });
    if (!row) return;
    const token = randomUUID();
    const claim = await this.db.refundRequest.updateMany({
      where: {
        id: row.id,
        state: { notIn: ["succeeded", "failed"] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseToken: token, leaseUntil: new Date(Date.now() + 60000) },
    });
    if (!claim.count) return;
    try {
      const receipt = await this.bank.receipt(row.providerReference);
      await workflowTransaction(this.db, (tx) =>
        this.reconcile(tx, row.orderId, receipt),
      );
      const current = await this.db.refundRequest.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (["succeeded", "failed"].includes(current.state)) return;
      if (!current.providerActionId && current.attempts < 3) {
        // Persist intent before the network call: crash/retry always reuses this UUID.
        const intent = await this.db.refundRequest.updateMany({
          where: { id: row.id, leaseToken: token },
          data: { state: "processing", attempts: { increment: 1 } },
        });
        if (!intent.count) return;
        const actionId = await this.bank.refund(
          row.providerReference,
          row.id,
          Number(row.amountMinor),
        );
        await this.db.refundRequest.updateMany({
          where: { id: row.id, leaseToken: token },
          data: { providerActionId: actionId, state: "processing" },
        });
      } else if (!current.providerActionId) {
        await this.db.refundRequest.updateMany({
          where: { id: row.id, leaseToken: token },
          data: { state: "needs_review" },
        });
      }
    } catch {
      // Unknown outcomes keep their balance reserved. Never report success or release it on timeout.
      await this.db.refundRequest.updateMany({
        where: { id: row.id, leaseToken: token },
        data: { state: "needs_review" },
      });
    } finally {
      await this.db.refundRequest.updateMany({
        where: { id: row.id, leaseToken: token },
        data: {
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7)),
          ),
        },
      });
    }
  }
}
