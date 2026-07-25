/**
 * Global BigInt serialization fix.
 * Prisma sometimes returns BigInt values (e.g. FileEntry.size).
 * JSON.stringify cannot handle BigInt by default — this patches it.
 *
 * Prefer decimal string for values outside Number.MAX_SAFE_INTEGER so
 * multi-TB+ byte sizes are not silently rounded. Safe integers still
 * serialize as numbers to preserve existing numeric clients.
 *
 * Always assign (do not skip if a prior toJSON exists) so upgrades from the
 * old Number-only patch take effect in long-lived processes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint) {
  if (
    this <= BigInt(Number.MAX_SAFE_INTEGER) &&
    this >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(this);
  }
  return this.toString();
};

export {};
