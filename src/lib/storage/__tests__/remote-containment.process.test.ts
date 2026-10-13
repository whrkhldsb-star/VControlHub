// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { startSftpFsServer } from "@/test/helpers/sftp-fs-server";

/**
 * Storage containment against real files and real symlinks, over both remote
 * transports:
 * - direct SSH: an in-process SSH server whose SFTP subsystem serves the real
 *   filesystem (jailed to the test sandbox), so realpath/lstat and the
 *   link-following reads and writes are the operating system's;
 * - Agent: the Agent command executor runs the generated command with a local
 *   sh, so the real python realpath and file I/O run.
 *
 * Layout (inside one temp sandbox the SSH account can reach):
 *   root/a/ok.txt            inside the node
 *   root/b/b.txt             sibling grant area
 *   root/a/out  -> outside   escapes the node
 *   root/a/sib  -> ../b      stays inside the root but changes grant area
 *   outside/secret.txt       reachable by the account, not part of the node
 *   root-alias  -> root      the node root itself may be a link
 */
vi.mock("@/lib/server/agent-service", () => ({
  executeCommandWithAgent: vi.fn(async ({ command }: { command: string }) => {
    const result = spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 20_000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
  }),
}));

import { closeSshPool } from "@/lib/ssh/client";
import { ValidationError } from "@/lib/errors";
import { resolveStoragePathWithinBase } from "../path-utils";
import { deleteBackingObject, readBackingObject, renameBackingObject, statBackingObject, writeBackingObject } from "../fs-backend";
import { readStorageFileBuffer, streamStorageFile } from "../file-content";

// The in-process SFTP server serves POSIX paths and the Agent fake runs sh/python3;
// neither exists on Windows, where only the LOCAL cases run.
const posix = process.platform !== "win32";
const hasPython = posix && spawnSync("sh", ["-c", "command -v python3"]).status === 0;

let sandbox: string;
let server: Awaited<ReturnType<typeof startSftpFsServer>>;

beforeAll(async () => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "vch-containment-")));
  mkdirSync(join(sandbox, "root", "a"), { recursive: true });
  mkdirSync(join(sandbox, "root", "b"), { recursive: true });
  mkdirSync(join(sandbox, "outside"));
  writeFileSync(join(sandbox, "root", "a", "ok.txt"), "inside");
  mkdirSync(join(sandbox, "root", "..cache"));
  writeFileSync(join(sandbox, "root", "..cache", "c.txt"), "dot-dot name");
  writeFileSync(join(sandbox, "root", "b", "b.txt"), "sibling area");
  writeFileSync(join(sandbox, "outside", "secret.txt"), "OUTSIDE");
  symlinkSync(join(sandbox, "outside"), join(sandbox, "root", "a", "out"));
  symlinkSync("../b", join(sandbox, "root", "a", "sib"));
  symlinkSync(join(sandbox, "root"), join(sandbox, "root-alias"));
  server = await startSftpFsServer({ sandbox, username: "storage", password: "storage-pass" });
});

afterAll(async () => {
  await closeSshPool();
  await server?.close();
  rmSync(sandbox, { recursive: true, force: true });
});

const directNode = (basePath = join(sandbox, "root")) => ({
  id: "node-direct",
  name: "direct",
  driver: "SFTP",
  basePath,
  host: "127.0.0.1",
  port: server.port,
  username: "storage",
  hostKeySha256: server.fingerprint,
  // A plain stored password passes through decryptServerPassword (legacy).
  server: { id: "srv", managementMode: "SSH", operatingSystem: "LINUX", connectionType: "PASSWORD", password: "storage-pass", sshKey: null },
}) as never;

const agentNode = (basePath = join(sandbox, "root")) => ({
  id: "node-agent",
  name: "agent",
  driver: "SFTP",
  basePath,
  host: "agent.invalid",
  port: 22,
  username: "storage",
  hostKeySha256: null,
  server: { id: "agent-srv", managementMode: "AGENT", operatingSystem: "LINUX", connectionType: "SSH_KEY", sshKey: null },
}) as never;

const refused = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toBeInstanceOf(ValidationError);
};

