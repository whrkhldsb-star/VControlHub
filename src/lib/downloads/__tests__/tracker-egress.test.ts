// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ dns: vi.fn(), outbound: vi.fn() }));
vi.mock("node:dns/promises", async original => ({ ...await original<typeof import("node:dns/promises")>(), lookup: io.dns }));
vi.mock("undici", async original => ({ ...await original<typeof import("undici")>(), request: io.outbound }));
import { prepareTrackerEgress } from "../tracker-egress";

beforeEach(() => { vi.stubEnv("ARIA2_RPC_SECRET", "tracker-fixture-rpc-secret"); });
afterEach(() => { vi.unstubAllEnvs(); });

const uri = (trackers: string[]) => "magnet:?xt=urn:btih:" + "1".repeat(40) + trackers.map(tr => "&tr=" + encodeURIComponent(tr)).join("");
function emptyTrackerReply() {
  return {
    statusCode: 200,
    body: Object.assign((async function* () { yield Buffer.from("d8:intervali600e5:peers0:e"); })(), { on() {} }),
  };
}

it("pins UDP announces and rechecks DNS at HTTP announce time", async () => {
  io.dns.mockResolvedValueOnce([{ address: "93.184.216.34" }]).mockResolvedValueOnce([{ address: "10.1.2.3" }]);
  const policy = await prepareTrackerEgress([uri(["udp://announce.example.org:80/a", "http://tracker.example.org/a"])]);
  try {
    expect(policy.uris[0]).not.toContain("tr=");
    const trackers = policy.options["bt-tracker"].split(",");
    expect(trackers[0]).toBe("udp://93.184.216.34:80/a");
    expect((await fetch(trackers[1]! + "?event=started")).status).toBe(502);
    expect(io.outbound).not.toHaveBeenCalled();
    expect(policy.options["bt-exclude-tracker"]).toBe("*");
  } finally { policy.close(); }
});

it.skipIf(process.platform !== "linux")("accepts callbacks only from the configured external RPC peer", async () => {
  // Two loopback addresses exercise separate transport peers without any network egress.
  const rpcHost = "127.0.0.2";
  const rpc = createServer();
  rpc.listen(0, rpcHost);
  await once(rpc, "listening");
  try {
    const policy = await prepareTrackerEgress([uri(["https://tracker.example.org/announce"])], {
      rpcHost, rpcPort: (rpc.address() as AddressInfo).port,
    });
    try {
      io.outbound.mockClear().mockImplementation(emptyTrackerReply);
      io.dns.mockResolvedValue([{ address: "93.184.216.34" }]);
      const callback = policy.options["bt-tracker"];
      expect((await fetch(callback)).status).toBe(404);
      expect(io.outbound).not.toHaveBeenCalled();
      const status = await new Promise<number | undefined>((resolve, reject) => {
        get(callback, { localAddress: rpcHost }, res => { res.resume(); resolve(res.statusCode); }).on("error", reject);
      });
      expect(status).toBe(200);
      expect(io.outbound).toHaveBeenCalledOnce();
    } finally { policy.close(); }
  } finally { rpc.close(); rpc.closeAllConnections(); }
});

const hasAria2 = process.platform === "linux" && spawnSync("aria2c", ["-v"], { stdio: "ignore" }).status === 0;
it.skipIf(!hasAria2)("aria2 uses only the approved tracker when a magnet loads torrent metadata", async () => {
  // Both tracker endpoints and the daemon are local fixtures. The outbound HTTP adapter returns an empty peer list.
  const hidden = vi.fn();
  const server = createServer((_req, res) => { hidden(); res.end("d8:intervali600e5:peers0:e"); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const tracker = "http://127.0.0.1:" + port + "/metadata";
  const info = Buffer.concat([Buffer.from("d6:lengthi1e4:name7:fixture12:piece lengthi16384e6:pieces20:"), Buffer.alloc(20), Buffer.from("e")]);
  const hash = createHash("sha1").update(info).digest("hex");
  const torrent = Buffer.concat([Buffer.from(`d8:announce${tracker.length}:${tracker}4:info`), info, Buffer.from("e")]);
  const directory = await mkdtemp(join(tmpdir(), "tracker-egress-"));
  const policy = await prepareTrackerEgress([uri(["http://tracker.example.org/announce"]).replace("1".repeat(40), hash)]);
  io.dns.mockResolvedValue([{ address: "93.184.216.34" }]);
  io.outbound.mockClear().mockImplementation(emptyTrackerReply);
  try {
    await writeFile(join(directory, hash + ".torrent"), torrent);
    const child = spawn("aria2c", ["--no-conf", "--interface=lo", "--enable-dht=false", "--enable-dht6=false",
      "--enable-peer-exchange=false", "--bt-enable-lpd=false", "--bt-load-saved-metadata=true", "--dir=" + directory,
      "--bt-exclude-tracker=" + policy.options["bt-exclude-tracker"], "--bt-tracker=" + policy.options["bt-tracker"], policy.uris[0]!], { stdio: "ignore" });
    const closed = once(child, "close");
    try {
      await vi.waitFor(() => expect(io.outbound).toHaveBeenCalled(), { timeout: 6000 });
      expect(new URL(io.outbound.mock.calls[0]![0]).hostname).toBe("tracker.example.org");
      expect(hidden).not.toHaveBeenCalled();
    } finally { child.kill("SIGKILL"); await closed; }
  } finally { policy.close(); server.close(); server.closeAllConnections(); await rm(directory, { recursive: true, force: true }); }
});
