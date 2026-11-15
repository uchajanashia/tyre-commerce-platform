import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type {
  PaymentInitialization,
  PaymentInitializationResult,
  PaymentProvider,
  VerifiedPaymentEvent,
} from './payment-provider';

@Injectable()
export class DisabledBogPaymentProvider implements PaymentProvider {
  readonly id = 'bog';
  readonly enabled = false;

  initialize(_input: PaymentInitialization): Promise<PaymentInitializationResult> {
    throw this.unavailable();
  }

  verifyCallback(
    _rawBody: Buffer,
    _headers: Readonly<Record<string, string>>,
  ): Promise<VerifiedPaymentEvent> {
    throw this.unavailable();
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'Bank of Georgia payments are disabled until official merchant credentials and documentation are configured',
    );
  }
}
