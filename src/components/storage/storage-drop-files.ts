"use client";

/** Directory readers return batches (often 100 entries); drain every batch. */
export async function readDroppedFiles(
  transfer: DataTransfer,
): Promise<File[]> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => ({
      entry: item.webkitGetAsEntry?.(),
      file: item.getAsFile?.(),
    }));
  if (!entries.some(({ entry }) => entry))
    return Array.from(transfer.files ?? []);
  const files: File[] = [];
  let count = 0;
  async function visit(entry: FileSystemEntry, prefix: string, depth: number) {
    if (++count > 10000 || depth > 64 || files.length >= 1000)
      throw new Error("storageUpload.queueFull");
    const path = `${prefix}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      Object.defineProperty(file, "webkitRelativePath", {
        value: path,
        configurable: true,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${path}/`, depth + 1);
      }
    }
  }
  for (const { entry, file } of entries) {
    if (entry) await visit(entry, "", 0);
    else if (file) {
      if (files.length >= 1000) throw new Error("storageUpload.queueFull");
      files.push(file);
    }
  }
  return files;
}
