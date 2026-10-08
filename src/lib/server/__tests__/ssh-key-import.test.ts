import { createHash, createHmac, generateKeyPairSync, sign, verify } from "node:crypto";
import { parsePrivateKey } from "sshpk";
import { utils } from "ssh2";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { normalizeImportedSshKey } from "../ssh-keys";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const ed = generateKeyPairSync("ed25519");
const password = "  密码 with spaces  ";
const cases = [
  ["RSA PKCS1 PEM", rsa.privateKey.export({ format: "pem", type: "pkcs1" }), rsa.publicKey],
  ["RSA PKCS1 DER .key", rsa.privateKey.export({ format: "der", type: "pkcs1" }), rsa.publicKey],
  ["RSA PKCS8 DER", rsa.privateKey.export({ format: "der", type: "pkcs8" }), rsa.publicKey],
  ["EC SEC1 PEM", ec.privateKey.export({ format: "pem", type: "sec1" }), ec.publicKey],
  ["EC SEC1 DER", ec.privateKey.export({ format: "der", type: "sec1" }), ec.publicKey],
  ["Ed25519 PKCS8 PEM", ed.privateKey.export({ format: "pem", type: "pkcs8" }), ed.publicKey],
  ["Ed25519 PKCS8 DER", ed.privateKey.export({ format: "der", type: "pkcs8" }), ed.publicKey],
  ["encrypted PKCS8 PEM", rsa.privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: password }), rsa.publicKey],
  ["encrypted PKCS8 DER", ed.privateKey.export({ format: "der", type: "pkcs8", cipher: "aes-256-cbc", passphrase: password }), ed.publicKey],
  ["encrypted legacy RSA PEM", rsa.privateKey.export({ format: "pem", type: "pkcs1", cipher: "aes-256-cbc", passphrase: password }), rsa.publicKey],
] as const;

describe("SSH key import", () => {
  it.each(cases)("imports %s into usable SSH credentials", async (_name, source, publicKey) => {
    const imported = await normalizeImportedSshKey({ keyFile: Buffer.from(source), passphrase: password });
    const parsed = utils.parseKey(imported.privateKey);
    if (parsed instanceof Error) throw parsed;
    const key = Array.isArray(parsed) ? parsed[0]! : parsed;
    const data = Buffer.from("prove imported key still authenticates");
    const signature = sign(publicKey.asymmetricKeyType === "ed25519" ? null : "sha256", data, key.getPrivatePEM());
    expect(verify(publicKey.asymmetricKeyType === "ed25519" ? null : "sha256", data, publicKey, signature)).toBe(true);
    expect(imported.fingerprint).toBe(`SHA256:${createHash("sha256").update(key.getPublicSSH()).digest("base64").replace(/=+$/, "")}`);
  });
  it.each([rsa, ec, ed])("accepts extensionless OpenSSH keys and pasted text", async pair => {
    const source = parsePrivateKey(pair.privateKey.export({ format: "pem", type: "pkcs8" })).toString("openssh");
    const file = await normalizeImportedSshKey({ keyFile: Buffer.from(source) });
    const manual = await normalizeImportedSshKey({ privateKey: source.replaceAll("\n", "\r\n"), publicKey: file.publicKey });
    expect(manual.fingerprint).toBe(file.fingerprint);
  });
  it("imports password-protected modern OpenSSH without stripping password spaces", async () => {
    const generated = utils.generateKeyPairSync("ed25519", { passphrase: password, cipher: "aes256-cbc", rounds: 4 });
    const imported = await normalizeImportedSshKey({ privateKey: generated.private, passphrase: password });
    const expected = utils.parseKey(generated.public);
    if (expected instanceof Error) throw expected;
    expect(imported.publicKey).toBe(`ssh-ed25519 ${expected.getPublicSSH().toString("base64")}`);
  });
  it.each([2, 3])("converts a real PPK v%i and preserves the public key", async version => {
    const key = parsePrivateKey(ed.privateKey.export({ format: "pem", type: "pkcs8" }));
    const publicBytes = key.toPublic().toBuffer("rfc4253");
    const field = (data: string | Buffer) => {
      const bytes = Buffer.from(data), length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      return Buffer.concat([length, bytes]);
    };
    const privateBytes = field(key.parts.find(part => part.name === "k")!.data.subarray(0, 32));
    const macKey = version === 2 ? createHash("sha1").update("putty-private-key-file-mac-key").digest() : Buffer.alloc(0);
    const mac = createHmac(version === 2 ? "sha1" : "sha256", macKey).update(Buffer.concat([field("ssh-ed25519"), field("none"), field("fixture"), field(publicBytes), field(privateBytes)])).digest("hex");
    const source = `PuTTY-User-Key-File-${version}: ssh-ed25519\nEncryption: none\nComment: fixture\nPublic-Lines: 1\n${publicBytes.toString("base64")}\nPrivate-Lines: 1\n${privateBytes.toString("base64")}\nPrivate-MAC: ${mac}\n`;
    const imported = await normalizeImportedSshKey({ keyFile: Buffer.from(source) });
    expect(imported.publicKey).toBe(`ssh-ed25519 ${publicBytes.toString("base64")}`);
  });
  it("rejects wrong passwords, mismatched public keys and public-only input", async () => {
    await expect(normalizeImportedSshKey({ keyFile: Buffer.from(cases[7][1]), passphrase: "wrong" })).rejects.toThrow();
    await expect(normalizeImportedSshKey({ privateKey: String(cases[0][1]), publicKey: parsePrivateKey(ed.privateKey.export({ format: "pem", type: "pkcs8" })).toPublic().toString("ssh") })).rejects.toThrow("不匹配");
    await expect(normalizeImportedSshKey({ publicKey: "ssh-rsa AAAA" })).rejects.toThrow("请粘贴私钥");
    await expect(normalizeImportedSshKey({ keyFile: Buffer.from("ssh-rsa AAAA") })).rejects.toThrow();
  });
});
