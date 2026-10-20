import { utils } from "ssh2";

/**
 * ssh2's keygen drops a leading zero byte from an ed25519 public key: about
 * one pair in 256 comes out with a 31-byte key, and neither half of that pair
 * parses back. Tests built on a freshly generated pair failed at that rate.
 */
export function generateEd25519KeyPair(encryption?: { passphrase: string; cipher: string; rounds: number }) {
  for (;;) {
    const keys = utils.generateKeyPairSync("ed25519", encryption ?? {});
    if (
      !(utils.parseKey(keys.public) instanceof Error) &&
      !(utils.parseKey(keys.private, encryption?.passphrase) instanceof Error)
    ) {
      return keys;
    }
  }
}
