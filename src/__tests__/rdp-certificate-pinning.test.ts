import { describe, expect, it } from "vitest";
import { createServerSchema } from "@/lib/server/schema";
const pin = "ab".repeat(32);
const profile = { operatingSystem: "WINDOWS", name: "Windows", host: "8.8.8.8", rdpPassword: "secret", username: "Admin" };
describe("RDP certificate enrollment", () => {
 it("normalizes a strict colon-separated SHA256 fingerprint", () => {
  expect(createServerSchema.parse({...profile, rdpCertificateSha256: Array(32).fill("AB").join(":")})).toHaveProperty("rdpCertificateSha256", pin);
 });
 it.each(["ab", "sha256:" + pin, pin + ":", "a:".repeat(32), "zz".repeat(32), " " + pin])("rejects malformed pin %s", value => {
  expect(createServerSchema.safeParse({...profile, rdpCertificateSha256:value}).success).toBe(false);
 });
 it("rejects ignore-certificate with an enrolled pin", () => {
  expect(createServerSchema.safeParse({...profile, rdpCertificateSha256:pin, rdpIgnoreCertificate:true}).success).toBe(false);
 });
});
