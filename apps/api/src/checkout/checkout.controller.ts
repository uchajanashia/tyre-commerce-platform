import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { CheckoutService } from "./checkout.service";
import { BogProvider } from "./bog.provider";
import { readBogPaymentFeatureConfig } from "./bog-payment.config";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import {
  CompleteApplePayDto,
  CreateGooglePayCheckoutDto,
} from "./dto/wallet-checkout.dto";
import { ReverseGeocodeDto } from "./dto/reverse-geocode.dto";
import { ReverseGeocodeService } from "./reverse-geocode.service";

export class CheckoutCreatedResponse {
  @ApiProperty() orderPublicToken!: string;
  @ApiProperty() redirectUrl!: string;
}
export class CheckoutStatusResponse {
  @ApiProperty() status!: string;
  @ApiProperty() total!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() receiptStatus!: string;
  @ApiProperty() pdfReady!: boolean;
}
export class CallbackResponse {
  @ApiProperty() received!: boolean;
}
export class CheckoutConfigResponse {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() testOnly!: boolean;
  @ApiProperty() hostedEnabled!: boolean;
  @ApiProperty() googlePayExternalEnabled!: boolean;
  @ApiProperty() applePayExternalEnabled!: boolean;
  @ApiProperty({ required: false }) googlePayMerchantId?: string;
  @ApiProperty({ required: false }) googlePayMerchantName?: string;
  @ApiProperty() googlePayEnvironment!: "TEST" | "PRODUCTION";
}
export class WalletActionResponse {
  @ApiProperty({ enum: ["processing", "completed", "redirect"] })
  kind!: "processing" | "completed" | "redirect";
  @ApiProperty() orderPublicToken!: string;
  @ApiProperty({ required: false }) redirectUrl?: string;
}
export class ApplePaySessionResponse {
  @ApiProperty({ enum: ["apple_pay_session"] })
  kind!: "apple_pay_session";
  @ApiProperty() orderPublicToken!: string;
  @ApiProperty({
    maxLength: 262144,
    description:
      "Opaque short-lived merchant validation payload; never log or persist.",
  })
  sessionJson!: string;
}
export class ReverseGeocodeResponse {
  @ApiProperty() city!: string;
  @ApiProperty() street!: string;
  @ApiProperty() formattedAddress!: string;
}

@Controller("checkout")
@ApiExtraModels(WalletActionResponse, ApplePaySessionResponse)
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly geocoder: ReverseGeocodeService,
  ) {}
  @Get("config")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CheckoutConfigResponse })
  config() {
    const payment = readBogPaymentFeatureConfig();
    return {
      enabled: process.env.CHECKOUT_ENABLED === "true" && payment.enabled,
      testOnly: false,
      hostedEnabled: payment.hostedEnabled,
      googlePayExternalEnabled: payment.googlePayExternalEnabled,
      applePayExternalEnabled: payment.applePayExternalEnabled,
      googlePayMerchantId: payment.googlePayExternalEnabled
        ? payment.googlePayMerchantId
        : undefined,
      googlePayMerchantName: payment.googlePayExternalEnabled
        ? payment.googlePayMerchantName
        : undefined,
      googlePayEnvironment: payment.googlePayEnvironment,
    };
  }
  @Post("location/reverse-geocode")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @ApiOkResponse({ type: ReverseGeocodeResponse })
  reverseGeocode(@Body() dto: ReverseGeocodeDto) {
    return this.geocoder.reverse(dto.latitude, dto.longitude);
  }
  @Post("orders")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @ApiCreatedResponse({ type: CheckoutCreatedResponse })
  create(@Body() dto: CreateCheckoutDto) {
    return this.checkout.create(dto);
  }
  @Post("wallets/google-pay/orders")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 4, ttl: 60000 } })
  @ApiCreatedResponse({ type: WalletActionResponse })
  createGooglePay(@Body() dto: CreateGooglePayCheckoutDto) {
    return this.checkout.createGooglePay(dto);
  }
  @Post("wallets/apple-pay/orders")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 4, ttl: 60000 } })
  @ApiCreatedResponse({ type: ApplePaySessionResponse })
  createApplePay(@Body() dto: CreateCheckoutDto) {
    return this.checkout.createApplePay(dto);
  }
  @Post("wallets/apple-pay/orders/:token/complete")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @ApiCreatedResponse({ type: WalletActionResponse })
  completeApplePay(
    @Param("token") token: string,
    @Body() dto: CompleteApplePayDto,
  ) {
    return this.checkout.completeApplePay(token, dto);
  }
  @Get("orders/:token")
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOkResponse({ type: CheckoutStatusResponse })
  status(@Param("token") token: string) {
    return this.checkout.status(token);
  }
  @Get("orders/:token/pdf")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOkResponse({
    content: {
      "application/pdf": { schema: { type: "string", format: "binary" } },
    },
  })
  async pdf(@Param("token") token: string) {
    return new StreamableFile(await this.checkout.pdf(token), {
      type: "application/pdf",
      disposition: 'inline; filename="tyre-order.pdf"',
    });
  }
}
@Controller("payments/bog")
export class BogCallbackController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly bank: BogProvider,
  ) {}
  @Post("callback")
  @HttpCode(200)
  @ApiOkResponse({ type: CallbackResponse })
  async callback(
    @Req() request: RawBodyRequest<Request>,
    @Headers("callback-signature") signature: string,
  ) {
    if (!request.rawBody) throw new UnauthorizedException();
    await this.checkout.apply(this.bank.callback(request.rawBody, signature));
    return { received: true };
  }
}
