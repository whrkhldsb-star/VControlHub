// @vitest-environment node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { probeDirectDownloadRemote } from "../reconcile";

vi.mock("@/lib/ssh/client", () => ({
  execRemoteCommand: async ({ command }: { command: string }) => promisify(execFile)("sh", ["-c", command]),
}));

it.skipIf(process.platform !== "linux")("measures the published inode and reserves the no-receipt fallback for legacy tasks", async () => {
  const taskId = randomUUID();
  const targetPath = await mkdtemp(join(tmpdir(), "direct-receipt-"));
  const output = join(targetPath, "file");
  const exit = "/tmp/app-dl-" + taskId + ".pid.exit";
  const probe = (requiresReceipt: boolean) => probeDirectDownloadRemote({ taskId, pid: null, targetPath, requiresReceipt,
    fileName: "file", url: "https://fixture.invalid/file", sshParams: { host: "fixture", port: 22, username: "fixture" } });
  try {
    await writeFile(output, "published");
    const file = await stat(output, { bigint: true });
    await writeFile(exit, "0\n");
    await writeFile(exit + ".publish", file.dev + ":" + file.ino + "\n");
    expect(await probe(true)).toMatchObject({ state: "COMPLETED", size: "9" });
    await rename(output, join(targetPath, "original"));
    await writeFile(output, "replacement");
    expect(await probe(false)).toEqual({ state: "UNVERIFIED" });
    await rm(exit + ".publish");
    expect(await probe(true)).toEqual({ state: "UNVERIFIED" });
    expect(await probe(false)).toMatchObject({ state: "COMPLETED", size: "11" });
  } finally {
    await Promise.all([rm(targetPath, { recursive: true, force: true }), rm(exit, { force: true }), rm(exit + ".publish", { force: true })]);
  }
});
