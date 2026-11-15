/** Shape of the build-time environment config (same pattern as apps/website). */
export interface AdminEnvironment {
  /** Base URL of the @tyre/api backend. */
  apiBaseUrl: string;
  /** Canonical identity-v2 namespace. Production must resolve this same-origin. */
  identityApiBaseUrl: string;
  /** Fail-closed rollout gate; production stays false until same-origin routing evidence exists. */
  identityV2Enabled: boolean;
  /** Email copy is shown only when delivery is explicitly configured. */
  identityPasswordResetDelivery?: 'manual' | 'email';
  /** Generic approval UI/API foundation. D-05 and production review are separate gates. */
  approvalPlatformEnabled: boolean;
  /** Masked, read-only audit reader foundation. Export remains independently unavailable. */
  auditReaderEnabled: boolean;
  /** Read-only jobs and exception evidence reader. Mutating controls remain unavailable. */
  jobsReaderEnabled: boolean;
  /** C0 has no routes or navigation; this remains false in every committed environment. */
  customerMasterFoundationEnabled: boolean;
  /** C0.1 has no runtime or UI surface; this remains false in every committed environment. */
  customerDataVaultFoundationEnabled: false;
}
