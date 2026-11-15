import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class OneTimeTokenDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  token!: string;
}

export class AcceptInvitationDto extends OneTimeTokenDto {
  @IsString()
  @MaxLength(1024)
  password!: string;
}

export class PasswordResetRequestDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class CompletePasswordResetDto extends OneTimeTokenDto {
  @IsString()
  @MaxLength(1024)
  newPassword!: string;
}
