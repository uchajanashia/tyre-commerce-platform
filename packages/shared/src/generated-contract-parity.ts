import type {
  RequestByOperation,
  ResponseByOperation,
  Secret,
} from "@tyre/admin-api-client";

import type { AuditEventDetail, AuditEventListResult } from "./audit";
import type { JobDetail, JobListResult } from "./jobs";

type Extends<Left, Right> = [Left] extends [Right] ? true : false;
type Assert<Value extends true> = Value;
type Bidirectional<Left, Right> = Extends<Left, Right> extends true
  ? Extends<Right, Left>
  : false;

type _AuditListExact = Assert<
  Bidirectional<ResponseByOperation["audit-reader.list"], AuditEventListResult>
>;
type _AuditDetailExact = Assert<
  Bidirectional<ResponseByOperation["audit-reader.detail"], AuditEventDetail>
>;
type _JobListExact = Assert<
  Bidirectional<ResponseByOperation["jobs-reader.list"], JobListResult>
>;
type _JobDetailExact = Assert<
  Bidirectional<ResponseByOperation["jobs-reader.detail"], JobDetail>
>;

type LoginRequest = RequestByOperation["identity-auth.login"];
type _LoginRequestExact = Assert<
  Bidirectional<LoginRequest["body"], { email: string; password: string }>
>;
type Authenticated = Extract<
  ResponseByOperation["identity-auth.login"],
  { status: "authenticated" }
>;
type MfaRequired = Extract<
  ResponseByOperation["identity-auth.login"],
  { status: "mfa_required" }
>;
type _AccessTokenOpaque = Assert<
  Extends<Authenticated["accessToken"], Secret<"credential.access_token">>
>;
type _ChallengeTokenOpaque = Assert<
  Extends<MfaRequired["challengeToken"], Secret<"proof.mfa_login_challenge">>
>;
export type GeneratedContractParityAssertions =
  | _AuditListExact
  | _AuditDetailExact
  | _JobListExact
  | _JobDetailExact
  | _LoginRequestExact
  | _AccessTokenOpaque
  | _ChallengeTokenOpaque;
