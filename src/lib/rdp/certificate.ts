import { rdpCertificateSha256Schema } from "./protocol";
type CertificateTarget = { rdpCertificateSha256?: string | null; rdpIgnoreCertificate?: boolean };
/** Deployment attestation, not automatic detection. Never enable for stock guacd. */
export function rdpCertificateOptions(target: CertificateTarget, args?: string[]): Record<string, string> {
 const pin = rdpCertificateSha256Schema.parse(target.rdpCertificateSha256 ?? "");
 if (pin) {
  if (target.rdpIgnoreCertificate || process.env.RDP_EXCLUSIVE_PIN_GATEWAY !== "true") throw new Error("Exclusive certificate pin gateway unavailable");
  if (args && !["cert-fingerprints", "ignore-cert", "cert-tofu"].every(key => args.includes(key))) throw new Error("Gateway cannot enforce certificate pin");
  return { "ignore-cert": "false", "cert-tofu": "false", "cert-fingerprints": `sha256:${pin.match(/../g)!.join(":")}` };
 }
 return { "ignore-cert": target.rdpIgnoreCertificate ? "true" : "false", "cert-tofu": "false", "cert-fingerprints": "" };
}
