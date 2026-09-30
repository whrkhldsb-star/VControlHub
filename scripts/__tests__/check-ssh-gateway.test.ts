// @vitest-environment node
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { afterEach, expect, it } from "vitest";

const servers: Server[] = [];
const gateways: WebSocketServer[] = [];
const origin = "https://console.example.test";

afterEach(async () => {
  for (const gateway of gateways.splice(0)) { for (const client of gateway.clients) client.terminate(); gateway.close(); }
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

async function start(mode: "good" | "wrong-origin" | "no-auth" | "tcp-only") {
  const server = createServer((_request, response) => { response.writeHead(204); response.end(); });
  servers.push(server);
  const gateway = new WebSocketServer({ noServer: true });
  gateways.push(gateway);
  server.on("upgrade", (request, socket, head) => {
    if (mode === "tcp-only") { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    if (mode !== "wrong-origin" && request.headers.origin !== origin) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    gateway.handleUpgrade(request, socket, head, ws => {
      if (mode === "no-auth") ws.send(JSON.stringify({ type: "connected" }));
      else ws.send(JSON.stringify({ type: "error", data: "Missing authentication" }));
      ws.close();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

async function run(url: string, configuredOrigin = origin) {
  const child = spawn(process.execPath, ["scripts/check-ssh-gateway.mjs"], {
    cwd: process.cwd(), env: { ...process.env, SSH_GATEWAY_CHECK_URL: url, SSH_WS_ALLOWED_ORIGINS: configuredOrigin, SSH_GATEWAY_CHECK_WAIT_MS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const [code] = await once(child, "close");
  return { code, output };
}

it("checks actual WebSocket upgrades and both authentication boundaries without opening SSH", async () => {
  const result = await run(await start("good"));
  expect(result.code).toBe(0);
  expect(result.output).toContain("passed WebSocket routing");
});

it("accepts an origin with the casing that the gateway already normalizes", async () => {
  expect((await run(await start("good"), origin.toUpperCase())).code).toBe(0);
});

it.each(["wrong-origin", "no-auth", "tcp-only"] as const)("rejects a listening but broken %s gateway", async mode => {
  const result = await run(await start(mode));
  expect(result.code).toBe(1);
  expect(result.output).not.toContain("passed WebSocket routing");
});
