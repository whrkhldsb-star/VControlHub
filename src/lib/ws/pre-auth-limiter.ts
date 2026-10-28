import type { IncomingMessage } from "node:http";
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

/** The client address of an upgrade request, resolved the way HTTP rate limits resolve it (trusted proxy hops). */
export function upgradeClientAddress(req: Pick<IncomingMessage, "headers">): string {
  const headers = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"] as const) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  return getClientIp({ headers } as Request);
}
