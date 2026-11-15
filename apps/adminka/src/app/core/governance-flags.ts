import { InjectionToken } from '@angular/core';

import { environment } from '../../environments/environment';

export type GovernanceFeature = 'approvals' | 'audit' | 'jobs';

export interface GovernanceFeatureConfig {
  readonly apiBaseUrl: string;
  readonly approvalsEnabled: boolean;
  readonly auditReaderEnabled: boolean;
  readonly jobsReaderEnabled: boolean;
}

export const GOVERNANCE_FEATURE_CONFIG = new InjectionToken<GovernanceFeatureConfig>(
  'GOVERNANCE_FEATURE_CONFIG',
  {
    providedIn: 'root',
    factory: () => ({
      apiBaseUrl: environment.identityApiBaseUrl,
      approvalsEnabled: environment.approvalPlatformEnabled,
      auditReaderEnabled: environment.auditReaderEnabled,
      jobsReaderEnabled: environment.jobsReaderEnabled,
    }),
  },
);

export function isGovernanceFeatureEnabled(
  config: GovernanceFeatureConfig,
  feature: GovernanceFeature,
): boolean {
  if (feature === 'approvals') return config.approvalsEnabled;
  return feature === 'audit' ? config.auditReaderEnabled : config.jobsReaderEnabled;
}
