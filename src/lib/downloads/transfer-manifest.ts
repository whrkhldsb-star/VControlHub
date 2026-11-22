import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";

import { isPlainDownloadName } from "./file-name";

const memberPath = z.string().min(1).refine((value) => value.split("/").every(isPlainDownloadName));
const schema = z.object({
  version: z.literal(1),
  metadataGid: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
  agentRootIdentity: z.string().regex(/^v2:[a-f0-9]{64}$/).optional(),
  files: z.array(z.object({
    // A path inside the download, "/"-separated: a multi-file torrent is a
    // folder of files. Every segment is a plain name.
    name: memberPath,
    sourceName: memberPath.optional(),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
});
export type TransferManifest = z.infer<typeof schema>;
export function relayCleanupConfirmed(value: unknown) {
  return !!value && typeof value === "object" && "cleanupComplete" in value && value.cleanupComplete === true;
}

export const downloadHistoryRemovable: Prisma.DownloadTaskWhereInput = {
  OR: [
    { relayMode: false, agentStorageNodeId: null, aria2Gid: null, transferManifest: { equals: Prisma.DbNull } },
    { transferManifest: { path: ["cleanupComplete"], equals: true } },
  ],
};

export const RELAY_PAUSE_MS = 24 * 3600_000;
export function relayPauseDeadline(task: { transferManifest: unknown; updatedAt: Date }) {
  const receipt = task.transferManifest;
  if (receipt && typeof receipt === "object" && "pausedUntil" in receipt && typeof receipt.pausedUntil === "number") return receipt.pausedUntil;
  return task.updatedAt.getTime() + RELAY_PAUSE_MS;
}

export function relayMetadataGid(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("metadataGid" in value)) return;
  return z.string().regex(/^[a-f0-9]{16}$/i).parse(value.metadataGid);
}

export function relayState(value: unknown): { phase?: string; deadline?: number; metadataGid?: string } {
  if (!value || typeof value !== "object") return {};
  const metadataGid = relayMetadataGid(value);
  return { ...(metadataGid ? { metadataGid } : {}),
    ...("phase" in value && typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...("deadline" in value && typeof value.deadline === "number" ? { deadline: value.deadline } : {}) };
}

export function relayPauseReceipt(value: unknown, pausedUntil: number) {
  return { ...relayState(value), pausedUntil };
}

export function parseTransferManifest(value: unknown): TransferManifest | null {
  if (value == null || (typeof value === "object" && !("files" in value) && ("phase" in value || "localClean" in value || "gidClean" in value || "pausedUntil" in value || "cleanupComplete" in value || relayMetadataGid(value)))) return null;
  return schema.parse(value);
}
export async function hashTransferFile(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
