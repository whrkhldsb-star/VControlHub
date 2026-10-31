// Bcrypt runs on the libuv pool. Versioned SHA-256 prehashing preserves the
// complete UTF-8 password without bcrypt's 72-byte truncation. Base64 is
// NUL-free and below that limit; legacy $2a/$2b hashes still verify unchanged.
import { createHash } from "node:crypto";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;
const PREFIX = "vch-bcrypt-sha256-v1:";
const prehash = (password: string) => createHash("sha256").update("vcontrolhub:password:v1\0").update(password, "utf8").digest("base64");

export async function hashPassword(password: string): Promise<string> {
  return PREFIX + await bcrypt.hash(prehash(password), SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (passwordHash.startsWith(PREFIX)) {
    return bcrypt.compare(prehash(password), passwordHash.slice(PREFIX.length));
  }
  return bcrypt.compare(password, passwordHash);
}
