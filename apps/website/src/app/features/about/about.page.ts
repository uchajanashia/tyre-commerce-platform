import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from '@core/i18n/language.service';

@Component({
  selector: 'app-about-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="hero" aria-labelledby="about-title">
      <img
        class="hero__image"
        src="/main_hero.webp"
        alt=""
        width="2688"
        height="1536"
        fetchpriority="high"
      />
      <div class="hero__copy">
        <p class="eyebrow">{{ en() ? 'ABOUT US' : 'ჩვენ შესახებ' }}</p>
        <h1 id="about-title">tyre.ge</h1>
        <p class="hero__lead">
          {{
            en()
              ? 'Your next tyre starts with an informed choice.'
              : 'საბურავის არჩევა იწყება სწორი ინფორმაციით.'
          }}
        </p>
        <a class="action" routerLink="/catalog"
          >{{ en() ? 'Explore the catalogue' : 'კატალოგის დათვალიერება' }}
          <span aria-hidden="true">↗</span></a
        >
      </div>
    </section>
    <article class="story">
      <section class="row">
        <h2>{{ en() ? 'A clearer way to choose' : 'უფრო მარტივი არჩევანი' }}</h2>
        <div>
          <p>
            {{
              en()
                ? 'tyre.ge is an online tyre catalogue. Explore products by size, season and vehicle, compare specifications and keep your selection in the cart.'
                : 'tyre.ge საბურავების ონლაინ კატალოგია. მოძებნეთ პროდუქტი ზომის, სეზონისა და ავტომობილის მიხედვით, შეადარეთ მახასიათებლები და შეინახეთ არჩევანი კალათაში.'
            }}
          </p>
          <p>
            {{
              en()
                ? 'Our aim is to make product information easy to find and understand, so you can choose with greater clarity.'
                : 'ჩვენი მიზანია, პროდუქტის ინფორმაცია მარტივად მოსაძებნი და გასაგები იყოს — რათა არჩევანის გაკეთება გაგიმარტივდეთ.'
            }}
          </p>
        </div>
      </section>
      <section class="row">
        <h2>{{ en() ? 'Details matter' : 'დეტალებს მნიშვნელობა აქვს' }}</h2>
        <div>
          <p>
            {{
              en()
                ? 'Check dimensions and technical specifications against your vehicle documentation and tyre markings before purchasing. Vehicle-based results are a starting point, not a guarantee of fitment.'
                : 'შეძენამდე ზომა და ტექნიკური პარამეტრები შეადარეთ ავტომობილის დოკუმენტაციასა და საბურავის ნიშნულს. ავტომობილით მიღებული შედეგი შერჩევის დასაწყისია და არა თავსებადობის გარანტია.'
            }}
          </p>
          <a class="text-link" routerLink="/garage"
            >{{ en() ? 'Choose by vehicle' : 'არჩევა ავტომობილით' }}
            <span aria-hidden="true">→</span></a
          >
        </div>
      </section>
      <section class="row identity">
        <h2>{{ en() ? 'Merchant information' : 'მერჩანტის ინფორმაცია' }}</h2>
        <div>
          <dl>
            <dt>{{ en() ? 'Company' : 'კომპანია' }}</dt>
            <dd>{{ en() ? 'GL Business Group LLC' : 'შპს „ჯი ელ ბიზნეს ჯგუფი“' }}</dd>
            <dt>{{ en() ? 'Brand' : 'ბრენდი' }}</dt>
            <dd>tyre.ge</dd>
            <dt>{{ en() ? 'Identification number' : 'საიდენტიფიკაციო კოდი' }}</dt>
            <dd>431439311</dd>
            <dt>{{ en() ? 'Address' : 'მისამართი' }}</dt>
            <dd>{{ en() ? '33 Nino Ramishvili St.' : 'ნინო რამიშვილის ქ. №33' }}</dd>
            <dt>{{ en() ? 'Phone' : 'ტელეფონი' }}</dt>
            <dd><a href="tel:+995500110111">500 110 111</a></dd>
            <dt>{{ en() ? 'Email' : 'ელფოსტა' }}</dt>
            <dd><a href="mailto:infotyrege@gmail.com">infotyrege@gmail.com</a></dd>
          </dl>
          <div class="identity__links">
            <a class="text-link" routerLink="/delivery-returns"
              >{{ en() ? 'Delivery and returns' : 'მიწოდება და დაბრუნება' }}
              <span aria-hidden="true">→</span></a
            >
            <a class="text-link" routerLink="/privacy"
              >{{ en() ? 'Privacy information' : 'კონფიდენციალურობა' }}
              <span aria-hidden="true">→</span></a
            >
          </div>
        </div>
      </section>
    </article>
  `,
  styles: `
    :host {
      display: block;
      background: var(--color-surface-muted);
      color: var(--color-text);
    }
    .hero {
      position: relative;
      isolation: isolate;
      min-height: min(620px, calc(100svh - 80px));
      display: flex;
      align-items: center;
      background: #101113;
      color: #fff;
      overflow: hidden;
    }
    .hero__image {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      z-index: -2;
    }
    .hero::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(0, 0, 0, 0.45), transparent);
      z-index: -1;
    }
    .hero__copy {
      padding: 64px clamp(24px, 6vw, 88px);
      max-width: 650px;
      animation: arrive 0.65s ease-out both;
    }
    .eyebrow {
      font-size: 13px;
      letter-spacing: 0.12em;
      margin: 0 0 20px;
      color: #dce1e8;
    }
    h1 {
      font-size: clamp(64px, 8vw, 112px);
      line-height: 1;
      letter-spacing: -0.06em;
      margin: 0 0 28px;
    }
    .hero__lead {
      max-width: 23ch;
      font-size: clamp(22px, 3vw, 34px);
      line-height: 1.5;
      margin: 0 0 36px;
    }
    .action {
      display: inline-flex;
      gap: 24px;
      align-items: center;
      min-height: 48px;
      border-bottom: 1px solid #fff;
      color: #fff;
      text-decoration: none;
    }
    .action span,
    .text-link span {
      display: inline-block;
      transition: transform 0.2s ease;
    }
    a:hover span {
      transform: translateX(5px);
    }
    a:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 6px;
    }
    .story {
      max-width: 1120px;
      padding: 48px clamp(24px, 6vw, 88px) 72px;
      margin: auto;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1.65fr;
      gap: 48px;
      padding: 40px 0;
      border-bottom: 1px solid var(--color-border);
    }
    h2 {
      font-size: clamp(22px, 2vw, 28px);
      line-height: 1.4;
      margin: 0;
    }
    .row p {
      margin: 0 0 18px;
      line-height: 1.85;
      color: var(--color-text-muted);
    }
    .text-link {
      display: inline-flex;
      gap: 20px;
      align-items: center;
      min-height: 44px;
      color: var(--color-text);
      text-underline-offset: 6px;
    }
    dl {
      margin: 0 0 24px;
      display: grid;
      grid-template-columns: minmax(140px, 0.65fr) 1.35fr;
      gap: 12px 24px;
    }
    dt {
      color: var(--color-text-muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    dd a {
      color: inherit;
      text-underline-offset: 5px;
    }
    .identity__links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 28px;
    }
    @keyframes arrive {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @media (max-width: 640px) {
      .hero {
        min-height: 540px;
      }
      .hero__image {
        object-position: 65% center;
        opacity: 0.55;
      }
      .hero::after {
        background: rgba(0, 0, 0, 0.3);
      }
      .row {
        grid-template-columns: 1fr;
        gap: 20px;
      }
      .story {
        padding-top: 16px;
      }
      .hero__copy {
        padding: 40px 24px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .hero__copy {
        animation: none;
      }
      .action span,
      .text-link span {
        transition: none;
      }
    }
  `,
})
export class AboutPage {
  private readonly language = inject(LanguageService);
  protected en(): boolean {
    return this.language.language() === 'en';
  }
}
