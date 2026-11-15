import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { FiltersService } from "./filters.service";
import { FilterOptionsResponseDto } from "../common/dto/route-response.dto";

@Controller("filters")
export class FiltersController {
  constructor(private readonly filters: FiltersService) {}

  @Get()
  @ApiOkResponse({ type: FilterOptionsResponseDto })
  options() {
    return this.filters.options();
  }
}
