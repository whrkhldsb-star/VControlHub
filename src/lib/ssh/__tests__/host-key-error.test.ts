// @vitest-environment node
import { once } from "node:events";
import { Client, Server, utils } from "ssh2";
import { describe, expect, it } from "vitest";
import { isHostKeyRejection } from "../host-key-error";

describe("isHostKeyRejection", () => {
  it("recognises what ssh2 actually reports when the host key verifier refuses the server", async () => {
    // Real handshake against a real ssh2 server: the wording is ssh2's, not ours, and has to be matched as is.
    // The client walks away mid key exchange; the server side reports that as an error of its own.
    const server = new Server({ hostKeys: [utils.generateKeyPairSync("ed25519").private] }, (connection) => {
      connection.on("error", () => undefined);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as { port: number };
    const client = new Client();
    try {
      const refusal = await new Promise<Error>((resolve) => {
        client.once("error", resolve);
        client.connect({ host: "127.0.0.1", port, username: "u", password: "p", hostVerifier: () => false, readyTimeout: 5_000 });
      });
      expect(refusal.message).toMatch(/host denied/i);
      expect(isHostKeyRejection(refusal)).toBe(true);
    } finally {
      client.end();
      server.close();
    }
  });

  it("keeps the older wordings, and does not mistake other failures for a refused key", () => {
    expect(isHostKeyRejection(new Error("(Handshake failed) Host key verification failed"))).toBe(true);
    expect(isHostKeyRejection("host verifier rejected")).toBe(true);
    expect(isHostKeyRejection(new Error("All configured authentication methods failed"))).toBe(false);
    expect(isHostKeyRejection(new Error("connect ECONNREFUSED 127.0.0.1:22"))).toBe(false);
  });
});
