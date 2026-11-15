import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const STAFF_STATUSES = [
  "invited",
  "pending_activation",
  "active",
  "disabled",
] as const;

export class IdentitySessionListQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class StaffListQueryDto extends IdentitySessionListQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  q?: string;

  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: (typeof STAFF_STATUSES)[number];
}

export class TargetStaffSessionListQueryDto extends IdentitySessionListQueryDto {}
