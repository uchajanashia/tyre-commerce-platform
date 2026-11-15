import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { ListProductsQuery, SizeFacetsQuery } from "./dto/list-products.query";
import { ProductsService } from "./products.service";
import {
  ProductSizeFacetsResponseDto,
  PublicProductListResponseDto,
  PublicProductResponseDto,
} from "../common/dto/route-response.dto";

@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOkResponse({ type: PublicProductListResponseDto })
  list(@Query() query: ListProductsQuery) {
    return this.products.list(query);
  }

  // Declared before ':id' so "/products/sizes" isn't captured as an id.
  @Get("sizes")
  @ApiOkResponse({ type: ProductSizeFacetsResponseDto })
  sizes(@Query() query: SizeFacetsQuery) {
    return this.products.sizes(query);
  }

  @Get(":id")
  @ApiOkResponse({ type: PublicProductResponseDto })
  findOne(@Param("id") id: string) {
    return this.products.findOne(id);
  }
}
