import { isIP } from "node:net";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** First release accepts public canonical IPv4 only: no DNS rebinding or LAN pivot. */
export function assertPublicRdpHost(host: string) {
 const parts = host.split(".").map(Number);
 const [a = 0, b = 0] = parts;
 if (isIP(host) !== 4 || parts.join(".") !== host || a === 0 || a === 10 || a === 127 || a >= 224 ||
  (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19))) {
  throw new ValidationError(t("backend.rdp.publicHost"));
 }
}
export const rdpCertificateSha256Schema = z.string().regex(/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}|)$/, "Use 64 hexadecimal characters or 32 colon-separated bytes").default("").transform(v => v.replaceAll(":", "").toLowerCase());
export const rdpProfileSchema = z.object({
 name: z.string().trim().min(2).max(64),
 host: z.string().trim().refine(value => { try { assertPublicRdpHost(value); return true; } catch { return false; } }, "RDP requires a public IPv4 address"),
 port: z.coerce.number().int().min(1).max(65535).default(3389),
 username: z.string().trim().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/),
 password: z.string().min(1).max(1024).refine(v => !v.includes("\0")),
 domain: z.string().trim().max(128).regex(/^[A-Za-z0-9._-]*$/).default(""),
 certificateSha256: rdpCertificateSha256Schema,
 ignoreCertificate: z.boolean().default(false),
 description: z.string().trim().max(255).default(""),
 tags: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
}).refine(data => !data.certificateSha256 || !data.ignoreCertificate, { message: "Certificate pinning cannot be combined with ignore certificate" });

export function instruction(...elements: string[]) {
 return elements.map(value => `${Array.from(value).length}.${value}`).join(",") + ";";
}
/** Guacamole counts Unicode codepoints, not UTF-8 bytes or UTF-16 code units. */
export class GuacParser {
 private buffer = "";
 private elements: string[] = [];
 private instructionLength = 0;
 constructor(private readonly onInstruction: (elements: string[]) => void, private readonly maxInstructionLength = 2_000_000) {}
 feed(chunk: string) {
  this.buffer += chunk;
  if (this.buffer.length + this.instructionLength > this.maxInstructionLength) throw new Error("Guacamole frame too large");
  while (this.buffer) {
   const dot = this.buffer.indexOf(".");
   if (dot < 0) { if (!/^\d{0,7}$/.test(this.buffer)) throw new Error("Invalid frame length"); return; }
   const prefix = this.buffer.slice(0, dot);
   if (!/^\d{1,7}$/.test(prefix)) throw new Error("Invalid frame length");
   const length = Number(prefix);
   if (length > 1_000_000) throw new Error("Guacamole element too large");
   let end = dot + 1;
   for (let i = 0; i < length; i++) {
    if (end >= this.buffer.length) return;
    const point = this.buffer.codePointAt(end)!;
    if (point >= 0xd800 && point <= 0xdbff && end + 1 === this.buffer.length) return;
    end += point > 0xffff ? 2 : 1;
   }
   if (end >= this.buffer.length) return;
   const separator = this.buffer[end];
   if (separator !== "," && separator !== ";") throw new Error("Invalid frame separator");
   this.instructionLength += end + 1;
   this.elements.push(this.buffer.slice(dot + 1, end));
   if (this.elements.length > 256) throw new Error("Too many elements");
   this.buffer = this.buffer.slice(end + 1);
   if (separator === ";") { const row = this.elements; this.elements = []; this.instructionLength = 0; this.onInstruction(row); }
  }
 }
}
export function validateClientInstruction(row: string[]) {
 const [op, ...args] = row;
 // Image streams need ACKs too; never permit client blob/file creation.
 if (op === "ack") return args.length === 3 && /^\d{1,10}$/.test(args[0]!) && Number(args[0]) <= 0x7fffffff && args[1]!.length <= 256 && /^\d{1,5}$/.test(args[2]!) && Number(args[2]) <= 0xffff;
 if (op === "") return args.length === 2 && args[0] === "ping" && /^\d{1,16}$/.test(args[1]!) && Number.isSafeInteger(Number(args[1]));
 if (!args.every(v => /^\d{1,16}$/.test(v) && Number.isSafeInteger(Number(v)))) return false;
 const nums = args.map(Number);
 switch (op) {
  case "sync": return nums.length >= 1 && nums.length <= 2;
  case "key": return nums.length === 2 && nums[0]! <= 0x1fffffff && nums[1]! <= 1;
  case "mouse": return nums.length === 3 && nums[0]! <= 8192 && nums[1]! <= 8192 && nums[2]! <= 31;
  case "size": return nums.length === 2 && nums.every(n => n >= 200 && n <= 4096);
  case "disconnect": return nums.length === 0;
  case "nop": return nums.length === 0;
  default: return false;
 }
}
