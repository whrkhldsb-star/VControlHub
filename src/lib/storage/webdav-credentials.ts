import { z } from "zod";
import { decrypt, encrypt } from "@/lib/crypto/service";
import { ValidationError } from "@/lib/errors";
import { validateWebhookUrlSyntax } from "@/lib/security/webhook-url";
import { isUnsafePublicHttpHost } from "./direct-access-url";

const secret = z.string().min(1).max(4096).regex(/^[^\r\n\0]*$/);
export const webDavConfigSchema = z.discriminatedUnion("authType", [
  z.object({ endpoint: z.string().min(1).max(2048), authType: z.literal("basic"), username: secret.refine((v) => !v.includes(":")), password: secret }).strict(),
  z.object({ endpoint: z.string().min(1).max(2048), authType: z.literal("bearer"), token: secret }).strict(),
]);
export type WebDavConfig = z.infer<typeof webDavConfigSchema>;
export type WebDavStorageNode = { basePath: string; webdavConfigEncrypted?: string | null };

/** Configuration errors deliberately never include input values or Zod issues. */
export function validateWebDavConfig(input: unknown): WebDavConfig {
  // The node-management API persists `url`; the adapter historically accepts
  // `endpoint`. Normalize only that alias, retaining strict secret validation.
  let normalized = input;
  if (input && typeof input === "object" && "url" in input && !("endpoint" in input)) {
    const { url, ...rest } = input;
    normalized = { ...rest, endpoint: url };
  }
  const result = webDavConfigSchema.safeParse(normalized);
  if (!result.success) throw new ValidationError("Invalid WebDAV configuration");
  const config = result.data;
  const safe = validateWebhookUrlSyntax(config.endpoint);
  if (!safe.ok || /[#?\\\s]/.test(config.endpoint)) throw new ValidationError("WebDAV endpoint must be a public HTTPS URL without credentials, query or fragment");
  const url = new URL(config.endpoint);
  if (isUnsafePublicHttpHost(url.hostname)) throw new ValidationError("WebDAV endpoint must be public HTTPS");
  // Reject encoded traversal/separators before URL/path normalization can hide them.
  const rawPath = config.endpoint.replace(/^https:\/\/[^/]+/i, "");
  if (rawPath.split("/").some((part) => part === "." || part === "..") || /%(?:2e|2f|5c|25|00)/i.test(rawPath)) throw new ValidationError("Invalid WebDAV endpoint path");
  return config;
}
export function encryptWebDavConfig(input: unknown): string {
  return encrypt(JSON.stringify(validateWebDavConfig(input)));
}
export function resolveStorageWebDavCredentials(node: { webdavConfigEncrypted?: string | null }): WebDavConfig {
  try {
    if (!node.webdavConfigEncrypted) throw new Error();
    return validateWebDavConfig(JSON.parse(decrypt(node.webdavConfigEncrypted)));
  } catch {
    throw new ValidationError("Invalid or unavailable WebDAV encrypted configuration");
  }
}
