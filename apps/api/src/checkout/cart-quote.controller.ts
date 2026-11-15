import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiCreatedResponse } from "@nestjs/swagger";

import { CartQuoteService } from "./cart-quote.service";
import { CartQuoteRequestDto } from "./dto/cart-quote.dto";
import { CartQuoteResponseDto } from "../common/dto/route-response.dto";

@Controller("cart")
export class CartQuoteController {
  constructor(private readonly quotes: CartQuoteService) {}

  /** Reprices and validates 1–4 units without exposing the exact stock count. */
  @Post("quote")
  @ApiCreatedResponse({ type: CartQuoteResponseDto })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  quote(@Body() dto: CartQuoteRequestDto) {
    return this.quotes.quote(dto.items);
  }
}
