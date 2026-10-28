import type { WebSocket } from "ws";

/** How long a closing socket may take to answer the close handshake before it is dropped. */
export const CLOSE_HANDSHAKE_GRACE_MS = 3_000;

/**
 * Close a WebSocket, then drop it if the other side does not answer the close frame.
 *
 * `ws.close()` alone waits for the peer's close frame for up to 30 seconds, and the socket stays in the
 * server's client list (and counts against its connection limits) the whole time, so a client that simply
 * never answers could hold a slot long after it was refused.
 */
export function closeSocket(ws: WebSocket, ...args: Parameters<WebSocket["close"]>): void {
  ws.close(...args);
  const timer = setTimeout(() => {
    try { ws.terminate(); } catch { /* already gone */ }
  }, CLOSE_HANDSHAKE_GRACE_MS);
  timer.unref?.();
}
