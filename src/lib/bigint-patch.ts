/**
 * Global BigInt serialization fix.
 * Prisma sometimes returns BigInt values (e.g. FileEntry.size).
 * JSON.stringify cannot handle BigInt by default — this patches it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

export {};
