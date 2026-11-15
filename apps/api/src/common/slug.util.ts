/**
 * Deterministic brand id/slug from its name: "ROADX" -> "roadx".
 * Single source of truth — used by the seed (prisma/seed.ts) and the brand admin
 * endpoints, so an admin-created brand gets exactly the id a re-seed would produce.
 *
 * Unicode-aware: keeps any letter/digit (e.g. Georgian names slug to Georgian),
 * which is a superset of the original a-z0-9 rule — all 29 seeded Latin brand ids
 * come out identical.
 */
export function brandSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
