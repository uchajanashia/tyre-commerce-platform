import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { IdentityAccessGuard } from './identity-access.guard';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { legacyJwtConfigured } from './legacy-auth-mode';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(
    private readonly identity: IdentityAccessGuard,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (this.config.enabled && !legacyJwtConfigured()) {
      return this.identity.canActivate(context);
    }
    return super.canActivate(context);
  }
}
