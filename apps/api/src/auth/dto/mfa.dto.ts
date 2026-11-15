import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class MfaEnrollmentStartDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  activationProof!: string;
}

export class MfaEnrollmentConfirmDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  enrollmentToken!: string;

  @Matches(/^\d{6}$/)
  code!: string;
}

export class StepUpDto {
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(128)
  requestedActionHash!: string;
}

export class RevokeAllDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  stepUpToken!: string;
}
