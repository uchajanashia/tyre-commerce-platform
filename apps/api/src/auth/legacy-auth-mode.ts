export function legacyJwtConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET?.trim());
}
