// @vitest-environment node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pinnedPublicationCommand } from "../pinned-publication";

describe.skipIf(process.platform !== "linux")("pinned relay publication protocol", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "relay-protocol-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function publish(data: Buffer, beforeCommit?: () => Promise<void>) {
    const digest = createHash("sha256").update(data).digest("hex");
    const shell = spawn("sh", ["-c", pinnedPublicationCommand(join(root, "dest", "file"), ".vch-fixture-", digest, { lexical: root, physical: root })]);
    const closed = once(shell, "close");
    const events: string[] = [];
    try {
      for await (const line of createInterface({ input: shell.stdout })) {
        events.push(line);
        if (line === "UPLOAD") {
          shell.stdin.write(String(data.length) + "\n");
          shell.stdin.write(data);
        } else if (line === "STAGED") {
          await beforeCommit?.();
          shell.stdin.end("COMMIT\n");
        }
      }
      const [code] = await closed;
      return { code, events };
    } finally { shell.kill(); }
  }

  it.each([Buffer.from("fixture\nwith\0bytes"), Buffer.alloc(0)])("publishes verified bytes and resumes from the same inode", async data => {
    const parent = join(root, "dest");
    await mkdir(parent);
    await writeFile(join(parent, ".vch-fixture-old.part"), "abandoned");
    expect(await publish(data)).toEqual({ code: 0, events: ["UPLOAD", "STAGED"] });
    const dest = join(parent, "file");
    const original = await stat(dest);
    expect(await readFile(dest)).toEqual(data);
    expect(await publish(data)).toEqual({ code: 0, events: ["STAGED"] });
    expect((await stat(dest)).ino).toBe(original.ino);
    expect(await readdir(parent)).toEqual(["file"]);
  });

  it("declines commit when the destination directory was moved during staging", async () => {
    const result = await publish(Buffer.from("fixture"), async () => {
      await rename(join(root, "dest"), join(root, "moved"));
      await mkdir(join(root, "dest"));
    });
    expect(result.events).toEqual(["UPLOAD", "STAGED"]);
    expect(result.code).toBe(1);
    expect(await readdir(join(root, "dest"))).toEqual([]);
    expect(await readdir(join(root, "moved"))).toEqual([]);
  });
});
