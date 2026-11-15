import { Module } from "@nestjs/common";

import { CartQuoteController } from "./cart-quote.controller";
import { CartQuoteService } from "./cart-quote.service";
import { DisabledBogPaymentProvider } from "./disabled-bog.provider";
import { OrdersService } from "./orders.service";
import {
  CheckoutController,
  BogCallbackController,
} from "./checkout.controller";
import { CheckoutService } from "./checkout.service";
import { BogProvider } from "./bog.provider";
import { ReceiptDispatcher } from "./receipt-dispatcher";
import { ReverseGeocodeService } from "./reverse-geocode.service";

import { WorkflowCoreModule } from '../operations/workflow-core.module';

@Module({
  imports: [WorkflowCoreModule],
  controllers: [CartQuoteController, CheckoutController, BogCallbackController],
  providers: [
    CartQuoteService,
    OrdersService,
    DisabledBogPaymentProvider,
    CheckoutService,
    BogProvider,
    ReceiptDispatcher,
    ReverseGeocodeService,
  ],
  exports: [CartQuoteService, OrdersService, DisabledBogPaymentProvider, CheckoutService, BogProvider],
})
export class CheckoutModule {}
