import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";

const schema = z.object({
  version: z.literal(1),
  files: z.array(z.object({
    name: z.string().min(1).refine((value) => !/[\/\\\0]/.test(value) && value !== "." && value !== ".."),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
});
export type TransferManifest = z.infer<typeof schema>;
export function parseTransferManifest(value: unknown): TransferManifest | null {
  if (value == null) return null;
  return schema.parse(value);
}
export async function hashTransferFile(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
