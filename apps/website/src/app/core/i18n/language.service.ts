import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

export type AppLanguage = 'ka' | 'en';

const LANGUAGE_STORAGE_KEY = 'tyre.ge.language';

const COPY = {
  'nav.home': { ka: 'მთავარი', en: 'Home' },
  'nav.about': { ka: 'ჩვენ შესახებ', en: 'About us' },
  'nav.catalog': { ka: 'კატალოგი', en: 'Catalog' },
  'nav.configurator': { ka: 'კონფიგურატორი', en: 'Configurator' },
  'nav.primary': { ka: 'ძირითადი გვერდები', en: 'Primary pages' },
  'nav.mobile': { ka: 'მობილური ნავიგაცია', en: 'Mobile navigation' },
  'nav.open': { ka: 'მენიუს გახსნა', en: 'Open menu' },
  'nav.close': { ka: 'მენიუს დახურვა', en: 'Close menu' },
  'nav.eyebrow': { ka: 'TYRE.GE / ნავიგაცია', en: 'TYRE.GE / Navigation' },
  'nav.choose': { ka: 'აირჩიე მიმართულება', en: 'Choose a journey' },
  'catalog.categories': { ka: 'კატეგორიები', en: 'Categories' },
  'catalog.fullCategories': { ka: 'კატალოგის კატეგორიები', en: 'Catalog categories' },
  'catalog.passenger': { ka: 'მსუბუქი', en: 'Passenger' },
  'catalog.passengerNote': { ka: 'სამგზავრო და LT', en: 'Passenger and LT' },
  'catalog.truck': { ka: 'სატვირთო', en: 'Truck' },
  'catalog.truckNote': { ka: 'ტრასა და კარიერი', en: 'Road and quarry' },
  'catalog.disk': { ka: 'დისკები', en: 'Wheels' },
  'catalog.diskNote': { ka: 'მსუბუქი და სატვირთო', en: 'Passenger and truck' },
  'catalog.special': { ka: 'სპეცტექნიკა', en: 'Special equipment' },
  'catalog.specialNote': { ka: 'ტრაქტორი და სხვა', en: 'Tractor and more' },
  'garage.choose': { ka: 'ავტომობილის არჩევა', en: 'Choose a vehicle' },
  'shell.georgianCatalog': { ka: 'ქართული ონლაინ კატალოგი', en: 'Georgian online catalog' },
  'cart.title': { ka: 'კალათა', en: 'Cart' },
  'cart.view': { ka: 'კალათის ნახვა', en: 'View cart' },
  'language.label': { ka: 'ენა', en: 'Language' },
  'language.georgian': { ka: 'ქართული', en: 'Georgian' },
  'language.english': { ka: 'ინგლისური', en: 'English' },
  'footer.tagline': {
    ka: 'საბურავის არჩევა ავტომობილით ან ზომით — მარტივად და მკაფიოდ.',
    en: 'Choose tyres by vehicle or size — simply and clearly.',
  },
  'footer.choose': { ka: 'არჩევა', en: 'Shop' },
  'footer.byVehicle': { ka: 'ავტომობილით არჩევა', en: 'Shop by vehicle' },
  'footer.bySize': { ka: 'ზომით არჩევა', en: 'Shop by size' },
  'footer.information': { ka: 'ინფორმაცია', en: 'Information' },
  'footer.terms': { ka: 'წესები და პირობები', en: 'Terms and conditions' },
  'footer.deliveryReturns': { ka: 'მიწოდება და დაბრუნება', en: 'Delivery and returns' },
  'footer.privacy': { ka: 'კონფიდენციალურობა', en: 'Privacy' },
  'footer.contact': { ka: 'კონტაქტი', en: 'Contact' },
  'footer.address': { ka: 'ნინო რამიშვილის ქ. №33', en: '33 Nino Ramishvili St.' },
  'footer.fitmentNote': {
    ka: 'ზომა და ტექნიკური პარამეტრები გადაამოწმეთ ავტომობილის დოკუმენტაციასთან.',
    en: 'Confirm tyre size and technical specifications against the vehicle documentation.',
  },
} as const;

export type LanguageKey = keyof typeof COPY;

@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly language = signal<AppLanguage>('ka');

  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    let initial: AppLanguage = 'ka';
    if (this.isBrowser) {
      try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored === 'en' || stored === 'ka') {
          initial = stored;
        }
      } catch {
        // A blocked storage policy must never prevent the storefront from loading.
      }
    }
    this.applyLanguage(initial, false);
  }

  text(key: LanguageKey): string {
    return COPY[key][this.language()];
  }

  setLanguage(language: AppLanguage): void {
    this.applyLanguage(language, true);
  }

  private applyLanguage(language: AppLanguage, persist: boolean): void {
    this.language.set(language);
    this.document.documentElement.lang = language;
    if (persist && this.isBrowser) {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // The selected language still applies to this session when storage is blocked.
      }
    }
  }
}
