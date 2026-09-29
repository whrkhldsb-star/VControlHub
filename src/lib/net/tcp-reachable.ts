import { connect } from "node:net";

export type TcpReachableResult = {
  reachable: boolean;
  /** Round-trip of the successful connect only; null on failure/timeout. */
  latencyMs: number | null;
};

/**
 * One plain TCP connect against host:port, raced against a timeout.
 *
 * Used by the RDP reachability probe (and testable through this seam — the
 * browser cannot open cross-origin raw TCP, and mocking node:net at module
 * level proved unreliable under vitest). No data is sent and the socket is
 * destroyed as soon as the outcome is known.
 */
export function probeTcpReachable(input: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<TcpReachableResult> {
  const { host, port, timeoutMs = 5_000 } = input;
  const startedAt = Date.now();
  return new Promise<TcpReachableResult>((resolve) => {
    const socket = connect({ host, port });
    const finish = (reachable: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        reachable,
        latencyMs: reachable ? Date.now() - startedAt : null,
      });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
