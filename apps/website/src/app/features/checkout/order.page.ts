import { HttpClient } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DomSanitizer, Meta, SafeResourceUrl } from '@angular/platform-browser';
import { SeoService } from '@core/services/seo.service';
import { CartService } from '@core/services/cart.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-order-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `<section class="page">
    <h1>
      {{
        status() === 'paid'
          ? 'გადახდა დადასტურებულია'
          : status() === 'failed'
            ? 'გადახდა ვერ შესრულდა'
            : 'გადახდის სტატუსი'
      }}
    </h1>
    @if (status() === 'paid') {
      <p role="status" aria-live="polite">
        ბანკმა დაადასტურა {{ total() }} {{ currency() }}-ის გადახდა. შეკვეთა
        <strong>№ {{ orderNumber() }}</strong> შენახულია.
      </p>
      @if (receiptStatus() === 'delivered') {
        <p class="notice notice--success">ქვითარი თქვენს ელფოსტაზეც გაიგზავნა.</p>
      } @else {
        <p class="notice">ელფოსტით ქვითარი მზადდება. PDF-ის მიღება ამ გვერდიდანაც შეგიძლიათ.</p>
      }
      @if (pdfUrl()) {
        <a [href]="pdfUrl()" [download]="orderNumber() + '.pdf'">PDF-ის ჩამოტვირთვა</a>
        <iframe
          [src]="pdfPreview()"
          title="შეკვეთის PDF"
          style="width:100%;height:600px;border:0"
        ></iframe>
      } @else {
        <p>PDF მზადდება. თუ ჯერ არ გამოჩნდა, განაახლეთ სტატუსი.</p>
      }
    } @else {
      <p role="status" aria-live="polite">{{ message() }}</p>
    }
    <button type="button" [disabled]="busy()" (click)="check()">სტატუსის განახლება</button>
    <a routerLink="/cart">← კალათაში დაბრუნება</a>
  </section>`,
  styles: `
    :host {
      display: block;
      min-height: 70vh;
      background: var(--season-canvas);
      color: var(--text-primary);
    }
    .page {
      max-width: 640px;
      margin: auto;
      padding: 32px 20px;
      display: grid;
      gap: 20px;
    }
    button {
      padding: 12px;
      font: inherit;
    }
    a {
      color: inherit;
    }
    .notice {
      padding: 12px;
      border-radius: 6px;
      background: var(--season-surface-soft);
    }
    .notice--success {
      color: var(--success);
    }
  `,
})
export class OrderPage {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cart = inject(CartService);
  protected readonly pdfUrl = signal('');
  protected readonly pdfPreview = signal<SafeResourceUrl | null>(null);
  protected readonly status = signal('unknown');
  protected readonly total = signal(0);
  protected readonly currency = signal('GEL');
  protected readonly orderNumber = signal('');
  protected readonly receiptStatus = signal('not_ready');
  protected readonly message = signal('გადახდა ჯერ არ დადასტურებულა. ვამოწმებთ ბანკის პასუხს.');
  protected readonly busy = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private checks = 0;
  private stopped = false;
  constructor() {
    inject(SeoService).setPage({ title: 'გადახდის სტატუსი', indexable: false });
    inject(Meta).updateTag({ name: 'referrer', content: 'no-referrer' });
    this.destroy.onDestroy(() => {
      this.stopped = true;
      clearTimeout(this.timer);
      if (this.pdfUrl()) URL.revokeObjectURL(this.pdfUrl());
    });
    afterNextRender(() => {
      void this.check();
    });
  }
  protected async check() {
    if (this.busy() || this.stopped) return;
    clearTimeout(this.timer);
    const token =
      this.route.snapshot.queryParamMap.get('order') ?? this.route.snapshot.paramMap.get('id');
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      this.message.set('შეკვეთის მისამართი არასწორია.');
      return;
    }
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.http.get<{
          status: string;
          total: number;
          currency: string;
          orderNumber: string;
          receiptStatus: string;
          pdfReady: boolean;
        }>(`${environment.apiBaseUrl}/checkout/orders/${encodeURIComponent(token)}`, {
          transferCache: false,
        }),
      );
      this.status.set(result.status);
      this.total.set(result.total);
      this.currency.set(result.currency);
      this.orderNumber.set(result.orderNumber);
      this.receiptStatus.set(result.receiptStatus);
      if (result.status === 'paid' || result.status === 'failed')
        this.finishPendingCheckout(token, result.status);
      if (!this.stopped && result.status === 'paid' && result.pdfReady && !this.pdfUrl()) {
        const pdf = await firstValueFrom(
          this.http.get(
            `${environment.apiBaseUrl}/checkout/orders/${encodeURIComponent(token)}/pdf`,
            { responseType: 'blob', transferCache: false },
          ),
        );
        if (!this.stopped && pdf.type === 'application/pdf') {
          const url = URL.createObjectURL(pdf);
          this.pdfUrl.set(url);
          // Only a locally-created blob from our paid-order PDF endpoint is trusted.
          this.pdfPreview.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        }
      }
      this.message.set(
        result.status === 'failed'
          ? 'ბანკმა გადახდა უარყო.'
          : 'ბანკის დადასტურებას ველოდებით. ხელახლა ნუ გადაიხდით, სანამ სტატუსი არ დაზუსტდება.',
      );
    } catch {
      this.message.set(
        'სტატუსი ვერ გადავამოწმეთ. ეს გადახდის წარუმატებლობას არ ნიშნავს — სცადეთ განახლება.',
      );
    } finally {
      this.busy.set(false);
    }
    if (!this.stopped && this.status() !== 'failed' && !this.pdfUrl() && ++this.checks < 24)
      this.timer = setTimeout(() => {
        void this.check();
      }, 5000);
  }

  private finishPendingCheckout(token: string, status: 'paid' | 'failed'): void {
    try {
      if (sessionStorage.getItem('tyre.checkout.pending') !== token) return;
      // A confirmed failure releases the retry key but keeps the cart for a new attempt.
      if (status === 'paid') this.cart.clear();
      sessionStorage.removeItem('tyre.checkout.pending');
      sessionStorage.removeItem('tyre.checkout.retry');
    } catch {
      /* Never block receipt access when storage is unavailable. */
    }
  }
}
