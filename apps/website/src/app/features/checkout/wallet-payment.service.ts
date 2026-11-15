import { Injectable } from '@angular/core';

export interface WalletCheckoutConfig {
  enabled: boolean;
  hostedEnabled: boolean;
  googlePayExternalEnabled: boolean;
  applePayExternalEnabled: boolean;
  googlePayMerchantId?: string;
  googlePayMerchantName?: string;
  googlePayEnvironment: 'TEST' | 'PRODUCTION';
}

interface GooglePaymentsClient {
  isReadyToPay(request: unknown): Promise<{ result: boolean }>;
  createButton(options: Record<string, unknown>): HTMLElement;
  loadPaymentData(request: unknown): Promise<{
    paymentMethodData?: { tokenizationData?: { token?: string } };
  }>;
}

interface GoogleApi {
  PaymentsClient: new (options: { environment: 'TEST' | 'PRODUCTION' }) => GooglePaymentsClient;
}

interface ApplePaySessionInstance {
  onvalidatemerchant: null | (() => void);
  onpaymentauthorized: null | ((event: { payment?: { token?: unknown } }) => void);
  oncancel: null | (() => void);
  begin(): void;
  abort(): void;
  completeMerchantValidation(session: unknown): void;
  completePayment(result: { status: number }): void;
}

interface ApplePaySessionApi {
  new (version: number, request: Record<string, unknown>): ApplePaySessionInstance;
  canMakePayments(): boolean;
  readonly STATUS_SUCCESS: number;
  readonly STATUS_FAILURE: number;
}

const GOOGLE_SCRIPT = 'https://pay.google.com/gp/p/js/pay.js';
const CARD_PARAMETERS = {
  allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
  allowedCardNetworks: ['VISA', 'MASTERCARD'],
};
const TOKENIZATION = {
  type: 'PAYMENT_GATEWAY',
  parameters: {
    gateway: 'georgiancard',
    gatewayMerchantId: 'BCR2DN4TXKPITITV',
  },
};

@Injectable({ providedIn: 'root' })
export class WalletPaymentService {
  private googleScript?: Promise<GoogleApi>;

  async prepareGooglePay(config: WalletCheckoutConfig): Promise<boolean> {
    if (
      !config.googlePayExternalEnabled ||
      !config.googlePayMerchantId ||
      !config.googlePayMerchantName
    ) {
      return false;
    }
    const client = await this.googleClient(config);
    const readiness = await client.isReadyToPay({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [{ type: 'CARD', parameters: CARD_PARAMETERS }],
    });
    return readiness.result;
  }

  async mountGoogleButton(
    host: HTMLElement,
    config: WalletCheckoutConfig,
    onClick: () => void,
  ): Promise<boolean> {
    if (
      !config.googlePayExternalEnabled ||
      !config.googlePayMerchantId ||
      !config.googlePayMerchantName
    ) {
      return false;
    }
    const client = await this.googleClient(config);
    const readiness = await client.isReadyToPay({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [{ type: 'CARD', parameters: CARD_PARAMETERS }],
    });
    if (!readiness.result) return false;
    const button = client.createButton({
      onClick,
      buttonType: 'pay',
      buttonColor: 'black',
      buttonSizeMode: 'fill',
    });
    host.replaceChildren(button);
    return true;
  }

  async googlePayToken(
    config: WalletCheckoutConfig,
    amount: number,
    currency: string,
  ): Promise<string> {
    if (
      !config.googlePayExternalEnabled ||
      !config.googlePayMerchantId ||
      !config.googlePayMerchantName
    ) {
      throw new Error('Google Pay is not configured');
    }
    const client = await this.googleClient(config);
    const result = await client.loadPaymentData({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [
        {
          type: 'CARD',
          parameters: CARD_PARAMETERS,
          tokenizationSpecification: TOKENIZATION,
        },
      ],
      merchantInfo: {
        merchantId: config.googlePayMerchantId,
        merchantName: config.googlePayMerchantName,
      },
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: amount.toFixed(2),
        currencyCode: currency,
        countryCode: 'GE',
      },
    });
    const token = result.paymentMethodData?.tokenizationData?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Google Pay did not return a token');
    }
    return token;
  }

  supportsApplePay(): boolean {
    const ApplePay = (window as unknown as { ApplePaySession?: ApplePaySessionApi })
      .ApplePaySession;
    return !!ApplePay?.canMakePayments?.();
  }

  beginApplePay(
    amount: number,
    currency: string,
    validateMerchant: () => Promise<unknown>,
    authorize: (token: string) => Promise<void>,
  ): Promise<void> {
    const ApplePay = (window as unknown as { ApplePaySession?: ApplePaySessionApi })
      .ApplePaySession;
    if (!ApplePay?.canMakePayments?.()) return Promise.reject(new Error('Apple Pay unavailable'));
    const session = new ApplePay(3, {
      countryCode: 'GE',
      currencyCode: currency,
      merchantCapabilities: ['supports3DS'],
      supportedNetworks: ['visa', 'masterCard'],
      total: { label: 'tyre.ge', amount: amount.toFixed(2) },
    });
    return new Promise<void>((resolve, reject) => {
      session.onvalidatemerchant = async () => {
        try {
          session.completeMerchantValidation(await validateMerchant());
        } catch (error) {
          session.abort();
          reject(error);
        }
      };
      session.onpaymentauthorized = async (event: { payment?: { token?: unknown } }) => {
        try {
          const paymentToken = event.payment?.token;
          if (!paymentToken || typeof paymentToken !== 'object') {
            throw new Error('Apple Pay did not return a token');
          }
          await authorize(JSON.stringify(paymentToken));
          session.completePayment({ status: ApplePay.STATUS_SUCCESS });
          resolve();
        } catch (error) {
          session.completePayment({ status: ApplePay.STATUS_FAILURE });
          reject(error);
        }
      };
      session.oncancel = () => reject(new Error('Apple Pay cancelled'));
      session.begin();
    });
  }

  private async googleClient(config: WalletCheckoutConfig): Promise<GooglePaymentsClient> {
    const api = await (this.googleScript ??= this.loadGoogleScript());
    return new api.PaymentsClient({ environment: config.googlePayEnvironment });
  }

  private loadGoogleScript(): Promise<GoogleApi> {
    const existing = this.googleApi();
    if (existing) return Promise.resolve(existing);
    return new Promise<GoogleApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      script.onload = () => {
        const api = this.googleApi();
        if (api) resolve(api);
        else reject(new Error('Google Pay SDK unavailable'));
      };
      script.onerror = () => reject(new Error('Google Pay SDK unavailable'));
      document.head.appendChild(script);
    });
  }

  private googleApi(): GoogleApi | undefined {
    return (
      window as unknown as {
        google?: { payments?: { api?: GoogleApi } };
      }
    ).google?.payments?.api;
  }
}
