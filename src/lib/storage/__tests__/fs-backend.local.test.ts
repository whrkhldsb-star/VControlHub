import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createManagedFolder } from "../fs-backend";

describe("createManagedFolder LOCAL filesystem", () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it("creates a folder when the configured storage root does not exist yet", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "vcontrolhub-storage-"),
    );
    const basePath = path.join(temporaryDirectory, "missing-root");
    const relativePath = "first-folder";

    await createManagedFolder({
      storageNode: { driver: "LOCAL", basePath, host: null, port: null, username: null, hostKeySha256: null, server: null },
      relativePath,
    });

    expect((await stat(path.join(basePath, relativePath))).isDirectory()).toBe(
      true,
    );
    await expect(
      createManagedFolder({
        storageNode: { driver: "LOCAL", basePath, host: null, port: null, username: null, hostKeySha256: null, server: null },
        relativePath,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("adopts an existing directory without gaining cleanup rights", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "vcontrolhub-storage-"));
    const node = { driver: "LOCAL", basePath: temporaryDirectory, host: null, port: null, username: null, hostKeySha256: null, server: null };
    await mkdir(path.join(temporaryDirectory, "existing"));
    expect(await createManagedFolder({ storageNode: node, relativePath: "existing", allowExisting: true })).toEqual({ created: false });
    await writeFile(path.join(temporaryDirectory, "file"), "");
    await expect(createManagedFolder({ storageNode: node, relativePath: "file", allowExisting: true })).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("removes only the same empty directory after an indexing failure", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "vcontrolhub-storage-"));
    const node = { driver: "LOCAL", basePath: temporaryDirectory, host: null, port: null, username: null, hostKeySha256: null, server: null };
    const { removeIfEmpty } = await createManagedFolder({ storageNode: node, relativePath: "created" });
    const target = path.join(temporaryDirectory, "created");
    await writeFile(path.join(target, "concurrent"), "keep");
    await expect(removeIfEmpty!()).rejects.toThrow();
    expect(await readFile(path.join(target, "concurrent"), "utf8")).toBe("keep");
    await unlink(path.join(target, "concurrent"));
    await rename(target, target + "-saved");
    await mkdir(target);
    await expect(removeIfEmpty!()).rejects.toThrow();
    expect((await stat(target)).isDirectory()).toBe(true);
    await rm(target, { recursive: true });
    await rename(target + "-saved", target);
    await removeIfEmpty!();
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
