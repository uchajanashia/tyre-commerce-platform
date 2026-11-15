import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CartQuoteService } from '@core/services/cart-quote.service';
import { CartService } from '@core/services/cart.service';
import { CheckoutPage } from './checkout.page';

describe('CheckoutPage order summary', () => {
  it('shows the authoritative amount returned by the quote API', async () => {
    const items = signal([{ tireId: 'tire-1', quantity: 2, vehicleTrimId: null }]);
    await TestBed.configureTestingModule({
      imports: [CheckoutPage],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () =>
              of({
                enabled: true,
                hostedEnabled: true,
                googlePayExternalEnabled: false,
                applePayExternalEnabled: false,
                googlePayEnvironment: 'TEST',
              }),
            post: vi.fn(),
          },
        },
        {
          provide: CartService,
          useValue: { items: items.asReadonly(), itemCount: signal(2).asReadonly() },
        },
        {
          provide: CartQuoteService,
          useValue: {
            quote: () =>
              of({
                items: [],
                total: 550,
                currency: 'GEL',
                allAvailable: true,
              }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CheckoutPage);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('პროდუქტები2 ცალი');
      expect(text).toContain('550');
      const methods = (fixture.nativeElement as HTMLElement).querySelector('.payment-methods');
      const buttons = [...(methods?.querySelectorAll('button') ?? [])];
      expect(buttons).toHaveLength(3);
      expect(
        buttons.map((button) =>
          [...button.querySelectorAll('span:not([aria-hidden]), strong')]
            .map((part) => part.textContent?.trim().replace(/\u00a0/g, ' '))
            .join(' '),
        ),
      ).toEqual(['ბარათით გადახდა 550 ₾', 'Google Pay 550 ₾', 'Apple Pay 550 ₾']);
      expect(methods?.textContent).not.toContain('BOG');
    });
  });

  it('blocks checkout copy when the server says an item is unavailable', async () => {
    const items = signal([{ tireId: 'tire-1', quantity: 1, vehicleTrimId: null }]);
    await TestBed.configureTestingModule({
      imports: [CheckoutPage],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () =>
              of({
                enabled: true,
                hostedEnabled: true,
                googlePayExternalEnabled: false,
                applePayExternalEnabled: false,
                googlePayEnvironment: 'TEST',
              }),
            post: vi.fn(),
          },
        },
        {
          provide: CartService,
          useValue: { items: items.asReadonly(), itemCount: signal(1).asReadonly() },
        },
        {
          provide: CartQuoteService,
          useValue: {
            quote: () =>
              of({
                items: [],
                total: 0,
                currency: 'GEL',
                allAvailable: false,
              }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CheckoutPage);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('პროდუქტი აღარ არის ხელმისაწვდომი');
      expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    });
  });

  it('requests location only after a click and composes the compatible address field', async () => {
    const items = signal([{ tireId: 'tire-1', quantity: 1, vehicleTrimId: null }]);
    let locateSuccess: PositionCallback | undefined;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      locateSuccess = success;
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    const post = vi.fn(() =>
      of({
        city: 'თბილისი',
        street: 'ილია ჭავჭავაძის გამზირი 12',
        formattedAddress: '12 ილია ჭავჭავაძის გამზირი, თბილისი, საქართველო',
      }),
    );
    await TestBed.configureTestingModule({
      imports: [CheckoutPage],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () =>
              of({
                enabled: true,
                hostedEnabled: true,
                googlePayExternalEnabled: false,
                applePayExternalEnabled: false,
                googlePayEnvironment: 'TEST',
              }),
            post,
          },
        },
        {
          provide: CartService,
          useValue: { items: items.asReadonly(), itemCount: signal(1).asReadonly() },
        },
        {
          provide: CartQuoteService,
          useValue: {
            quote: () => of({ items: [], total: 275, currency: 'GEL', allAvailable: true }),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CheckoutPage);
    const component = fixture.componentInstance as unknown as {
      details: {
        deliveryMethod: string;
        city: string;
        street: string;
        addressDetails: string;
        deliveryNote: string;
      };
      customerDetails(): Record<string, string | undefined>;
    };
    component.details.deliveryMethod = 'delivery';
    component.details.addressDetails = 'ბინა 8, სართული 4';
    component.details.deliveryNote = 'დარეკეთ წინასწარ';
    fixture.detectChanges();

    expect(getCurrentPosition).not.toHaveBeenCalled();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.location-button')
      ?.click();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    locateSuccess?.({
      coords: { latitude: 41.715138, longitude: 44.827095 },
      timestamp: 0,
    } as GeolocationPosition);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/checkout/location/reverse-geocode'),
        { latitude: 41.715138, longitude: 44.827095 },
      );
      expect(component.details.city).toBe('თბილისი');
      expect(component.details.street).toBe('ილია ჭავჭავაძის გამზირი 12');
    });

    const payload = component.customerDetails();
    expect(payload['address']).toBe(
      'თბილისი, ილია ჭავჭავაძის გამზირი 12; ბინა 8, სართული 4; შენიშვნა: დარეკეთ წინასწარ; კოორდინატები: 41.715138, 44.827095',
    );
    expect(payload['city']).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('GPS პინი დაფიქსირდა');
  });
});
