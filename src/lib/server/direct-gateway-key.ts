import { createHmac } from "node:crypto";

/**
 * The key a managed server's direct-download gateway verifies links with.
 *
 * The hub has one configured secret (`STORAGE_DIRECT_ACCESS_SECRET`). Handing
 * that same secret to every gateway meant that root on any one managed server,
 * a customer's own VPS included, could sign links for every other server's
 * gateway. Each gateway installed since therefore receives a key derived from
 * the secret and the server's id: knowing one server's key says nothing about
 * another's, and the hub signs each server's links with that server's key.
 *
 * Gateways installed before this change still hold the shared secret; the
 * server row records which key its gateway runs (`directGatewayKeyVersion`),
 * and enabling the gateway again moves it to its own key.
 */
export const DIRECT_GATEWAY_KEY_SHARED = 1;
export const DIRECT_GATEWAY_KEY_PER_SERVER = 2;

export function deriveDirectGatewayServerKey(secret: string, serverId: string): string {
  if (!secret) throw new Error("Direct gateway secret is required");
  if (!serverId) throw new Error("Server id is required to derive a direct gateway key");
  return createHmac("sha256", secret).update(`vcontrolhub-direct-gateway:v2:${serverId}`).digest("hex");
}

/** The key the hub signs links for this gateway with: its own key, or the shared secret of an older install. */
export function directGatewaySigningKey(secret: string, gateway: { serverId: string | null; keyVersion: number }): string {
  if (gateway.keyVersion >= DIRECT_GATEWAY_KEY_PER_SERVER && gateway.serverId) {
    return deriveDirectGatewayServerKey(secret, gateway.serverId);
  }
  return secret;
}