describe.skipIf(!posix).each([
  ["direct SSH", directNode, true],
  ["Agent", agentNode, hasPython],
] as const)("SFTP storage containment over %s (real files and symlinks)", (_transport, node, enabled) => {
  it.skipIf(!enabled)("reads and writes inside the node, including new nested directories", async () => {
    expect((await readBackingObject({ storageNode: node(), relativePath: "a/ok.txt" })).toString()).toBe("inside");
    expect((await readStorageFileBuffer(node(), "a/ok.txt")).toString()).toBe("inside");
    await writeBackingObject({ storageNode: node(), relativePath: `a/new-${_transport.length}/deep/file.txt`, content: "written" } as never);
    expect(readFileSync(join(sandbox, "root", "a", `new-${_transport.length}`, "deep", "file.txt"), "utf8")).toBe("written");
  });

  it.skipIf(!enabled)("refuses every operation through a link that leaves the node, and touches nothing outside", async () => {
    const opened = server.opened.length;
    await refused(readBackingObject({ storageNode: node(), relativePath: "a/out/secret.txt" }));
    await refused(readStorageFileBuffer(node(), "a/out/secret.txt"));
    if (_transport === "direct SSH") await refused(streamStorageFile(node(), "a/out/secret.txt"));
    await refused(statBackingObject({ storageNode: node(), relativePath: "a/out/secret.txt" }));
    await refused(writeBackingObject({ storageNode: node(), relativePath: "a/out/new.txt", content: "x" } as never));
    await refused(renameBackingObject({ storageNode: node(), oldRelativePath: "a/ok.txt", newRelativePath: "a/out/moved.txt" }));
    await refused(deleteBackingObject({ storageNode: node(), relativePath: "a/out/secret.txt", isDirectory: false, tolerateMissing: true }));
    expect(server.opened.slice(opened).filter((target) => target.includes("outside"))).toEqual([]);
    expect(readFileSync(join(sandbox, "outside", "secret.txt"), "utf8")).toBe("OUTSIDE");
    expect(existsSync(join(sandbox, "outside", "new.txt"))).toBe(false);
    expect(existsSync(join(sandbox, "outside", "moved.txt"))).toBe(false);
    expect(readFileSync(join(sandbox, "root", "a", "ok.txt"), "utf8")).toBe("inside");
  });

  it.skipIf(!enabled)("refuses a link that stays in the root but crosses into another grant area", async () => {
    await refused(readBackingObject({ storageNode: node(), relativePath: "a/sib/b.txt" }));
  });

  it.skipIf(!enabled)("accepts a top-level name that merely starts with two dots", async () => {
    expect((await readBackingObject({ storageNode: node(), relativePath: "..cache/c.txt" })).toString()).toBe("dot-dot name");
  });

  it.skipIf(!enabled)("accepts a node root that is itself a link", async () => {
    expect((await readBackingObject({ storageNode: node(join(sandbox, "root-alias")), relativePath: "a/ok.txt" })).toString()).toBe("inside");
    await refused(readBackingObject({ storageNode: node(join(sandbox, "root-alias")), relativePath: "a/out/secret.txt" }));
  });
});

describe("LOCAL storage containment (real symlinks)", () => {
  it("allows plain paths, refuses links out of the root and links to another grant area", () => {
    const base = join(sandbox, "root");
    expect(resolveStoragePathWithinBase(base, "a/ok.txt")).toMatchObject({ ok: true });
    expect(resolveStoragePathWithinBase(base, "a/new/file.txt")).toMatchObject({ ok: true });
    expect(resolveStoragePathWithinBase(base, "a/out/secret.txt")).toMatchObject({ ok: false });
    expect(resolveStoragePathWithinBase(base, "a/sib/b.txt")).toMatchObject({ ok: false });
    expect(resolveStoragePathWithinBase(join(sandbox, "root-alias"), "a/ok.txt")).toMatchObject({ ok: true });
    expect(resolveStoragePathWithinBase(base, "..cache/c.txt")).toMatchObject({ ok: true });
  });
});

it.skipIf(!posix)("the SFTP test server never served anything outside its sandbox", () => {
  expect(server.outsideRequests).toEqual([]);
});
