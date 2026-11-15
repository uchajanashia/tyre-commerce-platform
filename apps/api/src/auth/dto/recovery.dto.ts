import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RecoveryRequestPreviewDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonComment?: string;

}

export class CreateRecoveryRequestDto extends RecoveryRequestPreviewDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}

export class ApproveRecoveryRequestDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}
