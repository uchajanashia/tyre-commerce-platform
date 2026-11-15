import { DOCUMENT } from '@angular/common';
import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';

import { SeoService } from './seo.service';

describe('SeoService', () => {
  let document: Document;
  let meta: Meta;
  let response: ResponseInit;
  let seo: SeoService;

  beforeEach(() => {
    response = { status: 200 };
    TestBed.configureTestingModule({
      providers: [{ provide: RESPONSE_INIT, useValue: response }],
    });
    document = TestBed.inject(DOCUMENT);
    meta = TestBed.inject(Meta);
    seo = TestBed.inject(SeoService);
  });

  it('writes verified page metadata and an absolute canonical URL', () => {
    seo.setPage({
      title: 'ROADX RXMOTION 205/55R16',
      description: 'Verified catalog description.',
      canonicalPath: '/tire/002277',
    });

    expect(TestBed.inject(Title).getTitle()).toBe('ROADX RXMOTION 205/55R16 — tyre.ge');
    expect(meta.getTag("name='description'")?.content).toBe('Verified catalog description.');
    expect(meta.getTag("name='robots'")?.content).toBe('index,follow');
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(
      'https://tyre.ge/tire/002277',
    );
  });

  it('sets a real SSR 404 and removes index/canonical signals', () => {
    seo.setPage({ title: 'Existing', canonicalPath: '/catalog' });
    seo.setNotFound();

    expect(response.status).toBe(404);
    expect(meta.getTag("name='robots'")?.content).toBe('noindex,nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('marks API outages as unavailable instead of a false not-found response', () => {
    seo.setUnavailable('კატალოგი დროებით მიუწვდომელია');

    expect(response.status).toBe(503);
    expect(meta.getTag("name='robots'")?.content).toBe('noindex,nofollow');
  });
});
