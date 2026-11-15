import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DeliveryReturnsPage } from './delivery-returns.page';
import { PrivacyPage } from './privacy.page';
import { TermsPage } from './terms.page';

describe('legal information pages', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('publishes a complete and specific privacy notice', () => {
    const fixture = TestBed.createComponent(PrivacyPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('შპს „ჯი ელ ბიზნეს ჯგუფი“');
    expect(text).toContain('რა მონაცემებს ვამუშავებთ');
    expect(text).toContain('პირადი ნომერი BOG-ს არ გადაეცემა');
    expect(text).toContain('თქვენი უფლებები');
    expect(fixture.nativeElement.querySelector('a[href="/privacy#rights"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('main')).toHaveLength(0);
  });

  it('explains the products, prices, orders and merchant obligations', () => {
    const fixture = TestBed.createComponent(TermsPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ქართულ ლარში (GEL/₾)');
    expect(text).toContain('კალათაში პროდუქტის დამატება ხელშეკრულებას არ ქმნის');
    expect(text).toContain('2 წლის განმავლობაში');
    expect(fixture.nativeElement.querySelector('a[href="/delivery-returns"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/terms#merchant"]')).not.toBeNull();
  });

  it('states delivery, withdrawal, return and refund deadlines', () => {
    const fixture = TestBed.createComponent(DeliveryReturnsPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('30 კალენდარული დღისა');
    expect(text).toContain('14 კალენდარული დღის განმავლობაში');
    expect(text).toContain('არაუგვიანეს 7 კალენდარული დღისა');
    expect(text).toContain('თანხა დაბრუნდება გადახდის იმავე საშუალებით');
    expect(text).toContain('მხოლოდ შეფუთვის გახსნა დაბრუნებაზე უარის ავტომატური საფუძველი არ არის');
    expect(
      fixture.nativeElement.querySelector('a[href="/delivery-returns#refund"]'),
    ).not.toBeNull();
  });
});
