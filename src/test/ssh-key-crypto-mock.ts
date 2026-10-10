/**
 * Completes a partial `vi.mock("@/lib/ssh/ssh-key-crypto")` factory with the
 * shared credential select and a `decryptStoredSshKey` built on the test's
 * own `decryptSshPrivateKey`, so tests keep asserting their decrypted values.
 *
 *   vi.mock("@/lib/ssh/ssh-key-crypto", async () =>
 *     (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({ decryptSshPrivateKey: … }));
 */
type StoredKey = { privateKey?: string | null; passphrase?: string | null } | null | undefined;

export function withStoredKeyHelpers<T extends { decryptSshPrivateKey?: (value: string) => unknown }>(base: T) {
  const decrypt = base.decryptSshPrivateKey ?? ((value: string) => value);
  return {
    ...base,
    SSH_KEY_CREDENTIAL_SELECT: { privateKey: true, passphrase: true } as const,
    decryptStoredSshKey: (key: StoredKey) => (key?.privateKey ? { privateKey: decrypt(key.privateKey) as string } : null),
  };
}
