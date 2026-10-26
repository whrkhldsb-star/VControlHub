/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeCommandWithAgent: vi.fn() }));
vi.mock("@/lib/server/agent-service", () => ({ executeCommandWithAgent: mocks.executeCommandWithAgent }));

import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { deleteRemoteFile, listRemoteDirectory, readRemoteFile, statRemoteEntry, writeRemoteFile } from "../client";

describe("Agent-only file fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists files through an Agent job without SSH credentials", async () => {
    mocks.executeCommandWithAgent.mockResolvedValueOnce({
      stdout: JSON.stringify([{ name: "report.txt", longname: "report.txt", type: "file", size: 12, modifyTime: 1, accessTime: 1 }]),
      stderr: "",
      exitCode: 0,
    });

    await expect(listRemoteDirectory({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      agentServerId: "srv_agent",
      remotePath: "/data",
    })).resolves.toEqual([expect.objectContaining({ name: "report.txt", type: "file" })]);
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledWith(expect.objectContaining({ serverId: "srv_agent" }));
  });

  it("reads a small file through Agent only after checking its size", async () => {
    mocks.executeCommandWithAgent
      .mockResolvedValueOnce({ stdout: "5\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: Buffer.from("hello").toString("base64"),
        stderr: "",
        exitCode: 0,
      });

    await expect(readRemoteFile({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      agentServerId: "srv_agent",
      remotePath: "/data/hello.txt",
    })).resolves.toEqual(Buffer.from("hello"));
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledTimes(2);
  });

  it("rejects large Agent-only reads before transferring file content", async () => {
    mocks.executeCommandWithAgent.mockResolvedValueOnce({
      stdout: String(6 * 1_048_576),
      stderr: "",
      exitCode: 0,
    });

    await expect(readRemoteFile({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      agentServerId: "srv_agent",
      remotePath: "/data/large.bin",
    })).rejects.toThrow(/5 MB/);
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledTimes(1);
  });

  it("identifies and removes an empty directory through Agent without SSH credentials", async () => {
    mocks.executeCommandWithAgent
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ mode: 16877, size: 4096, type: "directory", modifyTime: 1, accessTime: 1 }),
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    const connection = {
      host: "203.0.113.10",
      port: 22,
      username: "root",
      agentServerId: "srv_agent",
    };

    await expect(statRemoteEntry({ ...connection, remotePath: "/data/empty" })).resolves.toMatchObject({
      type: "directory",
    });
    await expect(deleteRemoteFile({ ...connection, remotePath: "/data/empty", isDirectory: true })).resolves.toBeUndefined();
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledTimes(2);
  });

  it("writes a file larger than one shell argument allows, keeping the target's mode (C-1)", async () => {
    // The Agent runs `sh -c <command>`; Linux caps one argument at 128 KiB.
    // Run every command as the Agent would, through a real shell.
    mocks.executeCommandWithAgent.mockImplementation(({ command }: { command: string }) => new Promise((resolve) => {
      execFile("/bin/sh", ["-c", command], { maxBuffer: 16 * 1_048_576 }, (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "E2BIG") resolve(null);
        else resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: error ? Number((error as { code?: number }).code) || 1 : 0 });
      });
    }));
    const dir = await mkdtemp(path.join(tmpdir(), "vch-agent-write-"));
    try {
      const target = path.join(dir, "big.bin");
      await writeFile(target, "old");
      await chmod(target, 0o640);
      const content = randomBytes(300 * 1024);
      await writeRemoteFile({ host: "203.0.113.10", port: 22, username: "root", agentServerId: "srv_agent", remotePath: target, content });
      expect(Buffer.compare(await readFile(target), content)).toBe(0);
      expect((await stat(target)).mode & 0o777).toBe(0o640);
      for (const [{ command }] of mocks.executeCommandWithAgent.mock.calls as Array<[{ command: string }]>) {
        expect(Buffer.byteLength(command)).toBeLessThan(128 * 1024);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
