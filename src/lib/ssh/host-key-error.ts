/**
 * Whether an ssh2 connection error means the host key verifier refused the server's key (an unpinned key
 * under enforced pinning, or a key that differs from the pin).
 *
 * ssh2 reports that as "Host denied (verification failed)", a handshake-level error raised after
 * `hostVerifier` returns false. The older wordings stay because other layers build errors of their own.
 */
export function isHostKeyRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /host denied|host key verification|host verifier/i.test(message);
}
