// Native bcrypt hashes on the libuv thread pool. bcryptjs did the same work in
// JavaScript on the event loop: at cost 12 every login held the whole server
// for ~350 ms, and a dozen concurrent logins stalled every request for seconds.
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
