import { TestBed } from '@angular/core/testing';

import { LanguageService } from './language.service';

describe('LanguageService', () => {
  beforeEach(() => {
    localStorage.removeItem('tyre.ge.language');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.removeItem('tyre.ge.language');
  });

  it('starts in Georgian and updates visible copy, document language, and persistence', () => {
    const service = TestBed.inject(LanguageService);

    expect(service.language()).toBe('ka');
    expect(service.text('nav.catalog')).toBe('კატალოგი');

    service.setLanguage('en');

    expect(service.text('nav.catalog')).toBe('Catalog');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('tyre.ge.language')).toBe('en');
  });
});
