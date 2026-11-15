export interface PaymentInitialization {
  attemptId: string;
  orderPublicToken: string;
  amount: number;
  currency: string;
}

export interface PaymentInitializationResult {
  providerReference: string;
  redirectUrl: string;
}

export interface VerifiedPaymentEvent {
  providerEventId: string;
  providerReference: string;
  eventType: string;
  payloadHash: string;
}

/** Provider-neutral boundary; concrete BOG DTOs belong behind this interface. */
export interface PaymentProvider {
  readonly id: string;
  readonly enabled: boolean;
  initialize(input: PaymentInitialization): Promise<PaymentInitializationResult>;
  verifyCallback(rawBody: Buffer, headers: Readonly<Record<string, string>>): Promise<VerifiedPaymentEvent>;
}
