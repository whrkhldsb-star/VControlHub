// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename), unlink: vi.fn(fs.unlink) };
});
import { rename, unlink } from "node:fs/promises";
import { moveBackingObject } from "../fs-backend";
import { readStorageFileBuffer, type StorageFileNode } from "../file-content";

let root: string;
let node: StorageFileNode;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vch-move-recovery-"));
  node = { id: "local", driver: "LOCAL", basePath: root, host: null, port: null, username: null, hostKeySha256: null, server: null };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const move = () => moveBackingObject({ storageNode: node, oldRelativePath: "from", newRelativePath: "to" });

it.skipIf(process.platform === "win32")("removes only its empty directory reservation on a failed rename, permitting retry", async () => {
  await mkdir(path.join(root, "from"));
  vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }));
  await expect(move()).rejects.toMatchObject({ code: "EXDEV" });
  expect(await readdir(root)).toEqual(["from"]);
  await move();
  expect(await readdir(root)).toEqual(["to"]);
});

it.each([false, true])("checks the identity of a published link on unlink failure (replacement %s)", async replaced => {
  const target = path.join(root, "to");
  await writeFile(path.join(root, "from"), "source");
  vi.mocked(unlink).mockImplementationOnce(async () => {
    if (replaced) {
      await rm(target);
      await writeFile(target, "replacement");
    }
    throw Object.assign(new Error("busy"), { code: "EBUSY" });
  });
  await expect(move()).rejects.toMatchObject({ code: "EBUSY" });
  expect(await readFile(path.join(root, "from"), "utf8")).toBe("source");
  if (replaced) expect(await readFile(target, "utf8")).toBe("replacement");
  else {
    expect(await readdir(root)).toEqual(["from"]);
    await move();
    expect(await readFile(target, "utf8")).toBe("source");
  }
});

it("bounds the actual bytes of a changed LOCAL source at read time", async () => {
  await writeFile(path.join(root, "small"), "okay");
  expect(await readStorageFileBuffer(node, "small", 4)).toEqual(Buffer.from("okay"));
  await writeFile(path.join(root, "small"), Buffer.alloc(256 * 1024));
  await expect(readStorageFileBuffer(node, "small", 4)).rejects.toMatchObject({ status: 422 });
});
