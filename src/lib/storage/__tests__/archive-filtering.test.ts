// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Client } from "ssh2";
import { expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
import { isStorageStagingPath } from "../staging-paths";
import { pinLocalArchiveDirectory } from "../open-local-file";
import {
  archiveStreamResponse,
  streamLocalTarGz,
  streamRemoteTarGz,
} from "../archive-stream";

const linuxNode = { basePath: "/srv", host: null, port: null, server: { operatingSystem: "LINUX", host: "storage.test", port: 22 } };
// The SFTP transport fixture uses /bin/sh. Local archives use the host's native tar on both platforms.
it.each(process.platform === "win32" ? ["LOCAL", "pinned LOCAL"] : ["LOCAL", "pinned LOCAL", "SFTP"])(
  "%s tar excludes literal deleted paths and entire deleted subtrees",
  async (driver) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-filter-"));
    const name = "docs'quoted[1]";
    const directory = path.join(root, name);
    try {
      await mkdir(path.join(directory, "deleted"), { recursive: true });
      await mkdir(path.join(directory, "active/deleted"), { recursive: true });
      await writeFile(
        path.join(directory, "deleted/secret.txt"),
        "deleted directory bytes",
      );
      await writeFile(
        path.join(directory, "active/deleted/keep.txt"),
        "keep nested same name",
      );
      await writeFile(
        path.join(directory, "[draft].txt"),
        "recycled literal brackets",
      );
      const stageName = process.platform === "win32" ? ".VCONTROLHUB-WEBDAV-delete-test.STAGED" : ".vcontrolhub-webdav-delete-test.staged";
      const stagedDirectory = path.join(directory, "active", stageName);
      await mkdir(stagedDirectory);
      await writeFile(path.join(stagedDirectory, "private.txt"), "removed bytes");
      await writeFile(path.join(directory, ".vch-backup-abcd"), "old bytes");
      const uploadStages = [".vch-upload-ab.tmp", ".vch-upload-12345678-0123-abcd-abcd-0123456789af", ".vch-upload-r4x_1we8"];
      for (const stage of uploadStages) {
        expect(isStorageStagingPath("active/" + stage)).toBe(true);
        await writeFile(path.join(directory, "active", stage), "uploading");
      }
      const ordinary = ".vch-upload-notes.txt";
      expect(isStorageStagingPath(ordinary)).toBe(false);
      await writeFile(path.join(directory, ordinary), "notes");
      await writeFile(path.join(directory, "d.txt"), "keep wildcard match");
      const excluded = [name + "/deleted", name + "/[draft].txt"];
      // Exercise the actual SSH shell command and stdin against a local tar process;
      // only the SSH transport is replaced. No production SSH credentials are used.
      const client = {
        exec(
          command: string,
          callback: (error: null, stream: unknown) => void,
        ) {
          const child = spawn("/bin/sh", ["-c", command], { stdio: "pipe" });
          const channel = Object.assign(child.stdout, {
            stderr: child.stderr,
            end: (input: string) => child.stdin.end(input),
          });
          child.on("error", (error) => channel.destroy(error));
          callback(null, channel);
        },
      } as unknown as Client;
      const pinned = driver === "pinned LOCAL" ? await pinLocalArchiveDirectory(root, name) : undefined;
      const stream = driver === "SFTP"
        ? await streamRemoteTarGz(client, linuxNode, directory, excluded)
        : streamLocalTarGz(pinned?.cwd ?? directory, name, excluded, pinned);
      const bytes = Buffer.from(
        await archiveStreamResponse(stream, "test.tar.gz").arrayBuffer(),
      );
      const listing = execFileSync("tar", ["-tzf", "-"], {
        input: bytes,
        encoding: "utf8",
      });
      expect(listing).not.toContain(name + "/deleted/");
      expect(listing).not.toContain("[draft].txt");
      expect(listing).not.toContain(stageName);
      expect(listing).not.toContain(".vch-backup-abcd");
      for (const stage of uploadStages) expect(listing).not.toContain(stage);
      expect(listing).toContain(ordinary);
      expect(listing).toContain("active/deleted/keep.txt");
      expect(listing).toContain(name + "/d.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([
  { ...linuxNode, server: { ...linuxNode.server, operatingSystem: "WINDOWS" } },
  { ...linuxNode, server: null },
  { ...linuxNode, host: "another.test" },
  { ...linuxNode, basePath: "/C:/Shares" },
])("refuses to start a shell archive on an unconfirmed POSIX endpoint", async (node) => {
  const exec = vi.fn();
  await expect(streamRemoteTarGz({ exec } as unknown as Client, node, "/data/docs")).rejects.toThrow(ValidationError);
  expect(exec).not.toHaveBeenCalled();
});

it("rejects newline exclusions before spawning a process", () => {
  expect(() =>
    streamLocalTarGz("/unused", "unused", ["unused/one\nother"]),
  ).toThrow(ValidationError);
});
