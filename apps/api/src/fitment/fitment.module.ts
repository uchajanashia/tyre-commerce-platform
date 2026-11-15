import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";

import { FitmentController } from "./fitment.controller";
import { FitmentService } from "./fitment.service";
import { WheelSizeClientService } from "./wheel-size-client.service";

@Module({
  imports: [HttpModule.register({ timeout: 5000 })],
  controllers: [FitmentController],
  providers: [FitmentService, WheelSizeClientService],
})
export class FitmentModule {}
