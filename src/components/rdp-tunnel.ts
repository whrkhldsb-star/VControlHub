import type * as Guacamole from "guacamole-common-js";

/** How the bridge is pinged, and how much later than due a timer means the page itself stood still. */
const PING_INTERVAL_MS = 5_000;
const LATE_TIMER_MS = 5_000;

export type RdpTunnel = Guacamole.Tunnel & {
  /** Sends the frame answer held while the desktop was not shown; call it once it is. */
  releaseSync(): void;
};

/**
 * The bridge authenticates with a first-frame ticket, NOT URL query data.
 * `onLatency` gets the round trip to the bridge, in ms, each time it echoes one
 * of this tunnel's keep-alive pings: queueing included, so it shows a slow or
 * congested path, not the hub-to-Windows leg. `shown` says whether the desktop
 * is on screen (a workbench tab not selected, or minimized, is not).
 */
export function createRdpTunnel(G: typeof Guacamole, url: string, onLatency?: (ms: number) => void, shown: () => boolean = () => true): RdpTunnel {
  class TicketTunnel extends G.Tunnel {
    releaseSync = () => {};
    constructor() {
      super();
      let socket: WebSocket | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let pingInterval: ReturnType<typeof setInterval> | undefined;
      let handshaken = false;
      // The pings this tunnel sent (each carries its send time): the bridge's
      // own pings carry its clock's time and must not be read as echoes.
      const pings = new Set<string>();
      let lastPingAt = 0;
      const ping = () => {
        const now = Date.now();
        // The page was frozen or asleep since the last ping: echoes of the
        // pings sent before would report that pause as latency.
        if (lastPingAt && now - lastPingAt > PING_INTERVAL_MS + LATE_TIMER_MS) pings.clear();
        lastPingAt = now;
        const id = String(now);
        pings.add(id);
        for (const old of [...pings].slice(0, -8)) pings.delete(old);
        this.sendMessage("", "ping", id);
      };
      // While the desktop is not on screen (its tab hidden, or another
      // workbench tab selected), the browser's answers that it drew a frame
      // ("sync") wait here: the gateway stops sending once frames go
      // unanswered for 1.5 s, so a desktop nobody can see neither decodes
      // images in the background — which gets the tab frozen — nor takes the
      // downlink from the desktop on screen. Shown again, the latest answer
      // goes out and the desktop catches up at once.
      let heldSync: string | undefined;
      const hidden = () => !shown() || (typeof document !== "undefined" && document.visibilityState === "hidden");
      const releaseSync = () => {
        if (hidden() || heldSync === undefined) return;
        const timestamp = heldSync;
        heldSync = undefined;
        this.sendMessage("sync", timestamp);
      };
      const state = (next: Guacamole.Tunnel.State) => {
        this.state = next;
        this.onstatechange?.(next);
      };
      const close = () => {
        clearTimeout(timeout);
        clearInterval(pingInterval);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", releaseSync);
        if (socket) {
          socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
          socket.close();
          socket = undefined;
        }
        if (this.state !== G.Tunnel.State.CLOSED) state(G.Tunnel.State.CLOSED);
      };
      const fail = () => {
        this.onerror?.(new G.Status(512, "RDP connection unavailable"));
        close();
      };
      // One timeout covers both phases: 35s to finish the bridge handshake
      // (NLA against a slow domain controller can take a while), then a 30s
      // receive timeout that only a dead gateway can let expire — the bridge
      // pings every 5s even while the desktop is idle.
      //
      // A timer that fires well after it was due means this page stood still:
      // Chrome freezes a background tab that keeps decoding a desktop after
      // about five minutes hidden, and a laptop sleeps. The silence was then
      // the page's own, the gateway kept the session, and what it sent
      // meanwhile is still queued in the socket: one more window for it,
      // instead of dropping the desktop and reconnecting.
      const armTimeout = () => {
        clearTimeout(timeout);
        const limit = this.state === G.Tunnel.State.OPEN ? 30_000 : 35_000;
        const due = Date.now() + limit;
        timeout = setTimeout(() => (Date.now() - due > LATE_TIMER_MS ? armTimeout() : fail()), limit);
      };
      this.disconnect = close;
      this.releaseSync = releaseSync;
      this.connect = (ticket = "") => {
        state(G.Tunnel.State.CONNECTING);
        const parser = new G.Parser();
        parser.oninstruction = (opcode, args) => {
          if (opcode === "" && !handshaken) {
            // Only the first internal instruction is the tunnel UUID; later
            // ones are ping echoes from the bridge's keep-alive.
            if (args.length !== 1) { fail(); return; }
            this.uuid = String(args[0] ?? "");
            handshaken = true;
            state(G.Tunnel.State.OPEN);
            armTimeout();
            ping();
            pingInterval = setInterval(ping, PING_INTERVAL_MS);
          } else {
            const echo = opcode === "" && args[0] === "ping" ? String(args[1]) : "";
            if (pings.delete(echo)) onLatency?.(Math.max(0, Date.now() - Number(echo)));
            // Ping echoes still reach the Guacamole client: it reschedules its
            // own guacd nop keep-alive on network activity, which keeps
            // background tabs (throttled timers) from going silent.
            this.oninstruction?.(opcode, [...args]);
          }
        };
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", releaseSync);
        socket = new WebSocket(url, "guacamole");
        socket.onopen = () => { socket?.send(ticket); ticket = ""; };
        socket.onmessage = event => {
          if (typeof event.data !== "string") { fail(); return; }
          armTimeout();
          try { parser.receive(event.data); } catch { fail(); }
        };
        socket.onerror = fail;
        socket.onclose = () => { if (this.state === G.Tunnel.State.CONNECTING) fail(); else close(); };
        armTimeout();
      };
      this.sendMessage = (...elements: (string | number)[]) => {
        if (this.state !== G.Tunnel.State.OPEN || socket?.readyState !== WebSocket.OPEN) return;
        if (elements[0] === "sync" && hidden()) { heldSync = String(elements[1]); return; }
        socket.send(elements.map(value => {
          const text = String(value);
          return `${Array.from(text).length}.${text}`;
        }).join(",") + ";");
      };
    }
  }
  return new TicketTunnel();
}

/**
 * The bridge address. `size` is the desktop area the session should start
 * at (not a secret, unlike the ticket, which travels in the first frame).
 */
export function rdpWebSocketUrl(location: Pick<Location, "protocol" | "host">, size?: { width: number; height: number } | null): string {
  const base = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rdp`;
  return size ? `${base}?width=${size.width}&height=${size.height}` : base;
}

export function rdpTicketError(status: number): string {
  if (status === 401) return "rdp.error.session";
  if (status === 403 || status === 404) return "rdp.error.denied";
  if (status === 429) return "rdp.error.rate";
  return "rdp.error.connection";
}
