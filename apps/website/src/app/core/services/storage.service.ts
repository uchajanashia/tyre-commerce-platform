import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * SSR-safe localStorage wrapper (spec 02/08): no-ops on the server, and every
 * browser access is try/caught for private-mode / quota safety.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  get<T>(key: string): T | null {
    if (!this.isBrowser) {
      return null;
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  set(key: string, value: unknown): void {
    if (!this.isBrowser) {
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // private mode / quota exceeded — persistence is best-effort
    }
  }

  remove(key: string): void {
    if (!this.isBrowser) {
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  /**
   * One-time key rename: if `newKey` is absent but `oldKey` exists, copy the raw
   * (already-serialized) value across, then always drop `oldKey`. Used to migrate
   * the legacy `auren.*` / `wheelz.*` prefixes to the unified `tyre.ge.*` prefix
   * so existing localStorage state isn't orphaned by the brand rename.
   */
  migrate(oldKey: string, newKey: string): void {
    if (!this.isBrowser) {
      return;
    }
    try {
      if (localStorage.getItem(newKey) === null) {
        const old = localStorage.getItem(oldKey);
        if (old !== null) {
          localStorage.setItem(newKey, old);
        }
      }
      localStorage.removeItem(oldKey);
    } catch {
      // best-effort — private mode / quota
    }
  }
}
