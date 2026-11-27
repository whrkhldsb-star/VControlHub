import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { config } from "@/lib/config/env";
import { PEER_ADDRESS_HEADER } from "@/lib/http/peer-address";
import { getClientIp } from "@/lib/rate-limit";

/**
 * Bounds the WebSockets that have not authenticated yet.
 *
 * Every upgrade starts unauthenticated, and a client that never presents a credential would otherwise sit in
 * the server's client list (counted against the connection limits) until it is dropped. Keeping these apart
 * from the authenticated count means they cannot take a terminal's or desktop's place, and the per-address
 * cap keeps one source from filling the small pool they do have.
 */
export class PreAuthLimiter {
  private total = 0;
  private readonly byAddress = new Map<string, number>();

  constructor(private readonly maxTotal: number, private readonly maxPerAddress: number) {}

  /** Unauthenticated sockets right now. */
  get size() { return this.total; }

  /** Take a place for a new socket: the release function (call once it authenticates or closes), or null when full. */
  acquire(address: string): (() => void) | null {
    // "unknown" means no trusted forwarding header: every client would share that one bucket, so only the total applies.
    const tracked = address !== "unknown";
    const held = tracked ? this.byAddress.get(address) ?? 0 : 0;
    if (this.total >= this.maxTotal || (tracked && held >= this.maxPerAddress)) return null;
    this.total += 1;
    if (tracked) this.byAddress.set(address, held + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      if (!tracked) return;
      const left = (this.byAddress.get(address) ?? 1) - 1;
      if (left <= 0) this.byAddress.delete(address);
      else this.byAddress.set(address, left);
    };
  }
}

export const PEER_SIGNATURE_HEADER = "x-vch-ws-peer-signature";

/** Bind the listener-observed peer to this specific forwarded upgrade. */
export function signUpgradePeer(address: string, key: string | string[] | undefined, secret: string | undefined) {
  // SSH_WS_SECRET is trimmed the same way on both sides (config.ssh.wsSecret): the web tier signs, the gateway verifies.
  const hmacKey = secret?.trim();
  return hmacKey && typeof key === "string" && isIP(address)
    ? createHmac("sha256", hmacKey).update(JSON.stringify([address, key])).digest("hex") : undefined;
}

/** The client address of an upgrade request, resolved the way HTTP rate limits resolve it (trusted proxy hops). */
export function upgradeClientAddress(req: Pick<IncomingMessage, "headers"> & { socket?: Pick<IncomingMessage["socket"], "remoteAddress"> }): string {
  if (config.http.trustedProxyHops === 0) {
    const peer = req.socket?.remoteAddress ?? "";
    const forwarded = req.headers[PEER_ADDRESS_HEADER];
    if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) && typeof forwarded === "string") {
      const signature = req.headers[PEER_SIGNATURE_HEADER];
      const expected = signUpgradePeer(forwarded, req.headers["sec-websocket-key"], config.ssh.wsSecret);
      if (expected && typeof signature === "string" && /^[a-f0-9]{64}$/.test(signature)
        && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return forwarded;
    }
    return isIP(peer) ? peer : "unknown";
  }
  const headers = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"] as const) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  return getClientIp({ headers } as Request);
}
