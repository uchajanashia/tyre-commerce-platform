import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { CartQuoteRequestDto } from "./cart-quote.dto";

export class CreateCheckoutDto extends CartQuoteRequestDto {
  @IsUUID("4") idempotencyKey!: string;
  @IsIn(["pickup", "delivery"]) deliveryMethod!: "pickup" | "delivery";
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsString() @Matches(/^\+?[0-9 ()-]{9,20}$/) phone!: string;
  @ValidateIf(
    (_o: CreateCheckoutDto, value) => value !== undefined && value !== "",
  )
  @IsString()
  @Matches(/^[0-9]{11}$/)
  personalNumber?: string;
  @ValidateIf((o: CreateCheckoutDto) => o.deliveryMethod === "delivery")
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address?: string;
}
