import { Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/** Encodes entirely in memory; the enrollment secret never goes to an image service. */
export function authenticatorQr(uri: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(uri, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const modules: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) modules.push(`M${col + 4} ${row + 4}h1v1h-1z`);
    }
  }
  return { size: count + 8, path: modules.join('') };
}

@Component({
  selector: 'adm-authenticator-qr',
  template: `
    <svg role="img" aria-label="Authenticator-ის დასამატებელი QR კოდი"
      [attr.viewBox]="'0 0 ' + qr().size + ' ' + qr().size" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path [attr.d]="qr().path" fill="#000" />
    </svg>
  `,
  styles: `:host { display: block; margin: 16px auto; width: min(100%, 280px); }
    svg { display: block; width: 100%; height: auto; aspect-ratio: 1; }`,
})
export class AuthenticatorQr {
  readonly uri = input.required<string>();
  readonly qr = computed(() => authenticatorQr(this.uri()));
}
