import jsQR from 'jsqr';
import { authenticatorQr } from './authenticator-qr';

it('renders a locally scannable QR containing the complete Authenticator setup URI', () => {
  const uri = 'otpauth://totp/tyre.ge%20Admin%3Atest%40example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=tyre.ge%20Admin&algorithm=SHA1&digits=6&period=30';
  const qr = authenticatorQr(uri);
  const scale = 5;
  const width = qr.size * scale;
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const col = Number(match[1]);
    const row = Number(match[2]);
    expect(col).toBeGreaterThanOrEqual(4);
    expect(row).toBeGreaterThanOrEqual(4);
    expect(col).toBeLessThan(qr.size - 4);
    expect(row).toBeLessThan(qr.size - 4);
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const offset = ((row * scale + y) * width + col * scale + x) * 4;
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
    }
  }
  expect(jsQR(rgba, width, width)?.data).toBe(uri);
});
