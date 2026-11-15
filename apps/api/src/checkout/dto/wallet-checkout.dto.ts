import { IsString, MaxLength, MinLength } from "class-validator";
import { CreateCheckoutDto } from "./create-checkout.dto";

const MAX_WALLET_TOKEN_LENGTH = 256 * 1024;

export class CreateGooglePayCheckoutDto extends CreateCheckoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_WALLET_TOKEN_LENGTH)
  googlePayToken!: string;
}

export class CompleteApplePayDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_WALLET_TOKEN_LENGTH)
  applePayToken!: string;
}
