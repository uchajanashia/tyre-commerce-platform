import { WalletCheckoutConfig, WalletPaymentService } from './wallet-payment.service';

const config: WalletCheckoutConfig = {
  enabled: true,
  hostedEnabled: true,
  googlePayExternalEnabled: true,
  applePayExternalEnabled: false,
  googlePayMerchantId: 'BCR2DN6TSXXXZ000',
  googlePayMerchantName: 'tyre.ge',
  googlePayEnvironment: 'TEST',
};

describe('WalletPaymentService', () => {
  afterEach(() => {
    delete (window as unknown as { google?: unknown }).google;
    delete (window as unknown as { ApplePaySession?: unknown }).ApplePaySession;
  });

  it('does not load Google Pay when the server-side feature gate is closed', async () => {
    const service = new WalletPaymentService();
    const host = document.createElement('div');

    await expect(
      service.googlePayToken({ ...config, googlePayExternalEnabled: false }, 1, 'GEL'),
    ).rejects.toThrow('Google Pay is not configured');
    await expect(
      service.mountGoogleButton(
        host,
        { ...config, googlePayExternalEnabled: false },
        () => undefined,
      ),
    ).resolves.toBe(false);
    expect(document.querySelector('script[src*="pay.google.com"]')).toBeNull();
  });

  it('mounts a Google button only after the SDK reports readiness', async () => {
    const button = document.createElement('button');
    const isReadyToPay = vi.fn().mockResolvedValue({ result: true });
    const createButton = vi.fn().mockReturnValue(button);
    class PaymentsClient {
      isReadyToPay = isReadyToPay;
      createButton = createButton;
      loadPaymentData = vi.fn();
    }
    (window as unknown as { google: unknown }).google = {
      payments: { api: { PaymentsClient } },
    };
    const host = document.createElement('div');

    await expect(
      new WalletPaymentService().mountGoogleButton(host, config, () => undefined),
    ).resolves.toBe(true);
    expect(isReadyToPay).toHaveBeenCalledOnce();
    expect(createButton).toHaveBeenCalledOnce();
    expect(host.firstElementChild).toBe(button);
  });

  it('fails Apple Pay authorization closed when the SDK omits its token', async () => {
    class ApplePaySession {
      static STATUS_SUCCESS = 1;
      static STATUS_FAILURE = 2;
      static active: ApplePaySession | undefined;
      static canMakePayments() {
        return true;
      }
      onvalidatemerchant: null | (() => void) = null;
      onpaymentauthorized: null | ((event: { payment?: { token?: unknown } }) => void) = null;
      oncancel: null | (() => void) = null;
      completePayment = vi.fn();
      begin() {
        ApplePaySession.active = this;
      }
      abort() {
        return;
      }
      completeMerchantValidation() {
        return;
      }
    }
    (window as unknown as { ApplePaySession: unknown }).ApplePaySession = ApplePaySession;
    const authorize = vi.fn();
    const payment = new WalletPaymentService().beginApplePay(1, 'GEL', async () => ({}), authorize);

    ApplePaySession.active!.onpaymentauthorized!({ payment: {} });
    await expect(payment).rejects.toThrow('Apple Pay did not return a token');
    expect(authorize).not.toHaveBeenCalled();
    expect(ApplePaySession.active!.completePayment).toHaveBeenCalledWith({ status: 2 });
  });
});
