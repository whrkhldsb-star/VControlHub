// @vitest-environment node
import { createHash, generateKeyPairSync } from "node:crypto";
import { Server, utils, type Connection } from "ssh2";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeSshPool, execRemoteCommand, type SshConnectionParams } from "../client";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
const parsed = utils.parseKey(privateKey);
if (parsed instanceof Error || Array.isArray(parsed)) throw new Error("Invalid fixture host key");
const hostKeySha256 = createHash("sha256").update(parsed.getPublicSSH()).digest("base64").replace(/=+$/, "");
const connections = new Set<Connection>();
const timers = new Set<ReturnType<typeof setTimeout>>();
let connection: SshConnectionParams;
let password = "fixture-password";
const later = (callback: () => void, ms: number) => {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
  timers.add(timer);
};
const server = new Server({ hostKeys: [privateKey] }, (client) => {
  connections.add(client);
  client.on("error", () => undefined);
  client.on("close", () => connections.delete(client));
  client.on("authentication", (context) => {
    if (context.method === "password" && context.username === "fixture" && context.password === password) context.accept();
    else context.reject();
  });
  client.on("ready", () => client.on("session", (accept) => {
    const session = accept();
    session.on("exec", (acceptExec, _reject, info) => {
      if (info.command === "delayed-open") {
        later(() => {
          const channel = acceptExec();
          channel.on("error", () => undefined);
        }, 200);
        return;
      }
      const channel = acceptExec();
      channel.on("error", () => undefined);
      if (info.command === "hold") return;
      if (info.command === "drop") {
        channel.write("partial");
        later(() => client.end(), 30);
        return;
      }
      if (info.command === "unicode") {
        const bytes = Buffer.from("中文结果");
        channel.write(bytes.subarray(0, 1));
        channel.stderr.write(bytes.subarray(0, 2));
        later(() => {
          channel.write(bytes.subarray(1));
          channel.stderr.write(bytes.subarray(2));
          channel.exit(0); channel.end();
        }, 100);
        return;
      }
      later(() => { channel.write("completed"); channel.exit(0); channel.end(); }, info.command === "slow" ? 300 : 10);
    });
  }));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  connection = { host: "127.0.0.1", port: (server.address() as { port: number }).port, username: "fixture", password, hostKeySha256 };
});
afterEach(async () => {
  await closeSshPool();
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const client of connections) client.end();
  password = "fixture-password";
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("SSH real protocol boundaries", () => {
  it("cancels one channel without interrupting another pooled command", async () => {
    await execRemoteCommand({ ...connection, command: "warm" });
    const controller = new AbortController();
    const held = execRemoteCommand({ ...connection, command: "hold", signal: controller.signal });
    const result = Promise.allSettled([held, execRemoteCommand({ ...connection, command: "slow" })]);
    later(() => controller.abort(), 100);
    expect(await result).toMatchObject([
      { status: "rejected", reason: { name: "AbortError" } },
      { status: "fulfilled", value: { stdout: "completed", exitCode: 0 } },
    ]);
    expect(await execRemoteCommand({ ...connection, command: "next" })).toMatchObject({ exitCode: 0 });
  });

  it("rejects pre-cancelled work and closes a channel opened after cancellation", async () => {
    await expect(execRemoteCommand({ ...connection, command: "hold", signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    await execRemoteCommand({ ...connection, command: "warm" });
    const controller = new AbortController();
    const result = expect(execRemoteCommand({ ...connection, command: "delayed-open", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    later(() => controller.abort(), 30);
    await result;
    expect(await execRemoteCommand({ ...connection, command: "slow" })).toMatchObject({ exitCode: 0 });
  });

  it("keeps a concurrent channel alive when one command times out", async () => {
    await execRemoteCommand({ ...connection, command: "warm" });
    const results = await Promise.allSettled([
      execRemoteCommand({ ...connection, command: "hold", timeout: 150 }),
      execRemoteCommand({ ...connection, command: "slow", timeout: 1500 }),
    ]);
    expect(results[0]).toMatchObject({ status: "rejected", reason: { message: "Command timed out after 0.15s" } });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { stdout: "completed", exitCode: 0 } });
  });

  it("decodes multibyte stdout and stderr across transport packets", async () => {
    expect(await execRemoteCommand({ ...connection, command: "unicode" })).toMatchObject({ stdout: "中文结果", stderr: "中文结果", exitCode: 0 });
  });

  it("rejects disconnected commands and can establish a new connection afterwards", async () => {
    await expect(execRemoteCommand({ ...connection, command: "drop", timeout: 1000 })).rejects.toThrow(/closed|disconnect/i);
    expect(await execRemoteCommand({ ...connection, command: "next" })).toMatchObject({ stdout: "completed", exitCode: 0 });
  });

  it("uses new credentials after a rejected password and rejects a changed host key", async () => {
    await expect(execRemoteCommand({ ...connection, password: "obsolete", command: "warm" })).rejects.toThrow();
    password = "rotated-password";
    expect(await execRemoteCommand({ ...connection, password, command: "warm" })).toMatchObject({ exitCode: 0 });
    await expect(execRemoteCommand({ ...connection, password, hostKeySha256: "unapproved-host", command: "warm" })).rejects.toThrow(/host|verification/i);
  });
});
