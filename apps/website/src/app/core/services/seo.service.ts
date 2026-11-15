import { DOCUMENT } from '@angular/common';
import { Injectable, RESPONSE_INIT, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

const SITE_ORIGIN = 'https://tyre.ge';
const DEFAULT_DESCRIPTION =
  'საბურავების კატალოგი, ზომის, სეზონისა და გამოყენების მიხედვით — tyre.ge.';

export interface SeoPage {
  title: string;
  description?: string;
  canonicalPath?: string;
  indexable?: boolean;
  status?: number;
}

/** SSR-safe metadata, canonical and response-status boundary. */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly responseInit = inject(RESPONSE_INIT);

  setPage(page: SeoPage): void {
    const fullTitle = page.title.endsWith('tyre.ge') ? page.title : `${page.title} — tyre.ge`;
    const description = page.description?.trim() || DEFAULT_DESCRIPTION;
    const indexable = page.indexable !== false;

    this.title.setTitle(fullTitle);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'robots', content: indexable ? 'index,follow' : 'noindex,nofollow' });
    this.meta.updateTag({ property: 'og:title', content: fullTitle }, "property='og:title'");
    this.meta.updateTag({ property: 'og:description', content: description }, "property='og:description'");
    this.meta.updateTag({ property: 'og:type', content: 'website' }, "property='og:type'");

    if (indexable && page.canonicalPath) {
      const canonicalUrl = new URL(page.canonicalPath, SITE_ORIGIN).toString();
      this.setCanonical(canonicalUrl);
      this.meta.updateTag({ property: 'og:url', content: canonicalUrl }, "property='og:url'");
    } else {
      this.removeCanonical();
      this.meta.removeTag("property='og:url'");
    }

    if (page.status !== undefined && this.responseInit) {
      this.responseInit.status = page.status;
    }
  }

  setRouteDefaults(title: string, rawUrl: string): void {
    const path = rawUrl.split(/[?#]/, 1)[0] || '/';
    const indexable =
      path === '/' ||
      path === '/catalog' ||
      path === '/season' ||
      path.startsWith('/tire/') ||
      path.startsWith('/brands/');
    this.setPage({ title, canonicalPath: path, indexable });
  }

  setNotFound(label = 'გვერდი ვერ მოიძებნა'): void {
    this.setPage({ title: label, indexable: false, status: 404 });
  }

  setUnavailable(label: string): void {
    this.setPage({ title: label, indexable: false, status: 503 });
  }

  private setCanonical(url: string): void {
    let link = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'canonical';
      this.document.head.appendChild(link);
    }
    link.href = url;
  }

  private removeCanonical(): void {
    this.document.head.querySelector('link[rel="canonical"]')?.remove();
  }
}
