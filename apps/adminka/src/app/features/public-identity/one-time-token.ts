/** Moves a delivery secret from the URL fragment into ephemeral component memory. */
export function takeOneTimeToken(fragment: string | null): string | null {
  clearSensitiveFragment();
  if (!fragment || fragment.length < 60 || fragment.length > 80) return null;
  return fragment;
}

function clearSensitiveFragment(): void {
  try {
    const cleanUrl = `${globalThis.location.pathname}${globalThis.location.search}`;
    globalThis.history.replaceState(globalThis.history.state, '', cleanUrl);
  } catch {
    // The secret is still never copied to storage; hardened browsers may deny History access.
  }
}
