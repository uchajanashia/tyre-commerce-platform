import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class StaffRoleAssignmentDto {
  @IsString()
  roleId!: string;

  @IsIn(["global", "warehouse", "channel", "company"])
  scopeType!: "global" | "warehouse" | "channel" | "company";

  @IsString()
  @MaxLength(128)
  scopeId!: string;
}

export class CreateStaffPreviewDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @IsBoolean()
  mfaRequired!: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StaffRoleAssignmentDto)
  assignments!: StaffRoleAssignmentDto[];
}

export class CreateStaffDto extends CreateStaffPreviewDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}

export class StaffActionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonComment?: string;

  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}

export class StaffActionPreviewDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonComment?: string;
}

export class ReplaceStaffAssignmentsPreviewDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StaffRoleAssignmentDto)
  assignments!: StaffRoleAssignmentDto[];
}

export class ReplaceStaffAssignmentsDto extends ReplaceStaffAssignmentsPreviewDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}

export class ResendStaffInvitationDto extends StaffActionDto {}

export class PreviewTargetSessionRevokeRequestDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RevokeTargetSessionDto extends PreviewTargetSessionRevokeRequestDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}
