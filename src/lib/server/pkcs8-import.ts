import { Worker } from "node:worker_threads";

import { RateLimitError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

function invalid(): never {
  throw new ValidationError(t("backend.server.sshPrivateKeyImportFailed"));
}
function overBudget(): never {
  throw new ValidationError(t("backend.server.sshKeyKdfTooHeavy"));
}

// Only definite-length DER is admitted to OpenSSL. Return a bounded view for
// each nested value so an inner field cannot consume bytes from its siblings.
class DerReader {
  private offset = 0;
  constructor(private readonly data: Buffer) {}
  get nextTag() { return this.data[this.offset]; }
  take(tag: number): Buffer {
    if (this.data[this.offset++] !== tag) return invalid();
    let length = this.data[this.offset++];
    if (length === undefined) return invalid();
    if (length >= 128) {
      const bytes = length - 128;
      if (bytes < 1 || bytes > 4 || this.offset + bytes > this.data.length || this.data[this.offset] === 0) return invalid();
      length = this.data.readUIntBE(this.offset, bytes);
      if (length < 128) return invalid();
      this.offset += bytes;
    }
    const start = this.offset;
    this.offset += length;
    if (this.offset > this.data.length) return invalid();
    return this.data.subarray(start, this.offset);
  }
  sequence() { return new DerReader(this.take(0x30)); }
  oid() { return this.take(0x06).toString("hex"); }
  integer() {
    const value = this.take(0x02);
    if (!value.length || value[0]! >= 128) return invalid();
    if (value.length > 4) return overBudget();
    const n = value.readUIntBE(0, value.length);
    if (!n) return invalid();
    return n;
  }
  end() { if (this.nextTag !== undefined) invalid(); }
}

function checkSalt(params: DerReader) {
  if (params.take(0x04).length > 128) overBudget();
}

function checkPbes2(params: DerReader) {
  const kdf = params.sequence();
  const algorithm = kdf.oid();
  const cost = kdf.sequence();
  kdf.end();
  checkSalt(cost);
  if (algorithm === "2a864886f70d01050c") { // PBKDF2
    if (cost.integer() > 600_000) overBudget();
    if (cost.nextTag === 2 && cost.integer() > 64) overBudget();
    if (cost.nextTag === 0x30) {
      const prf = cost.sequence();
      if (!/^2a864886f70d020[789ab]$/.test(prf.oid())) return invalid(); // HMAC SHA-1/224/256/384/512
      if (prf.nextTag === 5 && prf.take(5).length) return invalid();
      prf.end();
    }
  } else if (algorithm === "2b06010401da47040b") { // scrypt
    const n = cost.integer(), r = cost.integer(), p = cost.integer();
    if ((n & (n - 1)) !== 0 || 128 * n * r > 64 * 1024 ** 2 || n * r * p > 2 ** 21) overBudget();
    if (cost.nextTag === 2 && cost.integer() > 64) overBudget();
  } else {
    return invalid();
  }
  cost.end();
  const cipher = params.sequence();
  const oid = cipher.oid();
  // AES-CBC (128, 192, 256), DES-EDE3-CBC or DES-CBC; fixed-size keys and IVs.
  if (!["608648016503040102", "608648016503040116", "60864801650304012a", "2a864886f70d0307", "2b0e030207"].includes(oid)) return invalid();
  if (cipher.take(4).length > 16) return invalid();
  cipher.end();
  params.end();
}

/** An unencrypted PKCS#1/SEC1/PKCS#8 starts with an integer version. */
export function isBudgetedEncryptedDer(der: Buffer) {
  const envelope = new DerReader(der);
  const body = envelope.sequence();
  envelope.end();
  if (body.nextTag === 2) return false;
  const algorithm = body.sequence();
  const oid = algorithm.oid();
  const params = algorithm.sequence();
  algorithm.end();
  if (oid === "2a864886f70d01050d") checkPbes2(params);
  else if (/^2a864886f70d(?:01050[1346ab]|010c010[1-6])$/.test(oid)) {
    checkSalt(params);
    if (params.integer() > 600_000) overBudget();
    params.end();
  } else return invalid();
  body.take(4);
  body.end();
  return true;
}

let active = 0;
const decrypt = `
  const { parentPort, workerData } = require("node:worker_threads");
  const { createPrivateKey } = require("node:crypto");
  const key = createPrivateKey({ key: Buffer.from(workerData.der), format: "der", type: "pkcs8", passphrase: workerData.passphrase });
  parentPort.postMessage(key.export({ format: "pem", type: "pkcs8" }));
`;

export async function decryptBudgetedPkcs8(der: Buffer, passphrase?: string): Promise<string> {
  if (active >= 2) throw new RateLimitError();
  active++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(decrypt, { eval: true, workerData: { der, passphrase } });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error("Key import worker exited")));
    });
  } finally {
    active--;
  }
}
