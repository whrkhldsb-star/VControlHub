import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { createConnection, isIP, type AddressInfo } from "node:net";
import { request } from "undici";
import { getAria2RuntimeConfig, type Aria2RuntimeConfig } from "@/lib/aria2/service";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";
import { pinnedDownloadAgent } from "./redirect-chain";
import { isMagnetLink } from "./helpers";
import { sanitizeMagnetLink } from "./source-url";

async function publicAddress(host: string) {
  const hostname = host.replace(/^\[|\]$/g, "");
  const answers = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(answer => !isIP(answer.address) || isBlockedIpAddress(answer.address))) {
    throw new Error("Tracker address unavailable");
  }
  return { hostname, address: answers[0]!.address };
}

type RpcEndpoint = Pick<Aria2RuntimeConfig, "rpcHost" | "rpcPort">;

// For an external RPC host, listen only on the worker interface used to reach
// that daemon. Accept callbacks only from its address. A loopback RPC stays local.
async function trackerCallbackBinding(rpc: RpcEndpoint) {
  const host = rpc.rpcHost.replace(/^\[|\]$/g, "");
  if (host === "127.0.0.1" || host === "localhost") return { local: "127.0.0.1", peer: "127.0.0.1" };
  if (host === "::1") return { local: host, peer: host };
  const socket = createConnection({ host, port: rpc.rpcPort, signal: AbortSignal.timeout(5000) });
  try {
    await once(socket, "connect");
    if (!socket.localAddress || !socket.remoteAddress) throw new Error("Cannot locate tracker callback interface");
    return { local: socket.localAddress, peer: socket.remoteAddress };
  } finally { socket.destroy(); }
}

/**
 * aria2 resolves tracker names independently, including names in torrent metadata.
 * Supply only explicit trackers. UDP announces go to a checked numeric address.
 * For HTTP(S), forward each announce on a pinned socket, retaining Host and TLS SNI.
 * Each local endpoint identifies one fixed tracker and accepts only a query string.
 */
export async function prepareTrackerEgress(uris: string[], rpc?: RpcEndpoint) {
  const http = new Map<string, URL>();
  const trackers = new Set<string>();
  const magnets: string[] = [];
  for (const uri of uris) {
    if (!isMagnetLink(uri)) { magnets.push(uri); continue; }
    const magnet = new URL(sanitizeMagnetLink(uri).url);
    for (const [key, value] of [...magnet.searchParams]) {
      if (!/^tr(?:\.\d+)?$/i.test(key)) continue;
      magnet.searchParams.delete(key);
      const tracker = URL.canParse(value) ? new URL(value) : null;
      if (!tracker || tracker.username || tracker.password) continue;
      if (tracker.protocol === "udp:") {
        const pinned = await publicAddress(tracker.hostname).catch(() => null);
        if (!pinned) continue;
        tracker.hostname = isIP(pinned.address) === 6 ? `[${pinned.address}]` : pinned.address;
        // aria2's option is comma-separated. A tracker cannot append another URI.
        trackers.add(tracker.href.replaceAll(",", "%2C"));
      } else if (tracker.protocol === "http:" || tracker.protocol === "https:") {
        http.set("/" + randomUUID(), tracker);
      }
    }
    magnets.push(magnet.href);
  }
  const binding = http.size ? await trackerCallbackBinding(rpc ?? getAria2RuntimeConfig()) : null;
  const server = createServer(async (req, res) => {
    const [route] = (req.url ?? "").split("?", 1);
    const tracker = route && http.get(route);
    if (!tracker || req.method !== "GET" || req.socket.remoteAddress !== binding?.peer) {
      res.writeHead(404).end();
      return;
    }
    try {
      const resolution = await publicAddress(tracker.hostname);
      const agent = pinnedDownloadAgent(resolution);
      try {
        const url = new URL(tracker);
        const query = req.url!.slice(route.length + 1);
        if (query) url.search += (url.search ? "&" : "?") + query;
        const response = await request(url, { dispatcher: agent, method: "GET", signal: AbortSignal.timeout(15_000) });
        // Never forward Location or response headers. Only a bounded tracker reply is accepted.
        response.body.on("error", () => {});
        if (response.statusCode !== 200) throw new Error("Tracker announce failed");
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) throw new Error("Tracker reply too large");
          chunks.push(chunk);
        }
        res.writeHead(200).end(Buffer.concat(chunks));
      } finally { await agent.destroy(); }
    } catch { res.writeHead(502).end(); }
  });
  if (binding) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, binding.local, resolve);
    });
    server.unref();
    const { port } = server.address() as AddressInfo;
    const address = isIP(binding.local) === 6 ? `[${binding.local}]` : binding.local;
    for (const key of http.keys()) trackers.add(`http://${address}:${port}${key}`);
  }
  return {
    uris: magnets,
    options: { "bt-exclude-tracker": "*", "bt-tracker": [...trackers].join(",") },
    close() { if (server.listening) { server.close(); server.closeAllConnections(); } },
  };
}
