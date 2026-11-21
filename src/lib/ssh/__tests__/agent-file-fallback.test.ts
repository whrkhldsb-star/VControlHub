/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeCommandWithAgent: vi.fn() }));
vi.mock("@/lib/server/agent-service", () => ({ executeCommandWithAgent: mocks.executeCommandWithAgent }));

import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { AGENT_FILE_MAX_BYTES, deleteRemoteFile, execRemoteCommand, listRemoteDirectory, readRemoteFile, renameRemoteFile, statRemoteEntry, writeRemoteFile } from "../client";

describe("Agent-only file fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("a command run through the Agent", () => {
    const target = { host: "203.0.113.10", port: 22, username: "root", agentServerId: "srv_agent" };

    it("returns a non-zero exit status to the caller, as a command over SSH does", async () => {
      // `grep` exits 1 for "no match" and a probe may answer with its status:
      // thrown, these answers were failures on Agent-only servers.
      mocks.executeCommandWithAgent.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 });
      await expect(execRemoteCommand({ ...target, command: "grep -r needle /data" })).resolves.toEqual({ stdout: "", stderr: "", exitCode: 1 });
      mocks.executeCommandWithAgent.mockResolvedValueOnce({ stdout: "partial", stderr: "docker: 'compose' is not a docker command.", exitCode: 125 });
      await expect(execRemoteCommand({ ...target, command: "docker compose ps" })).resolves.toEqual({ stdout: "partial", stderr: "docker: 'compose' is not a docker command.", exitCode: 125 });
    });

    it("still fails when the Agent is offline, and aborts when the caller cancelled", async () => {
      mocks.executeCommandWithAgent.mockResolvedValueOnce(null);
      await expect(execRemoteCommand({ ...target, command: "true" })).rejects.toThrow();
      const controller = new AbortController();
      mocks.executeCommandWithAgent.mockImplementationOnce(async () => {
        controller.abort();
        return { stdout: "", stderr: "Agent job cancelled", exitCode: 130, cancelled: true };
      });
      await expect(execRemoteCommand({ ...target, command: "sleep 60", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });

    it("keeps a failed file operation an error", async () => {
      mocks.executeCommandWithAgent.mockResolvedValueOnce({ stdout: "", stderr: "FileNotFoundError: /data/missing", exitCode: 1 });
      await expect(statRemoteEntry({ ...target, remotePath: "/data/missing" })).rejects.toThrow(/FileNotFoundError/);
    });
  });

  it("lists files through an Agent job without SSH credentials", async () => {
    mocks.executeCommandWithAgent.mockResolvedValueOnce({
      stdout: JSON.stringify({ total: 1, entries: [{ name: "report.txt", longname: "report.txt", type: "file", size: 12, modifyTime: 1, accessTime: 1 }] }),
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

  it("fails a listing the Agent had to cut short when the caller acts on what is missing, and returns it otherwise", async () => {
    const cut = { stdout: JSON.stringify({ total: 25_000, entries: [{ name: "a", longname: "a", type: "file", size: 1, modifyTime: 1, accessTime: 1 }] }), stderr: "", exitCode: 0 };
    const target = { host: "203.0.113.10", port: 22, username: "root", agentServerId: "srv_agent", remotePath: "/data" };
    // A sync or stale-entry check soft-deletes every indexed entry missing from the list.
    mocks.executeCommandWithAgent.mockResolvedValueOnce(cut);
    await expect(listRemoteDirectory({ ...target, requireComplete: true })).rejects.toThrow(/10000|10,000/);
    // Browsing may show the first page.
    mocks.executeCommandWithAgent.mockResolvedValueOnce(cut);
    await expect(listRemoteDirectory(target)).resolves.toHaveLength(1);
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
      stdout: String(AGENT_FILE_MAX_BYTES + 1),
      stderr: "",
      exitCode: 0,
    });

    await expect(readRemoteFile({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      agentServerId: "srv_agent",
      remotePath: "/data/large.bin",
    })).rejects.toThrow(/6 MB/);
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledTimes(1);
  });

  it("honors a preview's smaller limit before fetching the content", async () => {
    mocks.executeCommandWithAgent.mockResolvedValueOnce({ stdout: "11", exitCode: 0 });
    await expect(readRemoteFile({ host: "fixture", port: 22, username: "ops", agentServerId: "srv_agent", remotePath: "/file", maxBytes: 10 })).rejects.toThrow(/在线读取|online reading/);
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledTimes(1);
  });

  it("reads all bytes at the maximum upload size and rejects the next byte before upload", async () => {
    const target = { host: "fixture", port: 22, username: "ops", agentServerId: "srv_agent", remotePath: "/file" };
    const bytes = randomBytes(AGENT_FILE_MAX_BYTES);
    mocks.executeCommandWithAgent
      .mockResolvedValueOnce({ stdout: String(bytes.length), exitCode: 0 })
      .mockResolvedValueOnce({ stdout: bytes.toString("base64"), exitCode: 0 });
    expect((await readRemoteFile(target)).equals(bytes)).toBe(true);
    await expect(writeRemoteFile({ ...target, content: Buffer.alloc(bytes.length + 1) })).rejects.toThrow(/6 MB/);
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledTimes(2);
  });

  it.each(["four", "longer"])("rejects an incomplete or changed Agent read (%s)", async (read) => {
    mocks.executeCommandWithAgent
      .mockResolvedValueOnce({ stdout: "5", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: Buffer.from(read).toString("base64"), exitCode: 0 });
    await expect(readRemoteFile({ host: "fixture", port: 22, username: "ops", agentServerId: "srv_agent", remotePath: "/file" })).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("the Agent-only rmdir refuses unindexed members and distinguishes a missing directory", async () => {
    mocks.executeCommandWithAgent.mockImplementation(({ command }: { command: string }) => new Promise(resolve => {
      execFile("/bin/sh", ["-c", command], (error, stdout, stderr) => resolve({ stdout, stderr, exitCode: error ? 1 : 0 }));
    }));
    const dir = await mkdtemp(path.join(tmpdir(), "agent-rmdir-"));
    const input = { host: "fixture", port: 22, username: "ops", agentServerId: "agent", remotePath: dir };
    const remove = () => deleteRemoteFile({ ...input, isDirectory: true, emptyOnly: true });
    try {
      await writeFile(path.join(dir, "new"), "retain");
      await expect(remove()).rejects.toMatchObject({ code: "ENOTEMPTY" });
      expect(await readFile(path.join(dir, "new"), "utf8")).toBe("retain");
      await rm(path.join(dir, "new"));
      await remove();
      await expect(remove()).rejects.toMatchObject({ code: "ENOENT" });
      await expect(listRemoteDirectory(input)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(dir, { recursive: true, force: true }); }
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

  it.skipIf(process.platform === "win32")("preserves both files at an occupied no-replace rename destination", async () => {
    mocks.executeCommandWithAgent.mockImplementation(({ command }: { command: string }) => new Promise(resolve => {
      execFile("/bin/sh", ["-c", command], (error, stdout, stderr) => resolve({ stdout, stderr, exitCode: error ? 1 : 0 }));
    }));
    const dir = await mkdtemp(path.join(tmpdir(), "agent-exclusive-"));
    try {
      const source = path.join(dir, "source");
      const destination = path.join(dir, "destination");
      await writeFile(source, "source");
      await writeFile(destination, "unindexed");
      const move = () => renameRemoteFile({ host: "fixture", port: 22, username: "ops", agentServerId: "srv_agent",
        oldPath: source, newPath: destination, noReplace: true });
      await expect(move()).rejects.toThrow();
      expect(await readFile(source, "utf8")).toBe("source");
      expect(await readFile(destination, "utf8")).toBe("unindexed");
      await rm(destination);
      await move();
      expect(await readFile(destination, "utf8")).toBe("source");
      await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.skipIf(process.platform === "win32")("keeps the original bytes when an Agent upload fails before publication", async () => {
    let calls = 0;
    mocks.executeCommandWithAgent.mockImplementation(({ command }: { command: string }) => {
      if (++calls === 2) return Promise.resolve({ stdout: "", stderr: "disk full", exitCode: 1 });
      return new Promise(resolve => execFile("sh", ["-c", command], (err, stdout, stderr) => resolve({ stdout, stderr, exitCode: err ? 1 : 0 })));
    });
    const dir = await mkdtemp(path.join(tmpdir(), "vch-write-"));
    try {
      const file = path.join(dir, "keep");
      await writeFile(file, "original");
      await expect(writeRemoteFile({ host: "fixture", port: 22, username: "ops", agentServerId: "node", remotePath: file, content: "replacement" })).rejects.toThrow("disk full");
      expect(await readFile(file, "utf8")).toBe("original");
      expect(await (await import("node:fs/promises")).readdir(dir)).toEqual(["keep"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  // A POSIX shell, python3 and file modes: the Linux Agent's environment.
  it.skipIf(process.platform === "win32")("writes a file larger than one shell argument allows, keeping the target's mode (C-1)", async () => {
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

it.skipIf(process.platform === "win32")("publishes one winner when local exclusive renames race", async () => {
  const { renameBackingObject } = await import("@/lib/storage/fs-backend");
  const directory = await mkdtemp(path.join(tmpdir(), "vch-local-rename-"));
  try {
    const storageNode = { id: "local", driver: "LOCAL" as const, basePath: directory, host: null, port: null, username: null, hostKeySha256: null, server: null };
    const rename = (oldRelativePath: string, newRelativePath: string) =>
      renameBackingObject({ storageNode, oldRelativePath, newRelativePath, noReplace: true });
    const sources = ["first", "second"];
    await Promise.all(sources.map((name, index) => writeFile(path.join(directory, name), String(index))));
    const attempts = await Promise.allSettled(sources.map(name => rename(name, "published")));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find(result => result.status === "rejected")?.reason).toMatchObject({ status: 409 });
    const winner = Number(await readFile(path.join(directory, "published"), "utf8"));
    expect(await readFile(path.join(directory, sources[1 - winner]!), "utf8")).toBe(String(1 - winner));
    await expect(rename(sources[winner]!, "missing")).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
