import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ActionIntentService } from './action-intent.service';
import { ApprovalService } from './approval.service';
import { GOVERNANCE_CONFIG, readGovernanceConfig } from './governance-config';
import { GovernanceController } from './governance.controller';
import { GovernanceIdempotencyService } from './governance-idempotency.service';
import { PolicyControlService } from './policy-control.service';

@Module({
  imports: [AuthModule],
  controllers: [GovernanceController],
  providers: [
    ActionIntentService, GovernanceIdempotencyService, PolicyControlService, ApprovalService,
    { provide: GOVERNANCE_CONFIG, useFactory: readGovernanceConfig },
  ],
  exports: [ActionIntentService, ApprovalService, PolicyControlService, GOVERNANCE_CONFIG],
})
export class GovernanceModule {}
