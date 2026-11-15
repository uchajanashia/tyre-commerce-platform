import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const APPROVAL_VALUES = ["approve", "reject"] as const;
const POLICY_MODES = ["disabled", "direct", "approval_required"] as const;
const RETIREMENT_REASONS = [
  "SUPERSEDED",
  "CONTROL_REVIEW",
  "SAFETY_DISABLE",
] as const;

export class GovernanceActionIntentBindingsResponseDto {
  @ApiProperty() action!: string;
  @ApiProperty() resourceType!: string;
  @ApiProperty() resourceId!: string;
  @ApiProperty({ minimum: 0 }) resourceVersion!: number;
  @ApiPropertyOptional() payloadHash?: string;
  @ApiPropertyOptional() targetSetHash?: string;
  @ApiPropertyOptional() policyHash?: string;
  @ApiPropertyOptional({ minimum: 1 }) policyVersion?: number;
  @ApiPropertyOptional() approvalEvidenceSetHash?: string;
  @ApiPropertyOptional({ enum: APPROVAL_VALUES })
  decisionValue?: (typeof APPROVAL_VALUES)[number];
  @ApiPropertyOptional() executionId?: string;
  @ApiPropertyOptional() reasonCode?: string;
  @ApiProperty({ format: "uuid" }) correlationId!: string;
}

export class GovernanceActionIntentResponseDto {
  @ApiProperty() intentToken!: string;
  @ApiProperty({ pattern: "^[A-Za-z0-9_-]{43}$" }) actionHash!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ type: () => GovernanceActionIntentBindingsResponseDto })
  bindings!: GovernanceActionIntentBindingsResponseDto;
}

export class GovernanceSemanticPolicyResponseDto {
  @ApiProperty() policyKey!: string;
  @ApiProperty({ minimum: 1 }) proposedPolicyVersion!: number;
  @ApiProperty() actionType!: string;
  @ApiProperty({ minimum: 1 }) actionSchemaVersionMin!: number;
  @ApiProperty({ minimum: 1 }) actionSchemaVersionMax!: number;
  @ApiProperty({ enum: POLICY_MODES }) mode!: (typeof POLICY_MODES)[number];
  @ApiProperty({ minimum: 0 }) requiredApproverCount!: number;
}

export class GovernanceEvidenceDescriptorResponseDto {
  @ApiProperty() decisionId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
}

export class GovernancePrepareProposalResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() proposalId!: string;
  @ApiProperty({ type: () => GovernanceSemanticPolicyResponseDto })
  semanticPolicy!: GovernanceSemanticPolicyResponseDto;
  @ApiProperty() policyHash!: string;
  @ApiProperty({
    type: () => GovernanceEvidenceDescriptorResponseDto,
    isArray: true,
  })
  evidenceDescriptors!: GovernanceEvidenceDescriptorResponseDto[];
  @ApiProperty() approvalEvidenceSetHash!: string;
  @ApiProperty({ minimum: 2 }) requiredReviewCount!: number;
}

export class GovernancePrepareReviewResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() proposalId!: string;
  @ApiProperty({ enum: APPROVAL_VALUES })
  value!: (typeof APPROVAL_VALUES)[number];
  @ApiProperty() policyHash!: string;
  @ApiProperty() evidenceHash!: string;
}

export class GovernancePrepareActivationResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() proposalId!: string;
  @ApiProperty() policyId!: string;
}

export class GovernancePrepareRetirementResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() policyId!: string;
  @ApiProperty() proposalId!: string;
  @ApiProperty({ enum: RETIREMENT_REASONS })
  reasonCode!: (typeof RETIREMENT_REASONS)[number];
}

export class GovernancePrepareDecisionResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() requestId!: string;
  @ApiProperty({ enum: APPROVAL_VALUES })
  value!: (typeof APPROVAL_VALUES)[number];
}

export class GovernancePrepareExecutionResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() requestId!: string;
  @ApiProperty() executionId!: string;
  @ApiProperty() approvalEvidenceSetHash!: string;
}

export class GovernancePrepareCancellationResponseDto {
  @ApiProperty({ type: () => GovernanceActionIntentResponseDto })
  intent!: GovernanceActionIntentResponseDto;
  @ApiProperty() requestId!: string;
}

export class PolicyProposalMutationResponseDto {
  @ApiProperty() proposalId!: string;
  @ApiProperty() state!: string;
  @ApiProperty() version!: number;
}

export class PolicyActivationResponseDto {
  @ApiProperty() policyId!: string;
  @ApiProperty({ enum: ["active"] }) state!: "active";
}

export class PolicyRetirementResponseDto {
  @ApiProperty() policyId!: string;
  @ApiProperty({ enum: ["retired"] }) state!: "retired";
}

export class ApprovalRequestMutationResponseDto {
  @ApiProperty() requestId!: string;
  @ApiProperty() state!: string;
  @ApiProperty() version!: number;
}

export class ApprovalExecutionResponseDto {
  @ApiProperty() executionId!: string;
  @ApiProperty() state!: string;
}
