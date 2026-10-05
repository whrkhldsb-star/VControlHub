/**
 * PostgreSQL LIKE treats %, _ and backslash as pattern syntax, including when
 * Prisma builds startsWith/contains filters. Escape only the literal value;
 * Prisma (or the raw SQL caller) adds the intended surrounding wildcards.
 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
