import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LanguageService } from '@core/i18n/language.service';
import { AboutPage } from './about.page';

describe('AboutPage', () => {
  it('shows complete merchant details and switches language', () => {
    TestBed.configureTestingModule({ imports: [AboutPage], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(AboutPage);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')?.textContent).toBe('tyre.ge');
    expect(host.textContent).toContain('431439311');
    expect(host.textContent).toContain('შპს „ჯი ელ ბიზნეს ჯგუფი“');
    expect(host.textContent).toContain('ნინო რამიშვილის ქ. №33');
    expect(host.textContent).toContain('500 110 111');
    expect(host.textContent).toContain('infotyrege@gmail.com');
    expect(host.querySelector('a[href="/catalog"]')).not.toBeNull();
    expect(host.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(host.querySelector('a[href="/delivery-returns"]')).not.toBeNull();
    TestBed.inject(LanguageService).setLanguage('en');
    fixture.detectChanges();
    expect(host.textContent).toContain('ABOUT US');
    TestBed.inject(LanguageService).setLanguage('ka');
  });
});
