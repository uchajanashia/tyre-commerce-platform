import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { BrandsService } from "./brands.service";
import { PublicBrandResponseDto } from "../common/dto/route-response.dto";

@Controller("brands")
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @ApiOkResponse({ type: [PublicBrandResponseDto] })
  list() {
    return this.brands.list();
  }

  @Get(":id")
  @ApiOkResponse({ type: PublicBrandResponseDto })
  findOne(@Param("id") id: string) {
    return this.brands.findOne(id);
  }
}
