import { ADMIN_COLOR_TOKENS } from './app/layout/admin-theme';

describe('admin color tokens', () => {
  const cases = [
    ['inkFaint', 'surface'],
    ['inkFaint', 'surfaceSubtle'],
    ['sidebarHeading', 'sidebar'],
    ['sidebarMuted', 'sidebar'],
    ['sidebarDisabled', 'sidebar'],
  ] as const;

  it.each(cases)('%s has AA contrast on %s', (foregroundToken, backgroundToken) => {
    const foreground = ADMIN_COLOR_TOKENS[foregroundToken];
    const background = ADMIN_COLOR_TOKENS[backgroundToken];

    expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
    expect(background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
