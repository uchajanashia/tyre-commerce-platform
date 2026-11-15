import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { openCustomer, sealReceipt } from "./checkout-customer";
import { httpsConfig } from "./bog.provider";

export async function readReceiptAck(response: Response, eventId: string) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing document response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 3_000_000) throw new Error("Document response too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const ack = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    eventId?: string;
    delivered?: boolean;
    pdfBase64?: string;
  };
  if (ack.eventId !== eventId || typeof ack.pdfBase64 !== "string")
    throw new Error("Invalid document response");
  const pdf = Buffer.from(ack.pdfBase64, "base64");
  if (
    pdf.length > 2_000_000 ||
    pdf.subarray(0, 5).toString() !== "%PDF-" ||
    pdf.toString("base64") !== ack.pdfBase64
  )
    throw new Error("Invalid PDF");
  return { pdf, delivered: ack.delivered === true };
}

/** Durable at-least-once delivery. n8n must deduplicate eventId before sending. */
@Injectable()
export class ReceiptDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    if (process.env.ORDER_RECEIPTS_ENABLED !== "true") return;
    httpsConfig("N8N_ORDER_WEBHOOK_URL");
    if (
      !process.env.N8N_ORDER_WEBHOOK_TOKEN ||
      !process.env.ORDER_MERCHANT_EMAIL
    )
      throw new Error("Receipt delivery configuration missing");
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const candidate = await this.prisma.order.findFirst({
        where: {
          status: "paid",
          notificationStatus: { in: ["pending", "sending"] },
          notificationNextAt: { lte: new Date() },
        },
        orderBy: { notificationNextAt: "asc" },
      });
      if (!candidate) return;
      const lease = randomUUID();
      const claim = await this.prisma.order.updateMany({
        where: {
          id: candidate.id,
          notificationStatus: candidate.notificationStatus,
          notificationNextAt: candidate.notificationNextAt,
        },
        data: {
          notificationStatus: "sending",
          notificationLease: lease,
          notificationNextAt: new Date(Date.now() + 120000),
          notificationAttempts: { increment: 1 },
        },
      });
      if (!claim.count) return;
      try {
        const order = await this.prisma.order.findUniqueOrThrow({
          where: { id: candidate.id },
          include: { items: true },
        });
        const customer = openCustomer(order.customerEncrypted!, order.id);
        // No personal number or public order-access token leaves the API.
        const eventId = `order-paid:${order.id}`;
        const response = await fetch(httpsConfig("N8N_ORDER_WEBHOOK_URL"), {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.N8N_ORDER_WEBHOOK_TOKEN}`,
            "Idempotency-Key": eventId,
          },
          body: JSON.stringify({
            eventId,
            event: "order.paid",
            orderId: order.id,
            total: order.total,
            currency: order.currency,
            deliveryMethod: order.deliveryMethod,
            paidAt: order.paidAt,
            customer: {
              firstName: customer.firstName,
              lastName: customer.lastName,
              email: customer.email,
              phone: customer.phone,
              address: customer.address,
            },
            merchantEmail: process.env.ORDER_MERCHANT_EMAIL,
            items: order.items.map((i) => ({
              name: i.productName,
              code: i.productCode,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              total: i.lineTotal,
            })),
          }),
        });
        if (!response.ok) throw new Error("Delivery failed");
        const ack = await readReceiptAck(response, eventId);
        // Customer download is available even if the merchant email needs a retry.
        await this.prisma.order.updateMany({
          where: { id: order.id, notificationLease: lease },
          data: { receiptPdfEncrypted: sealReceipt(ack.pdf, order.id) },
        });
        if (!ack.delivered) throw new Error("Receipt email not yet delivered");
        await this.prisma.order.updateMany({
          where: { id: order.id, notificationLease: lease },
          data: {
            notificationStatus: "delivered",
            notificationLease: null,
            notificationNextAt: null,
          },
        });
      } catch {
        await this.prisma.order.updateMany({
          where: { id: candidate.id, notificationLease: lease },
          data: {
            notificationStatus: "pending",
            notificationLease: null,
            notificationNextAt: new Date(
              Date.now() +
                Math.min(
                  3600000,
                  30000 * 2 ** Math.min(candidate.notificationAttempts, 7),
                ),
            ),
          },
        });
      }
    } finally {
      this.busy = false;
    }
  }
}
