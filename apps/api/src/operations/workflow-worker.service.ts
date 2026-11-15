import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CheckoutService } from "../checkout/checkout.service";
import { BogProvider } from "../checkout/bog.provider";
import { StockWorkflowService } from "./stock-workflow.service";
import { CustomerHistoryService } from "./customer-history.service";
import { RefundWorkflowService } from "./refund-workflow.service";
import { customerDigest } from "../checkout/checkout-customer";
import { workflowsEnabled, workflowTransaction } from "./workflow-policy";

@Injectable()
export class WorkflowWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly logger = new Logger(WorkflowWorker.name);
  constructor(
    private readonly db: PrismaService,
    private readonly stock: StockWorkflowService,
    private readonly customers: CustomerHistoryService,
    private readonly refunds: RefundWorkflowService,
    private readonly bank: BogProvider,
    private readonly checkout: CheckoutService,
  ) {}
  onModuleInit() {
    if (
      process.env.BOG_REFUNDS_ENABLED === "true" &&
      (!workflowsEnabled() || process.env.BOG_PAYMENTS_ENABLED !== "true")
    )
      throw new Error("Refunds require internal workflows and BOG payments");
    if (workflowsEnabled()) {
      customerDigest("workflow-startup");
      this.schedule();
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
  private schedule() {
    if (!this.stopped) this.timer = setTimeout(() => void this.run(), 15000);
    this.timer?.unref();
  }
  private async run() {
    try {
      await this.tick();
    } catch {
      this.logger.warn("Workflow batch deferred");
    } finally {
      this.schedule();
    }
  }
  async tick() {
    if (!workflowsEnabled()) return;
    const expired = await this.db.order.findMany({
      where: {
        status: "awaiting_payment",
        reservationExpiresAt: { lte: new Date() },
      },
      take: 30,
      orderBy: { reservationExpiresAt: "asc" },
      select: { id: true },
    });
    for (const row of expired)
      await workflowTransaction(this.db, async (tx) => {
        const order = await this.stock.lockOrder(tx, row.id);
        if (
          order.status !== "awaiting_payment" ||
          !order.reservationExpiresAt ||
          order.reservationExpiresAt > new Date()
        )
          return;
        await this.stock.release(tx, row.id, "released");
        await tx.order.update({
          where: { id: row.id },
          data: { status: "expired" },
        });
      });
    await this.customers.backfill();
    await this.refunds.processOne();
    if (process.env.BOG_PAYMENTS_ENABLED !== "true") return;
    const rows = await this.db.order.findMany({
      where: {
        status: { in: ["awaiting_payment", "expired", "paid"] },
        paymentAttempts: { some: { providerReference: { not: null } } },
        OR: [
          { operationsNextCheckAt: null },
          { operationsNextCheckAt: { lte: new Date() } },
        ],
      },
      take: 10,
      orderBy: { operationsNextCheckAt: { sort: "asc", nulls: "first" } },
      include: { paymentAttempts: true },
    });
    for (const order of rows) {
      // Claim via compare-and-swap so API replicas do not all poll the same order.
      const claim = await this.db.order.updateMany({
        where: {
          id: order.id,
          operationsNextCheckAt: order.operationsNextCheckAt,
        },
        data: { operationsNextCheckAt: new Date(Date.now() + 300000) },
      });
      if (!claim.count) continue;
      try {
        const attempt = order.paymentAttempts.find((p) => p.providerReference);
        const receipt = await this.bank.receipt(attempt!.providerReference!);
        await this.checkout.apply(receipt);
        const updated = await this.db.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { status: true },
        });
        if (updated.status === "paid")
          await workflowTransaction(this.db, (tx) =>
            this.refunds.reconcile(tx, order.id, receipt),
          );
      } catch {
        /* Retain confirmed state, retry on the next durable schedule. */
      }
    }
  }
}
