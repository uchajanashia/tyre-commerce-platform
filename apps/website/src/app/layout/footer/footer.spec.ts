import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Footer } from './footer';

describe('Footer', () => {
  it('links only to available selection and information routes', () => {
    TestBed.configureTestingModule({ imports: [Footer], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Footer);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const links = [...element.querySelectorAll<HTMLAnchorElement>('a')].map((link) =>
      link.getAttribute('href'),
    );

    expect(links).toEqual([
      '/',
      '/garage',
      '/catalog',
      '/about',
      '/delivery-returns',
      '/terms',
      '/privacy',
      'tel:+995500110111',
      'mailto:infotyrege@gmail.com',
      '/about',
    ]);
    expect(element.textContent).toContain('მიწოდება და დაბრუნება');
    expect(element.textContent).toContain('500 110 111');
    expect(element.textContent).toContain('infotyrege@gmail.com');
  });
});
