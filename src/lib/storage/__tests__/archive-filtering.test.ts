// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Client } from "ssh2";
import { expect, it } from "vitest";
import {
  archiveStreamResponse,
  streamLocalTarGz,
  streamRemoteTarGz,
} from "../archive-stream";

it.each(["LOCAL", "SFTP"])(
  "%s tar excludes literal deleted paths and entire deleted subtrees",
  async (driver) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-filter-"));
    const directory = path.join(root, "docs'quoted");
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
      await writeFile(path.join(directory, "d.txt"), "keep wildcard match");
      const excluded = ["docs'quoted/deleted", "docs'quoted/[draft].txt"];
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
      const stream =
        driver === "LOCAL"
          ? streamLocalTarGz(directory, path.basename(directory), excluded)
          : await streamRemoteTarGz(client, directory, excluded);
      const bytes = Buffer.from(
        await archiveStreamResponse(stream, "test.tar.gz").arrayBuffer(),
      );
      const listing = execFileSync("tar", ["-tzf", "-"], {
        input: bytes,
        encoding: "utf8",
      });
      expect(listing).not.toContain("docs'quoted/deleted/");
      expect(listing).not.toContain("[draft].txt");
      expect(listing).toContain("active/deleted/keep.txt");
      expect(listing).toContain("docs'quoted/d.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("rejects newline exclusions before spawning a process", () => {
  expect(() =>
    streamLocalTarGz("/unused", "unused", ["unused/one\nother"]),
  ).toThrow("Invalid archive exclusion");
});
