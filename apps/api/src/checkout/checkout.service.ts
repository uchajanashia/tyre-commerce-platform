import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildCartQuote,
  validateCartLines,
} from "./cart-quote.service";
import {
  BogExternalPaymentResult,
  BogProvider,
  BogReceipt,
} from "./bog.provider";
import { customerDigest, sealCustomer, openReceipt } from "./checkout-customer";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import {
  CompleteApplePayDto,
  CreateGooglePayCheckoutDto,
} from "./dto/wallet-checkout.dto";

import { StockWorkflowService } from '../operations/stock-workflow.service';
import { CustomerHistoryService } from '../operations/customer-history.service';
import { workflowsEnabled, retryableWorkflowConflict, minorAmount } from '../operations/workflow-policy';
const include = { items: true, paymentAttempts: true } as const;
type PaymentMethod = "hosted" | "google_pay_external" | "apple_pay_external";
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bank: BogProvider,
    @Optional() private readonly stock?: StockWorkflowService,
    @Optional() private readonly history?: CustomerHistoryService,
  ) {}
  async create(dto: CreateCheckoutDto) {
    const { order, attempt } = await this.prepareOrder(dto, "hosted");
    const bankOrder = attempt.redirectUrl
      ? { reference: attempt.providerReference!, redirect: attempt.redirectUrl }
      : await this.bank.create(
          attempt.id,
          order.publicToken,
          order.total,
          order.items,
        );
    await this.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: "created" },
      data: {
        providerReference: bankOrder.reference,
        redirectUrl: bankOrder.redirect,
        status: "pending",
      },
    });
    return {
      orderPublicToken: order.publicToken,
      redirectUrl: bankOrder.redirect,
    };
  }

  async createGooglePay(dto: CreateGooglePayCheckoutDto) {
    const { googlePayToken, ...checkout } = dto;
    const { order, attempt } = await this.prepareOrder(
      checkout as CreateCheckoutDto,
      "google_pay_external",
    );
    if (attempt.providerReference) {
      return attempt.redirectUrl
        ? {
            kind: "redirect" as const,
            orderPublicToken: order.publicToken,
            redirectUrl: attempt.redirectUrl,
          }
        : {
            kind: "processing" as const,
            orderPublicToken: order.publicToken,
          };
    }
    const result = await this.bank.createExternalGooglePay(
      attempt.id,
      order.publicToken,
      order.total,
      order.items,
      googlePayToken,
    );
    await this.persistExternalResult(attempt.id, result);
    return this.walletAction(order.publicToken, result);
  }

  async createApplePay(dto: CreateCheckoutDto) {
    const { order, attempt } = await this.prepareOrder(
      dto,
      "apple_pay_external",
    );
    const result = await this.bank.createExternalApplePay(
      attempt.id,
      order.publicToken,
      order.total,
      order.items,
    );
    await this.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: "created" },
      data: { providerReference: result.reference, status: "pending" },
    });
    return {
      kind: "apple_pay_session" as const,
      orderPublicToken: order.publicToken,
      sessionJson: result.sessionJson,
    };
  }

  async completeApplePay(orderPublicToken: string, dto: CompleteApplePayDto) {
    const order = await this.prisma.order.findUnique({
      where: { publicToken: orderPublicToken },
      include,
    });
    if (!order) throw new NotFoundException();
    if (order.status !== "awaiting_payment")
      throw new ConflictException("Order already finished");
    const attempt = order.paymentAttempts[0];
    if (
      !attempt ||
      attempt.method !== "apple_pay_external" ||
      !attempt.providerReference
    )
      throw new ConflictException("Apple Pay session unavailable");

    if (!attempt.completionIdempotencyKey) {
      await this.prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, completionIdempotencyKey: null },
        data: { completionIdempotencyKey: randomUUID() },
      });
    }
    const durableAttempt = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    const result = await this.bank.completeExternalApplePay(
      attempt.providerReference,
      durableAttempt.completionIdempotencyKey!,
      dto.applePayToken,
    );
    await this.persistExternalResult(attempt.id, result);
    return this.walletAction(order.publicToken, result);
  }

  private async prepareOrder(dto: CreateCheckoutDto, method: PaymentMethod) {
    if (
      process.env.CHECKOUT_ENABLED !== "true" ||
      process.env.BOG_PAYMENTS_ENABLED !== "true"
    )
      throw new ServiceUnavailableException("Checkout is disabled");
    validateCartLines(dto.items);
    const customer = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      personalNumber: dto.personalNumber || undefined,
      address: dto.deliveryMethod === "delivery" ? dto.address : undefined,
    };
    const hash = customerDigest({
      items: dto.items,
      deliveryMethod: dto.deliveryMethod,
      customer,
    });
    let order;
    try {
      order = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.order.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include,
          });
          if (existing) return existing;
          const products = await tx.product.findMany({
            where: { id: { in: dto.items.map((item) => item.productId) } },
            select: {
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
            },
          });
          const quote = buildCartQuote(dto.items, products);
          if (
            !quote.allAvailable ||
            quote.total < 1 ||
            quote.total > 100_000_000 ||
            !Number.isSafeInteger(quote.total) ||
            quote.currency !== "GEL"
          )
            throw new BadRequestException(
              "One or more selected products are unavailable",
            );
          const id = randomUUID();
          const attemptId = randomUUID();
          const created = await tx.order.create({
            data: {
              id,
              idempotencyKey: dto.idempotencyKey,
              publicToken: randomBytes(32).toString("base64url"),
              requestHash: hash,
              status: "awaiting_payment",
              subtotal: quote.total,
              total: quote.total,
              currency: quote.currency,
              deliveryMethod: dto.deliveryMethod,
              customerEncrypted: sealCustomer(customer, id),
              items: {
                create: quote.items.map((i) => ({
                  productId: i.productId,
                  productCode: i.code!,
                  productName: i.name!,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice!,
                  lineTotal: i.lineTotal!,
                })),
              },
              paymentAttempts: {
                create: {
                  id: attemptId,
                  provider: "bog",
                  method,
                  idempotencyKey: attemptId,
                  status: "created",
                },
              },
            },
            include,
          });
          if (workflowsEnabled()) {
            if (!this.stock || !this.history) throw new ServiceUnavailableException('Workflow services unavailable');
            await this.history.link(tx, id, customer);
            await this.stock.reserve(tx, id);
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!retryableWorkflowConflict(error))
        throw error;
      order = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include,
      });
      if (!order)
        throw new ConflictException("Retry the same checkout request");
    }
    if (order.requestHash !== hash)
      throw new ConflictException(
        "Checkout details changed; start a new request",
      );
    if (order.status !== "awaiting_payment")
      throw new ConflictException("Order already finished");
    const attempt = order.paymentAttempts[0];
    if (!attempt) throw new ConflictException("Payment attempt unavailable");
    if (attempt.method !== method)
      throw new ConflictException(
        "Payment method changed; start a new checkout request",
      );
    if (Date.now() - attempt.createdAt.getTime() > 14 * 60000)
      throw new ConflictException(
        "Payment session expired; check its status before starting again",
      );
    return { order, attempt };
  }

  private async persistExternalResult(
    attemptId: string,
    result: BogExternalPaymentResult,
  ) {
    await this.prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        providerReference: result.reference,
        redirectUrl:
          result.outcome === "action_required" ? result.redirect : null,
        status: "pending",
      },
    });
  }

  private walletAction(
    orderPublicToken: string,
    result: BogExternalPaymentResult,
  ) {
    if (result.outcome === "action_required") {
      return {
        kind: "redirect" as const,
        orderPublicToken,
        redirectUrl: result.redirect,
      };
    }
    return {
      kind: result.outcome,
      orderPublicToken,
    };
  }
  async apply(receipt: BogReceipt) {
    if (
      !receipt ||
      typeof receipt.order_id !== "string" ||
      typeof receipt.external_order_id !== "string" ||
      typeof receipt.order_status?.key !== "string"
    )
      throw new UnauthorizedException("Invalid receipt");
    await this.prisma.$transaction(async (tx) => {
      // Serializes status changes even when callback arrives before create-response storage.
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Order" WHERE "publicToken" = ${receipt.external_order_id} FOR UPDATE`;
      if (!rows[0]) throw new UnauthorizedException("Unknown order");
      const order = await tx.order.findUniqueOrThrow({
        where: { id: rows[0].id },
        include,
      });
      const attempt = order.paymentAttempts[0];
      if (
        !attempt ||
        (attempt.providerReference &&
          attempt.providerReference !== receipt.order_id) ||
        receipt.purchase_units?.currency_code !== order.currency ||
        Number(receipt.purchase_units?.request_amount) !== order.total
      )
        throw new UnauthorizedException("Receipt mismatch");
      const status = receipt.order_status.key;
      const digest = createHash("sha256")
        .update(JSON.stringify(receipt))
        .digest("hex");
      await tx.paymentEvent.upsert({
        where: { deduplicationKey: digest },
        create: {
          deduplicationKey: digest,
          paymentAttemptId: attempt.id,
          eventType: status,
          payloadHash: digest,
          verified: true,
        },
        update: {},
      });
      const refunded = minorAmount(receipt.purchase_units.refund_amount ?? 0);
      if (refunded === null || refunded > order.total * 100)
        throw new UnauthorizedException('Invalid refunded total');
      const fullyRefunded = workflowsEnabled() && Math.max(refunded, Number(order.refundedMinor)) >= order.total * 100;
      if (workflowsEnabled() && BigInt(refunded) > order.refundedMinor)
        await tx.order.update({where:{id:order.id},data:{refundedMinor:BigInt(refunded)}});
      if (order.status === "paid") {
        if (fullyRefunded) await this.stock!.release(tx, order.id, order.items.some(i=>i.issuedQty>0)?order.fulfillmentStatus:'released');
        return;
      }
      if (["completed", "refund_requested", "refunded", "refunded_partially"].includes(status)) {
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            providerReference: receipt.order_id,
            status: "succeeded",
            completedAt: new Date(),
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "paid",
            paidAt: new Date(),
            notificationStatus: "pending",
            notificationNextAt: new Date(),
          },
        });
        if (workflowsEnabled()) {
          if (fullyRefunded) await this.stock!.release(tx, order.id, 'released');
          else await this.stock!.confirmPaid(tx, order.id);
        }
      } else if (status === "rejected" && order.status === "awaiting_payment") {
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            providerReference: receipt.order_id,
            status: "failed",
            completedAt: new Date(),
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "failed" },
        });
        if (workflowsEnabled()) await this.stock!.release(tx, order.id, "released");
      }
    });
  }
  async status(token: string) {
    let order = await this.prisma.order.findUnique({
      where: { publicToken: token },
      include: { paymentAttempts: true },
    });
    if (!order) throw new NotFoundException();
    const attempt = order.paymentAttempts[0];
    if (
      order.status === "awaiting_payment" &&
      attempt?.providerReference &&
      process.env.BOG_PAYMENTS_ENABLED === "true"
    ) {
      try {
        await this.apply(await this.bank.receipt(attempt.providerReference));
        order = await this.prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { paymentAttempts: true },
        });
      } catch {
        /* Keep last confirmed state on transient failure. */
      }
    }
    return {
      status: order.status,
      total: order.total,
      currency: order.currency,
      orderNumber: this.orderNumber(order.id, order.paidAt ?? order.createdAt),
      receiptStatus: order.notificationStatus,
      pdfReady: !!order.receiptPdfEncrypted,
    };
  }

  private orderNumber(orderId: string, date: Date) {
    const year = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Tbilisi",
      year: "numeric",
    }).format(date);
    return `TYR-${year}-${orderId.replace(/-/g, "").slice(-6).toUpperCase()}`;
  }
  async pdf(token: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicToken: token },
      select: { id: true, status: true, receiptPdfEncrypted: true },
    });
    if (order?.status !== "paid" || !order.receiptPdfEncrypted)
      throw new NotFoundException("Document not ready");
    return openReceipt(order.receiptPdfEncrypted, order.id);
  }
}
