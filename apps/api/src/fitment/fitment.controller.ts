import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { LookupFitmentQuery } from "./dto/lookup-fitment.query";
import { FitmentService } from "./fitment.service";
import {
  FitmentLookupResponseDto,
  FitmentNamedResponseDto,
} from "../common/dto/route-response.dto";

@Controller("fitment")
export class FitmentController {
  constructor(private readonly fitment: FitmentService) {}

  @Get("makes")
  @ApiOkResponse({ type: [FitmentNamedResponseDto] })
  makes() {
    return this.fitment.getMakes();
  }

  @Get("makes/:make/models")
  @ApiOkResponse({ type: [FitmentNamedResponseDto] })
  models(@Param("make") make: string) {
    return this.fitment.getModels(make);
  }

  @Get("makes/:make/models/:model/years")
  @ApiOkResponse({ type: [Number] })
  years(@Param("make") make: string, @Param("model") model: string) {
    return this.fitment.getYears(make, model);
  }

  @Get("lookup")
  @ApiOkResponse({ type: FitmentLookupResponseDto })
  async lookup(@Query() query: LookupFitmentQuery) {
    const result = await this.fitment.lookup(
      query.make,
      query.model,
      query.year,
      query.trim,
    );
    if (!result) {
      throw new NotFoundException(
        "No fitment data found for that make/model/year.",
      );
    }
    return result;
  }
}
