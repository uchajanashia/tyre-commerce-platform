import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { authInterceptor, isReplaySafe, isTrustedApiUrl } from './auth.interceptor';

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  const auth = {
    accessToken: 'memory-token' as string | null,
    refreshAccessToken: vi.fn(() => of('rotated-token')),
    clearLocalSession: vi.fn(),
  };
  const router = { url: '/tires/roadx', navigate: vi.fn().mockResolvedValue(true) };

  beforeEach(() => {
    auth.accessToken = 'memory-token';
    auth.refreshAccessToken.mockClear();
    auth.clearLocalSession.mockClear();
    router.navigate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('attaches a memory Bearer only to trusted API origins', () => {
    const configuredApiUrl = `${environment.apiBaseUrl}/admin/me`;
    client.get(configuredApiUrl).subscribe();
    const apiRequest = http.expectOne(configuredApiUrl);
    expect(apiRequest.request.headers.get('Authorization')).toBe('Bearer memory-token');
    apiRequest.flush({});

    client.get('https://api.tyre.ge.evil.example/collect').subscribe();
    const external = http.expectOne('https://api.tyre.ge.evil.example/collect');
    expect(external.request.headers.has('Authorization')).toBe(false);
    external.flush({});
  });

  it('queues a safe request behind one refresh and retries with the rotated token', () => {
    let result: unknown;
    client.get('/admin/v1/auth/sessions').subscribe((value) => (result = value));
    const first = http.expectOne('/admin/v1/auth/sessions');
    expect(first.request.headers.get('Authorization')).toBe('Bearer memory-token');
    first.flush({}, { status: 401, statusText: 'Expired' });

    const retry = http.expectOne('/admin/v1/auth/sessions');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer rotated-token');
    retry.flush({ items: [] });
    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(result).toEqual({ items: [] });
  });

  it('does not replay a non-idempotent mutation without an idempotency key', () => {
    let receivedError: unknown;
    client
      .post('/admin/brands', {})
      .subscribe({ error: (error) => (receivedError = error) });
    http
      .expectOne('/admin/brands')
      .flush({}, { status: 401, statusText: 'Expired' });

    expect(receivedError).toBeInstanceOf(HttpErrorResponse);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    expect(auth.clearLocalSession).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalled();
  });

  it('replays an idempotent mutation after refresh with the same request key', () => {
    let result: unknown;
    client
      .post('/admin/v1/staff', { email: 'new@tyre.ge' }, {
        headers: { 'Idempotency-Key': 'staff-create-1' },
      })
      .subscribe((value) => (result = value));
    const first = http.expectOne('/admin/v1/staff');
    first.flush({}, { status: 401, statusText: 'Expired' });

    const retry = http.expectOne('/admin/v1/staff');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer rotated-token');
    expect(retry.request.headers.get('Idempotency-Key')).toBe('staff-create-1');
    retry.flush({ id: 'staff-new' });

    expect(result).toEqual({ id: 'staff-new' });
    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
  });

  it('does not treat an invalid public invitation token as an expired staff session', () => {
    let receivedError: unknown;
    client
      .post('/admin/v1/invitations/inspect', { token: 'opaque-token' })
      .subscribe({ error: (error) => (receivedError = error) });
    http
      .expectOne('/admin/v1/invitations/inspect')
      .flush({}, { status: 401, statusText: 'Invalid token' });

    expect(receivedError).toBeInstanceOf(HttpErrorResponse);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    expect(auth.clearLocalSession).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('auth request boundaries', () => {
  it('rejects lookalike origins and allows canonical relative identity routes', () => {
    expect(isTrustedApiUrl('/admin/v1/auth/sessions')).toBe(true);
    expect(isTrustedApiUrl(`${environment.apiBaseUrl}/admin/me`)).toBe(true);
    expect(isTrustedApiUrl('https://api.tyre.ge.evil.example/products')).toBe(false);
  });

  it('only permits automatic mutation replay with an idempotency key', () => {
    const get = { method: 'GET', headers: new HeadersAdapter() } as never;
    const post = { method: 'POST', headers: new HeadersAdapter() } as never;
    const idempotentPost = {
      method: 'POST',
      headers: new HeadersAdapter(['Idempotency-Key']),
    } as never;
    expect(isReplaySafe(get)).toBe(true);
    expect(isReplaySafe(post)).toBe(false);
    expect(isReplaySafe(idempotentPost)).toBe(true);
  });
});

class HeadersAdapter {
  constructor(private readonly values: string[] = []) {}
  has(name: string): boolean {
    return this.values.includes(name);
  }
}
