import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { GovernanceController } from "./governance.controller";

const EXPECTED = [
  ["prepareProposal", "GovernancePrepareProposalResponseDto"],
  ["prepareReview", "GovernancePrepareReviewResponseDto"],
  ["prepareActivation", "GovernancePrepareActivationResponseDto"],
  ["prepareRetirement", "GovernancePrepareRetirementResponseDto"],
  ["prepareDecision", "GovernancePrepareDecisionResponseDto"],
  ["prepareExecution", "GovernancePrepareExecutionResponseDto"],
  ["prepareCancellation", "GovernancePrepareCancellationResponseDto"],
] as const;

test("all seven Governance prepare routes publish exact 201 response DTO metadata", () => {
  assert.equal(EXPECTED.length, 7);
  for (const [handler, responseType] of EXPECTED) {
    const method = (
      GovernanceController.prototype as unknown as Record<string, unknown>
    )[handler];
    assert.equal(typeof method, "function", `${handler} handler exists`);
    const responses = Reflect.getMetadata(
      "swagger/apiResponse",
      method as object,
    ) as Record<string, { type?: { name?: string } }> | undefined;
    assert.equal(
      responses?.["201"]?.type?.name,
      responseType,
      `${handler} exact response DTO`,
    );
  }
});
