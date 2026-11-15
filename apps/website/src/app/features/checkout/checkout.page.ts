import { CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';
import { CartQuote, CartQuoteService } from '@core/services/cart-quote.service';
import { CartService } from '@core/services/cart.service';
import { environment } from '../../../environments/environment';
import { WalletCheckoutConfig, WalletPaymentService } from './wallet-payment.service';

type CheckoutQuoteState =
  { kind: 'loading' } | { kind: 'ready'; quote: CartQuote } | { kind: 'error' };

type WalletAction =
  | { kind: 'processing' | 'completed'; orderPublicToken: string }
  | { kind: 'redirect'; orderPublicToken: string; redirectUrl: string };

type LocationState = 'idle' | 'loading' | 'success' | 'partial' | 'error';

interface ReverseGeocodeResponse {
  city: string;
  street: string;
  formattedAddress: string;
}

@Component({
  selector: 'app-checkout-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, FormsModule, RouterLink],
  template: `
    <main class="checkout-shell">
      <header class="page-header">
        <a class="back-link" routerLink="/cart">← კალათაში დაბრუნება</a>
        <p class="eyebrow">უსაფრთხო შეკვეთა</p>
        <h1>შეკვეთის გაფორმება</h1>
        <p class="page-header__copy">შეავსეთ მიღების ინფორმაცია და გადადით BOG-ის დაცულ გვერდზე.</p>
        <ol class="progress" aria-label="შეკვეთის ეტაპები">
          <li class="progress__done"><span>✓</span>კალათა</li>
          <li class="progress__current" aria-current="step"><span>2</span>მონაცემები</li>
          <li><span>3</span>გადახდა</li>
        </ol>
      </header>

      <form #form="ngForm" (ngSubmit)="submit(form)" novalidate>
        <div class="form-column">
          <fieldset class="card" [disabled]="busy() || locked()">
            <legend><span class="section-number">1</span> მიღების მეთოდი</legend>
            <div class="method-picker">
              <label [class.method-picker__active]="details.deliveryMethod === 'pickup'">
                <input
                  type="radio"
                  name="method"
                  value="pickup"
                  [(ngModel)]="details.deliveryMethod"
                />
                <span
                  ><strong>ადგილზე წაღება</strong><small>აიღეთ შეკვეთა ჩვენს ფილიალში</small></span
                >
              </label>
              <label [class.method-picker__active]="details.deliveryMethod === 'delivery'">
                <input
                  type="radio"
                  name="method"
                  value="delivery"
                  [(ngModel)]="details.deliveryMethod"
                />
                <span
                  ><strong>მისამართზე მიტანა</strong
                  ><small>დროსა და ღირებულებას ოპერატორი დაგიდასტურებთ</small></span
                >
              </label>
            </div>
          </fieldset>

          <fieldset class="card" [disabled]="busy() || locked()">
            <legend><span class="section-number">2</span> საკონტაქტო ინფორმაცია</legend>
            <div class="field-grid">
              <label class="field"
                >სახელი <span aria-hidden="true">*</span>
                <input
                  #firstName="ngModel"
                  name="firstName"
                  autocomplete="given-name"
                  required
                  maxlength="80"
                  placeholder="მაგ. ნინო"
                  [(ngModel)]="details.firstName"
                />
                @if (firstName.invalid && firstName.touched) {
                  <small class="field-error">მიუთითეთ სახელი.</small>
                }
              </label>
              <label class="field"
                >გვარი <span aria-hidden="true">*</span>
                <input
                  #lastName="ngModel"
                  name="lastName"
                  autocomplete="family-name"
                  required
                  maxlength="80"
                  placeholder="მაგ. გიორგაძე"
                  [(ngModel)]="details.lastName"
                />
                @if (lastName.invalid && lastName.touched) {
                  <small class="field-error">მიუთითეთ გვარი.</small>
                }
              </label>
              <label class="field"
                >ელფოსტა <span aria-hidden="true">*</span>
                <input
                  #email="ngModel"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  maxlength="254"
                  placeholder="name@example.com"
                  [(ngModel)]="details.email"
                />
                @if (email.invalid && email.touched) {
                  <small class="field-error">შეიყვანეთ სწორი ელფოსტა.</small>
                }
              </label>
              <label class="field"
                >ტელეფონი <span aria-hidden="true">*</span>
                <input
                  #phone="ngModel"
                  name="phone"
                  type="tel"
                  inputmode="tel"
                  autocomplete="tel"
                  required
                  pattern="[+0-9 ()-]{9,20}"
                  placeholder="+995 5XX XX XX XX"
                  [(ngModel)]="details.phone"
                />
                @if (phone.invalid && phone.touched) {
                  <small class="field-error">შეიყვანეთ სწორი ტელეფონის ნომერი.</small>
                }
              </label>
            </div>
          </fieldset>

          @if (details.deliveryMethod === 'delivery') {
            <fieldset class="card" [disabled]="busy() || locked()">
              <legend><span class="section-number">3</span> მიტანის მისამართი</legend>
              <div class="location-box">
                <div>
                  <strong>მდებარეობის გაზიარება</strong
                  ><small
                    >გვეხმარება კურიერმა ზუსტად მოგაგნოთ. მისამართის შევსება მაინც შეგიძლიათ
                    ხელით.</small
                  >
                </div>
                <button
                  type="button"
                  class="location-button"
                  [disabled]="locationState() === 'loading'"
                  (click)="locate()"
                >
                  @if (locationState() === 'loading') {
                    <span class="spinner" aria-hidden="true"></span> დადგენა…
                  } @else {
                    <span aria-hidden="true">⌖</span> მდებარეობის დადგენა
                  }
                </button>
                @if (locationState() === 'success') {
                  <p class="location-status location-status--success" role="status">
                    ✓ GPS პინი დაფიქსირდა ({{ locationLabel() }}). ქალაქი და ქუჩა ავტომატურად შეივსო
                    — გადაამოწმეთ სიზუსტე.
                  </p>
                } @else if (locationState() === 'partial') {
                  <p class="location-status location-status--partial" role="status">
                    GPS პინი დაფიქსირდა ({{ locationLabel() }}), მაგრამ მისამართი ავტომატურად ვერ
                    მოიძებნა. შეავსეთ ქალაქი და ქუჩა ხელით.
                  </p>
                } @else if (locationState() === 'error') {
                  <p class="location-status location-status--error" role="alert">
                    მდებარეობა ვერ განისაზღვრა. შეავსეთ მისამართი ხელით.
                  </p>
                }
              </div>
              <div class="field-grid">
                <label class="field"
                  >ქალაქი / მუნიციპალიტეტი <span aria-hidden="true">*</span>
                  <input
                    #city="ngModel"
                    name="city"
                    autocomplete="address-level2"
                    required
                    maxlength="100"
                    placeholder="მაგ. თბილისი"
                    [(ngModel)]="details.city"
                  />
                  @if (city.invalid && city.touched) {
                    <small class="field-error">მიუთითეთ ქალაქი ან მუნიციპალიტეტი.</small>
                  }
                </label>
                <label class="field"
                  >ქუჩა და მისამართი <span aria-hidden="true">*</span>
                  <input
                    #street="ngModel"
                    name="street"
                    autocomplete="street-address"
                    required
                    minlength="2"
                    maxlength="200"
                    placeholder="მაგ. ჭავჭავაძის გამზ. 12"
                    [(ngModel)]="details.street"
                  />
                  @if (street.invalid && street.touched) {
                    <small class="field-error">მიუთითეთ ქუჩა და სახლის ნომერი.</small>
                  }
                </label>
                <label class="field field--wide"
                  >ბინა, სადარბაზო, სართული <small>(არასავალდებულო)</small>
                  <input
                    name="addressDetails"
                    maxlength="100"
                    placeholder="მაგ. ბინა 8, სადარბაზო 2, სართული 4"
                    [(ngModel)]="details.addressDetails"
                  />
                </label>
                <label class="field field--wide"
                  >შენიშვნა კურიერისთვის <small>(არასავალდებულო)</small>
                  <textarea
                    name="deliveryNote"
                    maxlength="150"
                    rows="3"
                    placeholder="მაგ. დარეკეთ 10 წუთით ადრე"
                    [(ngModel)]="details.deliveryNote"
                  ></textarea>
                </label>
              </div>
            </fieldset>
          }

          <section class="card payment-panel" aria-labelledby="payment-title">
            <div class="payment-panel__heading">
              <span class="section-number">{{
                details.deliveryMethod === 'delivery' ? 4 : 3
              }}</span>
              <div>
                <h2 id="payment-title">გადახდა</h2>
              </div>
            </div>
            <label class="consent">
              <input type="checkbox" name="consent" required [(ngModel)]="consent" />
              <span
                >ვეთანხმები <a routerLink="/terms" target="_blank" rel="noopener">წესებს</a>,
                <a routerLink="/delivery-returns" target="_blank" rel="noopener"
                  >მიწოდებისა და დაბრუნების პოლიტიკას</a
                >
                და
                <a routerLink="/privacy" target="_blank" rel="noopener"
                  >კონფიდენციალურობის პოლიტიკას</a
                >.</span
              >
            </label>
            @if (error()) {
              <p class="payment-error" role="alert">{{ error() }}</p>
            }
            @if (details.deliveryMethod === 'delivery') {
              <p class="delivery-cost-note">
                მიტანის საფასური პროდუქტის ფასში არ შედის — საბოლოო ღირებულებას ოპერატორი წინასწარ
                დაგიდასტურებთ.
              </p>
            }
            <div class="payment-methods" aria-label="აირჩიეთ გადახდის მეთოდი">
              <button
                class="payment-button payment-button--bank"
                type="submit"
                [disabled]="busy() || !checkoutReady()"
              >
                <span class="payment-button__chip" aria-hidden="true"></span>
                <span>ბარათით გადახდა</span>
                @if (currentQuote(); as quote) {
                  <strong>{{
                    quote.total | currency: quote.currency ?? 'GEL' : 'symbol' : '1.0-0'
                  }}</strong>
                }
              </button>
              <div class="payment-methods__wallets">
                <button
                  class="wallet-button wallet-button--google"
                  type="button"
                  [disabled]="
                    busy() ||
                    !checkoutReady() ||
                    (walletConfig().googlePayExternalEnabled && !googlePayReady())
                  "
                  (click)="
                    walletConfig().googlePayExternalEnabled ? payWithGoogle(form) : submit(form)
                  "
                >
                  <span>Google Pay</span>
                  @if (currentQuote(); as quote) {
                    <strong>{{
                      quote.total | currency: quote.currency ?? 'GEL' : 'symbol' : '1.0-0'
                    }}</strong>
                  }
                </button>
                <button
                  type="button"
                  class="wallet-button wallet-button--apple"
                  [disabled]="busy() || !checkoutReady()"
                  (click)="
                    walletConfig().applePayExternalEnabled && wallet.supportsApplePay()
                      ? payWithApple(form)
                      : submit(form)
                  "
                >
                  <span>Apple Pay</span>
                  @if (currentQuote(); as quote) {
                    <strong>{{
                      quote.total | currency: quote.currency ?? 'GEL' : 'symbol' : '1.0-0'
                    }}</strong>
                  }
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside class="summary" aria-live="polite" aria-label="შეკვეთის შეჯამება">
          <p class="eyebrow">თქვენი შეკვეთა</p>
          <h2>შეჯამება</h2>
          @if (currentQuote(); as quote) {
            @if (quote.items.length) {
              <ul class="summary__items">
                @for (item of quote.items; track item.productId) {
                  <li>
                    <span>
                      <strong>{{ item.name || item.code || 'პროდუქტი' }}</strong>
                      <small>{{ item.quantity }} ცალი</small>
                    </span>
                    <strong>
                      @if (item.lineTotal !== null) {
                        {{
                          item.lineTotal
                            | currency
                              : item.currency ?? quote.currency ?? 'GEL'
                              : 'symbol'
                              : '1.0-0'
                        }}
                      } @else {
                        —
                      }
                    </strong>
                  </li>
                }
              </ul>
            }
            <div class="summary__row">
              <span>პროდუქტები</span><strong>{{ itemCount() }} ცალი</strong>
            </div>
            <div class="summary__row">
              <span>მიღება</span
              ><strong>{{
                details.deliveryMethod === 'delivery' ? 'მიტანა' : 'ადგილზე წაღება'
              }}</strong>
            </div>
            @if (details.deliveryMethod === 'delivery') {
              <div class="summary__row">
                <span>მიტანის საფასური</span><strong>დასადასტურებელია</strong>
              </div>
            }
            <div class="summary__total">
              <span>{{
                details.deliveryMethod === 'delivery' ? 'პროდუქტების გადასახდელი' : 'გადასახდელი'
              }}</span
              ><strong>{{
                quote.total | currency: quote.currency ?? 'GEL' : 'symbol' : '1.0-0'
              }}</strong>
            </div>
            @if (!quote.allAvailable) {
              <p class="summary__error" role="alert">
                კალათაში არსებული ერთ-ერთი პროდუქტი აღარ არის ხელმისაწვდომი. დაბრუნდით კალათაში.
              </p>
            }
          } @else if (quoteState().kind === 'loading') {
            <p class="summary__loading">ფასი და ხელმისაწვდომობა მოწმდება…</p>
          } @else {
            <p class="summary__error" role="alert">
              საბოლოო თანხა ვერ გადავამოწმეთ. გადახდამდე სცადეთ თავიდან.
            </p>
          }
          <div class="trust-list">
            <span>✓ დაცული გადახდა</span><span>✓ მონაცემების უსაფრთხო დამუშავება</span>
          </div>
        </aside>
      </form>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      background: #f5f7f8;
      min-height: 100vh;
      color: var(--text-primary);
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    .checkout-shell {
      width: min(1180px, 100%);
      margin: 0 auto;
      padding: 44px 24px 72px;
      overflow: clip;
    }
    .page-header {
      max-width: 760px;
      margin-bottom: 32px;
    }
    .back-link {
      display: inline-block;
      margin-bottom: 28px;
      color: #52606d;
      font-size: 14px;
      text-decoration: none;
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--brand-navy-800);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      color: #102a43;
      font-size: clamp(30px, 5vw, 46px);
      line-height: 1.12;
      letter-spacing: -0.035em;
    }
    .page-header__copy {
      margin: 12px 0 22px;
      color: #52606d;
      font-size: 16px;
    }
    .progress {
      display: flex;
      width: min(520px, 100%);
      margin: 0;
      padding: 0;
      list-style: none;
      color: #8292a3;
      font-size: 13px;
      font-weight: 700;
    }
    .progress li {
      position: relative;
      display: flex;
      flex: 1;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .progress li:not(:last-child)::after {
      content: '';
      height: 2px;
      flex: 1;
      margin: 0 9px;
      background: #d9e2ec;
    }
    .progress li span {
      display: grid;
      flex: 0 0 28px;
      width: 28px;
      height: 28px;
      place-items: center;
      border: 2px solid #bcccdc;
      border-radius: 50%;
      background: #fff;
    }
    .progress__done {
      color: var(--color-success) !important;
    }
    .progress__current {
      color: var(--brand-red-600) !important;
    }
    .progress__done span {
      border-color: var(--color-success) !important;
      background: #eaf7f0 !important;
    }
    .progress__current span {
      border-color: var(--brand-red-500) !important;
      background: #fff0f1 !important;
    }
    .progress__done::after {
      background: var(--color-success) !important;
    }
    form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      align-items: start;
      gap: 28px;
    }
    .form-column {
      display: grid;
      min-width: 0;
      gap: 18px;
    }
    fieldset {
      min-width: 0;
      margin: 0;
    }
    .card {
      border: 1px solid #d9e2ec;
      border-radius: 18px;
      padding: 24px;
      background: #fff;
      box-shadow: 0 2px 4px rgb(16 42 67 / 3%);
    }
    legend {
      padding: 0 6px 0 0;
      color: #102a43;
      font-size: 18px;
      font-weight: 800;
    }
    .section-number {
      display: inline-grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border-radius: 9px;
      background: #eaf1fb;
      color: var(--brand-navy-800);
      font-size: 14px;
      font-weight: 800;
    }
    .method-picker {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 10px;
    }
    .method-picker label {
      display: flex;
      min-width: 0;
      align-items: flex-start;
      gap: 11px;
      padding: 16px;
      border: 1.5px solid #d9e2ec;
      border-radius: 13px;
      cursor: pointer;
    }
    .method-picker__active {
      border-color: var(--brand-navy-800) !important;
      background: #f3f7fc;
      box-shadow: 0 0 0 1px var(--brand-navy-800);
    }
    .method-picker input {
      margin-top: 3px;
      accent-color: var(--brand-navy-800);
    }
    .method-picker span {
      display: grid;
      min-width: 0;
      gap: 4px;
    }
    .method-picker strong {
      color: #243b53;
    }
    .method-picker small {
      color: #627d98;
      line-height: 1.45;
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px 16px;
      margin-top: 14px;
    }
    .field {
      display: block;
      min-width: 0;
      color: #243b53;
      font-size: 14px;
      font-weight: 700;
    }
    .field > span {
      color: #c43d3d;
    }
    .field > small:not(.field-error) {
      color: #8292a3;
      font-weight: 500;
    }
    .field--wide {
      grid-column: 1 / -1;
    }
    input:not([type='radio']):not([type='checkbox']),
    textarea {
      display: block;
      width: 100%;
      max-width: 100%;
      margin-top: 7px;
      padding: 12px 13px;
      border: 1px solid #bcccdc;
      border-radius: 10px;
      background: #fff;
      color: #102a43;
      font: inherit;
      font-weight: 500;
      transition:
        border-color 140ms,
        box-shadow 140ms;
    }
    input:not([type='radio']):not([type='checkbox']) {
      min-height: 46px;
    }
    textarea {
      resize: vertical;
    }
    input:focus,
    textarea:focus {
      border-color: var(--color-focus) !important;
      outline: 0;
      box-shadow: 0 0 0 3px rgb(31 99 197 / 14%);
    }
    input.ng-invalid.ng-touched,
    textarea.ng-invalid.ng-touched {
      border-color: #c43d3d;
    }
    .field-error {
      display: block;
      margin-top: 6px;
      color: #b42318;
      font-size: 12px;
      font-weight: 600;
    }
    .field-help {
      display: block;
      margin-top: 6px;
      color: #627d98;
      font-size: 12px;
      font-weight: 500;
    }
    .location-box {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 7px 18px;
      align-items: center;
      margin-top: 12px;
      margin-bottom: 20px;
      padding: 15px;
      border-radius: 12px;
      background: #f0f5f8;
    }
    .location-box > div {
      display: grid;
      gap: 3px;
    }
    .location-box strong {
      color: #243b53;
      font-size: 14px;
    }
    .location-box small {
      color: #627d98;
      line-height: 1.4;
    }
    .location-button {
      min-height: 40px;
      padding: 9px 13px;
      border: 1px solid #91a7b8;
      border-radius: 9px;
      background: #fff;
      color: #243b53;
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .location-button:hover:not(:disabled) {
      border-color: var(--brand-navy-800);
      color: var(--brand-navy-800);
    }
    .location-status {
      grid-column: 1 / -1;
      margin: 4px 0 0;
      font-size: 12px;
      font-weight: 700;
    }
    .location-status--success {
      color: var(--color-success);
    }
    .location-status--error {
      color: #b42318;
    }
    .location-status--partial {
      color: #8a5200;
    }
    .spinner {
      display: inline-block;
      width: 13px;
      height: 13px;
      vertical-align: -2px;
      border: 2px solid #bcccdc;
      border-top-color: var(--brand-navy-800);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .payment-panel {
      display: grid;
      gap: 16px;
    }
    .payment-panel__heading {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .payment-panel__heading h2 {
      margin: 2px 0 3px;
      color: #102a43;
      font-size: 18px;
    }
    .consent {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      color: #52606d;
      font-size: 13px;
      line-height: 1.55;
    }
    .consent input {
      flex: 0 0 auto;
      width: 17px;
      height: 17px;
      margin-top: 2px;
      accent-color: var(--brand-navy-800);
    }
    .payment-methods {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
    }
    .payment-methods__wallets {
      display: grid;
      gap: 8px;
    }
    a {
      color: var(--brand-navy-800);
      text-underline-offset: 2px;
    }
    .payment-button {
      width: 100%;
      min-width: 0;
      height: 100%;
      min-height: 96px;
      padding: 14px;
      border: 1px solid #bdcbd9;
      border-radius: 11px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      gap: 7px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .payment-button--bank {
      align-items: flex-start;
      background: #173a59;
      color: #fff;
      box-shadow: 0 3px 8px rgb(16 42 67 / 12%);
    }
    .payment-button--bank:hover:not(:disabled) {
      background: #204b70;
    }
    .payment-button:disabled,
    .wallet-button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }
    .payment-button__chip {
      width: 23px;
      height: 16px;
      border: 1px solid rgb(255 255 255 / 65%);
      border-radius: 4px;
      background: linear-gradient(135deg, #d9c89b, #f7e7b7);
    }
    .payment-button strong {
      font-size: 14px;
      font-weight: 700;
    }
    .wallet-button {
      width: 100%;
      min-width: 0;
      min-height: 44px;
      padding: 8px 11px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.16s ease;
    }
    .wallet-button:hover:not(:disabled) {
      background: #f3f6f9;
    }
    .wallet-button--google {
      border: 1px solid #cbd5df;
      background: #fff;
      color: #202124;
    }
    .wallet-button--apple {
      border: 1px solid #000;
      background: #000;
      color: #fff;
    }
    .wallet-button--apple:hover:not(:disabled) {
      background: #222;
    }
    .payment-error,
    .summary__error {
      margin: 0;
      padding: 11px 13px;
      border-radius: 9px;
      background: #fff0ef;
      color: #b42318;
      font-size: 13px;
      line-height: 1.5;
    }
    .delivery-cost-note {
      margin: 0;
      padding: 10px 12px;
      border-left: 3px solid #f59e0b;
      background: #fffbeb;
      color: #7c4a03;
      font-size: 13px;
      line-height: 1.55;
    }
    .summary {
      position: sticky;
      top: 24px;
      display: grid;
      min-width: 0;
      gap: 14px;
      padding: 24px;
      border: 1px solid #d9e2ec;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 12px 30px rgb(16 42 67 / 7%);
    }
    .summary h2 {
      margin: -4px 0 7px;
      color: #102a43;
      font-size: 24px;
    }
    .summary__row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      color: #627d98;
      font-size: 14px;
    }
    .summary__items {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0 0 15px;
      border-bottom: 1px solid #edf1f4;
      list-style: none;
    }
    .summary__items li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: #243b53;
      font-size: 13px;
    }
    .summary__items li > span {
      display: grid;
      min-width: 0;
      gap: 3px;
    }
    .summary__items li > span strong {
      overflow-wrap: anywhere;
    }
    .summary__items small {
      color: #8292a3;
    }
    .summary__row strong {
      color: #334e68;
      text-align: right;
    }
    .summary__total {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 14px;
      margin-top: 4px;
      padding-top: 18px;
      border-top: 1px solid #d9e2ec;
      color: #243b53;
      font-weight: 700;
    }
    .summary__total strong {
      color: #102a43;
      font-size: 26px;
      line-height: 1;
    }
    .summary__loading {
      color: #627d98;
    }
    .trust-list {
      display: grid;
      gap: 7px;
      padding-top: 15px;
      border-top: 1px solid #edf1f4;
      color: #52606d;
      font-size: 12px;
    }
    .trust-list span::first-letter {
      color: var(--color-success);
    }
    @media (max-width: 860px) {
      .checkout-shell {
        padding-top: 28px;
      }
      form {
        grid-template-columns: minmax(0, 1fr);
      }
      .summary {
        position: static;
        grid-row: 1;
      }
    }
    @media (max-width: 560px) {
      .checkout-shell {
        padding: 22px 14px 48px;
      }
      .back-link {
        margin-bottom: 20px;
      }
      .progress li {
        font-size: 11px;
      }
      .progress li:not(:last-child)::after {
        margin: 0 5px;
      }
      .card,
      .summary {
        padding: 18px 15px;
        border-radius: 14px;
      }
      .method-picker,
      .field-grid {
        grid-template-columns: minmax(0, 1fr);
      }
      .field--wide {
        grid-column: auto;
      }
      .location-box {
        grid-template-columns: minmax(0, 1fr);
      }
      .location-button {
        width: 100%;
      }
      .location-status {
        grid-column: auto;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner {
        animation: none;
      }
    }
  `,
})
export class CheckoutPage {
  private readonly http = inject(HttpClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cart = inject(CartService);
  private readonly quotes = inject(CartQuoteService);
  protected readonly wallet = inject(WalletPaymentService);
  protected readonly googlePayReady = signal(false);
  protected readonly walletConfig = toSignal(
    this.http.get<WalletCheckoutConfig>(`${environment.apiBaseUrl}/checkout/config`).pipe(
      catchError(() =>
        of<WalletCheckoutConfig>({
          enabled: false,
          hostedEnabled: false,
          googlePayExternalEnabled: false,
          applePayExternalEnabled: false,
          googlePayEnvironment: 'TEST',
        }),
      ),
    ),
    {
      initialValue: {
        enabled: false,
        hostedEnabled: false,
        googlePayExternalEnabled: false,
        applePayExternalEnabled: false,
        googlePayEnvironment: 'TEST',
      } as WalletCheckoutConfig,
    },
  );
  private readonly prepareGooglePay = effect(() => {
    const config = this.walletConfig();
    if (typeof window === 'undefined' || !config.googlePayExternalEnabled) {
      this.googlePayReady.set(false);
      return;
    }
    void this.wallet
      .prepareGooglePay(config)
      .then((ready) => this.googlePayReady.set(ready))
      .catch(() => this.googlePayReady.set(false));
  });
  protected readonly itemCount = this.cart.itemCount;
  private readonly quoteRequest = computed(() =>
    JSON.stringify(
      this.cart.items().map((item) => ({ productId: item.tireId, quantity: item.quantity })),
    ),
  );
  protected readonly quoteState = toSignal(
    toObservable(this.quoteRequest).pipe(
      switchMap((request) => {
        const items = JSON.parse(request) as { productId: string; quantity: number }[];
        if (items.length === 0) return of<CheckoutQuoteState>({ kind: 'error' });
        return this.quotes.quote(items).pipe(
          map((quote): CheckoutQuoteState => ({ kind: 'ready', quote })),
          catchError(() => of<CheckoutQuoteState>({ kind: 'error' })),
          startWith<CheckoutQuoteState>({ kind: 'loading' }),
        );
      }),
    ),
    { initialValue: { kind: 'loading' } as CheckoutQuoteState },
  );
  protected readonly currentQuote = computed(() => {
    const state = this.quoteState();
    return state.kind === 'ready' ? state.quote : null;
  });
  protected readonly checkoutReady = computed(() => {
    const quote = this.currentQuote();
    return quote?.allAvailable === true && quote.total > 0;
  });
  protected readonly busy = signal(false);
  protected readonly locked = signal(false);
  protected readonly error = signal('');
  protected readonly locationState = signal<LocationState>('idle');
  protected readonly locationLabel = signal('');
  protected consent = false;
  protected details = {
    deliveryMethod: 'pickup',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    street: '',
    addressDetails: '',
    deliveryNote: '',
  };
  private coordinates: { latitude: number; longitude: number } | null = null;
  // In memory only: never persist personal data in browser storage.
  private request?: Record<string, unknown>;

  protected locate(): void {
    if (this.locationState() === 'loading') return;
    this.locationState.set('loading');
    this.locationLabel.set('');
    this.coordinates = null;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.locationState.set('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        this.coordinates = { latitude: coords.latitude, longitude: coords.longitude };
        this.locationLabel.set(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
        void this.fillAddressFromCoordinates(coords.latitude, coords.longitude);
      },
      () => {
        this.coordinates = null;
        this.locationLabel.set('');
        this.locationState.set('error');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  private async fillAddressFromCoordinates(latitude: number, longitude: number): Promise<void> {
    try {
      const address = await firstValueFrom(
        this.http.post<ReverseGeocodeResponse>(
          `${environment.apiBaseUrl}/checkout/location/reverse-geocode`,
          { latitude, longitude },
        ),
      );
      if (address.city) this.details.city = address.city;
      if (address.street) this.details.street = address.street;
      this.locationState.set(address.city && address.street ? 'success' : 'partial');
    } catch {
      this.locationState.set('partial');
    }
  }

  protected async submit(form: NgForm) {
    if (this.busy()) return;
    if (!this.locked() && (form.invalid || !this.checkoutReady())) {
      this.reportInvalid(form);
      return;
    }
    if (!this.request) {
      const items = this.cart.items().map((i) => ({ productId: i.tireId, quantity: i.quantity }));
      if (items.length < 1) {
        this.error.set('კალათა ცარიელია.');
        return;
      }
      // Persist only the retry key, never customer fields, across a refresh.
      let idempotencyKey = crypto.randomUUID();
      try {
        const existing = sessionStorage.getItem('tyre.checkout.retry');
        if (existing && /^[0-9a-f-]{36}$/i.test(existing))
          idempotencyKey = existing as typeof idempotencyKey;
        sessionStorage.setItem('tyre.checkout.retry', idempotencyKey);
      } catch {
        /* In-memory retries remain available when storage is blocked. */
      }
      this.request = {
        ...this.customerDetails(),
        items,
        idempotencyKey,
      };
      this.locked.set(true);
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(
        this.http.post<{ orderPublicToken: string; redirectUrl: string }>(
          `${environment.apiBaseUrl}/checkout/orders`,
          this.request,
        ),
      );
      const redirect = new URL(result.redirectUrl);
      if (redirect.origin !== 'https://payment.bog.ge') throw new Error('Invalid bank URL');
      try {
        // This lets the return page clear only the cart that created this order.
        sessionStorage.setItem('tyre.checkout.pending', result.orderPublicToken);
      } catch {
        /* Checkout still works when storage is blocked. */
      }
      window.location.assign(redirect.href);
    } catch {
      this.error.set('ბანკზე გადასვლა ვერ დადასტურდა. შეგიძლიათ იგივე მოთხოვნა გაიმეოროთ.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async payWithGoogle(form: NgForm): Promise<void> {
    if (!this.canStartWallet(form)) return;
    const quote = this.currentQuote()!;
    this.busy.set(true);
    this.error.set('');
    try {
      const token = await this.wallet.googlePayToken(
        this.walletConfig(),
        quote.total,
        quote.currency ?? 'GEL',
      );
      const result = await firstValueFrom(
        this.http.post<WalletAction>(
          `${environment.apiBaseUrl}/checkout/wallets/google-pay/orders`,
          {
            ...this.checkoutRequest('google-pay'),
            googlePayToken: token,
          },
        ),
      );
      this.continueWallet(result);
    } catch {
      this.error.set('Google Pay გადახდა ვერ დაიწყო. შეგიძლიათ ბანკის დაცული გვერდი გამოიყენოთ.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async payWithApple(form: NgForm): Promise<void> {
    if (!this.canStartWallet(form)) return;
    const quote = this.currentQuote()!;
    const request = this.checkoutRequest('apple-pay');
    let orderPublicToken = '';
    this.busy.set(true);
    this.error.set('');
    try {
      await this.wallet.beginApplePay(
        quote.total,
        quote.currency ?? 'GEL',
        async () => {
          const result = await firstValueFrom(
            this.http.post<{
              kind: 'apple_pay_session';
              orderPublicToken: string;
              sessionJson: string;
            }>(`${environment.apiBaseUrl}/checkout/wallets/apple-pay/orders`, request),
          );
          orderPublicToken = result.orderPublicToken;
          this.rememberPending(orderPublicToken);
          return JSON.parse(result.sessionJson) as unknown;
        },
        async (applePayToken) => {
          if (!orderPublicToken) throw new Error('Apple Pay session unavailable');
          const result = await firstValueFrom(
            this.http.post<WalletAction>(
              `${environment.apiBaseUrl}/checkout/wallets/apple-pay/orders/${encodeURIComponent(orderPublicToken)}/complete`,
              { applePayToken },
            ),
          );
          this.continueWallet(result);
        },
      );
    } catch {
      this.error.set('Apple Pay გადახდა ვერ დაიწყო. შეგიძლიათ ბანკის დაცული გვერდი გამოიყენოთ.');
    } finally {
      this.busy.set(false);
    }
  }

  private canStartWallet(form: NgForm): boolean {
    if (this.busy() || this.locked() || form.invalid || !this.checkoutReady()) {
      this.reportInvalid(form);
      return false;
    }
    return true;
  }

  private checkoutRequest(channel: 'google-pay' | 'apple-pay'): Record<string, unknown> {
    const items = this.cart.items().map((item) => ({
      productId: item.tireId,
      quantity: item.quantity,
    }));
    const storageKey = `tyre.checkout.retry.${channel}`;
    let idempotencyKey: string = crypto.randomUUID();
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (existing && /^[0-9a-f-]{36}$/i.test(existing)) idempotencyKey = existing;
      sessionStorage.setItem(storageKey, idempotencyKey);
    } catch {
      /* In-memory request still remains safe for the active wallet session. */
    }
    return {
      ...this.customerDetails(),
      items,
      idempotencyKey,
    };
  }

  private customerDetails(): Record<string, string | undefined> {
    const { deliveryMethod, firstName, lastName, email, phone } = this.details;
    return {
      deliveryMethod,
      firstName,
      lastName,
      email,
      phone,
      address: deliveryMethod === 'delivery' ? this.composedAddress() : undefined,
    };
  }

  private reportInvalid(form: NgForm): void {
    form.control.markAllAsTouched();
    this.error.set(
      this.checkoutReady()
        ? 'გადაამოწმეთ მონიშნული ველები და შეავსეთ სავალდებულო ინფორმაცია.'
        : 'შეკვეთის თანხა ან ხელმისაწვდომობა ჯერ ვერ დადასტურდა.',
    );
    queueMicrotask(() =>
      this.host.nativeElement.querySelector<HTMLElement>('form .ng-invalid:not(form)')?.focus(),
    );
  }

  private composedAddress(): string {
    const parts = [`${this.details.city.trim()}, ${this.details.street.trim()}`];
    if (this.details.addressDetails.trim()) parts.push(this.details.addressDetails.trim());
    if (this.details.deliveryNote.trim())
      parts.push(`შენიშვნა: ${this.details.deliveryNote.trim()}`);
    if (this.coordinates) {
      parts.push(
        `კოორდინატები: ${this.coordinates.latitude.toFixed(6)}, ${this.coordinates.longitude.toFixed(6)}`,
      );
    }
    return parts.join('; ').slice(0, 500);
  }

  private continueWallet(result: WalletAction): void {
    this.rememberPending(result.orderPublicToken);
    if (result.kind === 'redirect') {
      const redirect = new URL(result.redirectUrl);
      if (redirect.origin !== 'https://payment.bog.ge') throw new Error('Invalid bank URL');
      window.location.assign(redirect.href);
      return;
    }
    window.location.assign(`/checkout/order?order=${encodeURIComponent(result.orderPublicToken)}`);
  }

  private rememberPending(orderPublicToken: string): void {
    try {
      sessionStorage.setItem('tyre.checkout.pending', orderPublicToken);
    } catch {
      /* Payment remains valid when browser storage is blocked. */
    }
  }
}
