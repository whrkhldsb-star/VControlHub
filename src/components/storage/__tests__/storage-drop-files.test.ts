import { describe, expect, it, vi } from "vitest";
import { readDroppedFiles } from "../storage-drop-files";

describe("readDroppedFiles", () => {
  it("keeps ordinary files mixed with browser directory entries", async () => {
    const file = new File(["plain"], "plain.txt");
    const nested = new File(["nested"], "nested.txt");
    const transfer = {
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => ({
            name: "nested.txt",
            isFile: true,
            file: (resolve: (file: File) => void) => resolve(nested),
          }),
        },
        { kind: "file", getAsFile: () => file },
      ],
    } as unknown as DataTransfer;
    expect(await readDroppedFiles(transfer)).toEqual([nested, file]);
  });
  it("drains all directory batches and preserves nested relative paths", async () => {
    const entry = (name: string) => ({
      name,
      isFile: true,
      file: (resolve: (file: File) => void) => resolve(new File([name], name)),
    });
    const readEntries = vi
      .fn()
      .mockImplementationOnce((resolve) => resolve([entry("first.txt")]))
      .mockImplementationOnce((resolve) => resolve([entry("second.txt")]))
      .mockImplementation((resolve) => resolve([]));
    const transfer = {
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => ({
            name: "folder",
            isDirectory: true,
            createReader: () => ({ readEntries }),
          }),
        },
      ],
    } as unknown as DataTransfer;
    expect(
      (await readDroppedFiles(transfer)).map((file) => file.webkitRelativePath),
    ).toEqual(["folder/first.txt", "folder/second.txt"]);
    expect(readEntries).toHaveBeenCalledTimes(3);
  });
  it("falls back to ordinary files when directory APIs are unavailable", async () => {
    const file = new File(["a"], "a.txt");
    expect(
      await readDroppedFiles({ files: [file] } as unknown as DataTransfer),
    ).toEqual([file]);
  });
  it("propagates unreadable directory errors instead of silently skipping them", async () => {
    const transfer = {
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => ({
            name: "folder",
            isDirectory: true,
            createReader: () => ({
              readEntries: (_: unknown, reject: (error: Error) => void) =>
                reject(new Error("permission denied")),
            }),
          }),
        },
      ],
    } as unknown as DataTransfer;
    await expect(readDroppedFiles(transfer)).rejects.toThrow(
      "permission denied",
    );
  });
});
