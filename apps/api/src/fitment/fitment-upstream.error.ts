import { ServiceUnavailableException } from "@nestjs/common";

/**
 * A sanitized boundary error for Wheel-Size failures. Nest renders it as 503,
 * while callers can still distinguish retryable transport/rate-limit failures
 * from permanent 4xx responses and invalid upstream payloads.
 */
export class FitmentUpstreamError extends ServiceUnavailableException {
  constructor(
    message: string,
    readonly retryable = false,
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }
}
