/**
 * Increment 3C ships the orchestration kernel, not business execution. Keeping
 * this frozen tuple empty makes handler invocation impossible by construction.
 */
export const ACTIVE_JOB_HANDLERS = Object.freeze([] as const);
export const ACTIVE_OUTBOX_CONSUMERS = Object.freeze([] as const);

export function assertZeroHandlerCore(): void {
  if (ACTIVE_JOB_HANDLERS.length !== 0 || ACTIVE_OUTBOX_CONSUMERS.length !== 0) {
    throw new Error('JOBS_3C_ZERO_HANDLER_CONTRACT_VIOLATION');
  }
}
