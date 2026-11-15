import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { IdentityAccessGuard } from './identity-access.guard';
import { IdentityAuthController } from './identity-auth.controller';
import { IdentityAuthService } from './identity-auth.service';
import { IDENTITY_CONFIG, readIdentityConfig } from './identity-config';
import { IdentityJwtService } from './identity-jwt.service';
import { IdentityMaintenanceService } from './identity-maintenance.service';
import { IdentityStartupService } from './identity-startup.service';
import { InvitationController, PasswordResetController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { MfaController, StepUpController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordKdfService } from './password-kdf.service';
import { StaffSessionService } from './staff-session.service';
import { RoleCatalogController, StaffAdminController } from './staff-admin.controller';
import { StaffAdminService } from './staff-admin.service';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { legacyJwtConfigured } from './legacy-auth-mode';
import { IdentityKeyLifecycleService } from './identity-key-lifecycle.service';

const legacyEnabled = legacyJwtConfigured();

/**
 * Admin auth: bcrypt-verified login issuing a stateless JWT (Bearer header).
 * AppModule applies a global request-rate guard; the login route overrides that
 * general policy with a stricter limit.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => ({
        // IdentityJwtService supplies its RS256 key explicitly. A module-level
        // HMAC secret exists only while the legacy surface is enabled.
        ...(legacyEnabled ? { secret: process.env.JWT_SECRET!.trim() } : {}),
        // env value like "8h"/"30m"; cast because jsonwebtoken types expiresIn as
        // ms.StringValue, which a plain env string can't satisfy statically.
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [
    ...(legacyEnabled ? [AuthController] : []),
    IdentityAuthController, InvitationController, PasswordResetController, MfaController,
    StepUpController, StaffAdminController, RoleCatalogController, RecoveryController,
  ],
  providers: [
    ...(legacyEnabled ? [AuthService, JwtStrategy] : []),
    IdentityJwtService,
    IdentityAuthService,
    IdentityAccessGuard,
    PasswordKdfService,
    StaffSessionService,
    IdentityStartupService,
    InvitationService,
    MfaService,
    StaffAdminService,
    RecoveryService,
    AuthThrottleService,
    IdentityMaintenanceService,
    IdentityKeyLifecycleService,
    { provide: IDENTITY_CONFIG, useFactory: readIdentityConfig },
  ],
  exports: [
    IdentityAuthService, IdentityAccessGuard, IdentityJwtService, StaffSessionService, MfaService,
    IDENTITY_CONFIG, ...(legacyEnabled ? [AuthService] : []),
  ],
})
export class AuthModule {}
