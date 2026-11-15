import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApprovalDecisionValue, ApprovalReviewValue } from "@prisma/client";
import { ApiCreatedResponse } from "@nestjs/swagger";

import {
  IdentityAccessGuard,
  IdentityRequest,
} from "../auth/identity-access.guard";
import { ApprovalService } from "./approval.service";
import {
  PolicyControlService,
  PolicySemanticInput,
} from "./policy-control.service";
import {
  ApprovalExecutionResponseDto,
  ApprovalRequestMutationResponseDto,
  GovernancePrepareActivationResponseDto,
  GovernancePrepareCancellationResponseDto,
  GovernancePrepareDecisionResponseDto,
  GovernancePrepareExecutionResponseDto,
  GovernancePrepareProposalResponseDto,
  GovernancePrepareRetirementResponseDto,
  GovernancePrepareReviewResponseDto,
  PolicyActivationResponseDto,
  PolicyProposalMutationResponseDto,
  PolicyRetirementResponseDto,
} from "./dto/governance-response.dto";

interface MutationBody {
  intentToken: string;
  stepUpToken: string;
}

/**
 * No trusted-adapter request-creation route exists in this increment. Every
 * exposed control-plane/decision route still fails closed behind the runtime
 * flag, exact permissions, server-issued intent, MFA, CAS and idempotency.
 */
@Controller("admin/v1/governance")
@UseGuards(IdentityAccessGuard)
export class GovernanceController {
  constructor(
    private readonly policies: PolicyControlService,
    private readonly approvals: ApprovalService,
  ) {}

  @Post("policy-proposals/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareProposalResponseDto })
  prepareProposal(
    @Req() request: IdentityRequest,
    @Body() body: PolicySemanticInput,
  ) {
    return this.policies.prepareProposal(request.user, body, randomUUID());
  }

  @Post("policy-proposals")
  @ApiCreatedResponse({ type: PolicyProposalMutationResponseDto })
  propose(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: MutationBody & { command: PolicySemanticInput },
  ) {
    return this.policies.propose(
      request.user,
      body.command,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }

  @Post("policy-proposals/:id/reviews/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareReviewResponseDto })
  prepareReview(
    @Req() request: IdentityRequest,
    @Param("id") id: string,
    @Body() body: { value: ApprovalReviewValue },
  ) {
    return this.policies.prepareReview(
      request.user,
      id,
      body.value,
      randomUUID(),
    );
  }

  @Post("policy-proposals/:id/reviews")
  @ApiCreatedResponse({ type: PolicyProposalMutationResponseDto })
  review(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Param("id") id: string,
    @Body() body: MutationBody & { value: ApprovalReviewValue },
  ) {
    return this.policies.review(
      request.user,
      id,
      body.value,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }

  @Post("policy-proposals/:id/activation/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareActivationResponseDto })
  prepareActivation(@Req() request: IdentityRequest, @Param("id") id: string) {
    return this.policies.prepareActivation(request.user, id, randomUUID());
  }

  @Post("policy-proposals/:id/activation")
  @ApiCreatedResponse({ type: PolicyActivationResponseDto })
  activate(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Param("id") id: string,
    @Body() body: MutationBody,
  ) {
    return this.policies.activate(
      request.user,
      id,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }

  @Post("policies/:id/retirement/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareRetirementResponseDto })
  prepareRetirement(
    @Req() request: IdentityRequest,
    @Param("id") id: string,
    @Body()
    body: { reasonCode: "SUPERSEDED" | "CONTROL_REVIEW" | "SAFETY_DISABLE" },
  ) {
    return this.policies.prepareRetirement(
      request.user,
      id,
      body.reasonCode,
      randomUUID(),
    );
  }

  @Post("policies/:id/retirement")
  @ApiCreatedResponse({ type: PolicyRetirementResponseDto })
  retire(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Param("id") id: string,
    @Body()
    body: MutationBody & {
      reasonCode: "SUPERSEDED" | "CONTROL_REVIEW" | "SAFETY_DISABLE";
    },
  ) {
    return this.policies.retire(
      request.user,
      id,
      body.reasonCode,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }

  @Post("approval-requests/:id/decisions/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareDecisionResponseDto })
  prepareDecision(
    @Req() request: IdentityRequest,
    @Param("id") id: string,
    @Body() body: { value: ApprovalDecisionValue },
  ) {
    return this.approvals.prepareDecision(
      request.user,
      id,
      body.value,
      randomUUID(),
    );
  }

  @Post("approval-requests/:id/decisions")
  @ApiCreatedResponse({ type: ApprovalRequestMutationResponseDto })
  decide(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Param("id") id: string,
    @Body() body: MutationBody & { value: ApprovalDecisionValue },
  ) {
    return this.approvals.decide(
      request.user,
      id,
      body.value,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }

  @Post("approval-requests/:id/execution/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareExecutionResponseDto })
  prepareExecution(@Req() request: IdentityRequest, @Param("id") id: string) {
    return this.approvals.prepareExecution(request.user, id, randomUUID());
  }

  @Post("approval-requests/:id/execution")
  @ApiCreatedResponse({ type: ApprovalExecutionResponseDto })
  execute(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Param("id") id: string,
    @Body() body: MutationBody,
  ) {
    return this.approvals.authorizeExecution(
      request.user,
      id,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }

  @Post("approval-requests/:id/cancellation/prepare")
  @ApiCreatedResponse({ type: GovernancePrepareCancellationResponseDto })
  prepareCancellation(
    @Req() request: IdentityRequest,
    @Param("id") id: string,
  ) {
    return this.approvals.prepareCancellation(request.user, id, randomUUID());
  }

  @Post("approval-requests/:id/cancellation")
  @ApiCreatedResponse({ type: ApprovalRequestMutationResponseDto })
  cancel(
    @Req() request: IdentityRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Param("id") id: string,
    @Body() body: MutationBody,
  ) {
    return this.approvals.cancel(
      request.user,
      id,
      body.intentToken,
      body.stepUpToken,
      idempotencyKey,
    );
  }
}
