import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { rdpCertificateSha256Schema } from "./protocol";
type CertificateTarget = { rdpCertificateSha256?: string | null; rdpIgnoreCertificate?: boolean };
/**
 * Whether this deployment attests that its guacd enforces `cert-fingerprints`
 * (RDP_EXCLUSIVE_PIN_GATEWAY=true). Stock guacd ignores the pin, so a node that
 * carries one is refused rather than connected unverified (A3-01).
 */
export function rdpCertificatePinSupported(): boolean {
 return process.env.RDP_EXCLUSIVE_PIN_GATEWAY === "true";
}
/** Deployment attestation, not automatic detection. Never enable for stock guacd. */
export function rdpCertificateOptions(target: CertificateTarget, args?: string[]): Record<string, string> {
 const pin = rdpCertificateSha256Schema.parse(target.rdpCertificateSha256 ?? "");
 if (pin) {
  if (target.rdpIgnoreCertificate || !rdpCertificatePinSupported()) throw new BusinessError(t("backend.rdp.pinGatewayUnavailable"));
  if (args && !["cert-fingerprints", "ignore-cert", "cert-tofu"].every(key => args.includes(key))) throw new BusinessError(t("backend.rdp.pinGatewayUnavailable"));
  return { "ignore-cert": "false", "cert-tofu": "false", "cert-fingerprints": `sha256:${pin.match(/../g)!.join(":")}` };
 }
 return { "ignore-cert": target.rdpIgnoreCertificate ? "true" : "false", "cert-tofu": "false", "cert-fingerprints": "" };
}
