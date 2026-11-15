import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class IdentityLoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(1024)
  password!: string;
}

export class CompleteMfaChallengeDto {
  @IsString()
  @MinLength(60)
  @MaxLength(80)
  challengeToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(80)
  code!: string;
}
